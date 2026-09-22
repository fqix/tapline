import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'
import { Engine } from '../../core/engine'
import { applyHeaderEdits, decodeBody, remapUrl, setHeader } from '../../core/rules'
import { matchWildcard, ruleMatches, type Rule } from '../../shared/model'
import { CORE, httpServer, settled, startEngine, viaProxy } from '../helpers/helpers'

describe('rule matching', () => {
    it('matches wildcards anywhere in the URL, case-insensitively', () => {
        expect(matchWildcard('*', 'http://a/b')).toBe(true)
        expect(matchWildcard('', 'http://a/b')).toBe(true)
        expect(matchWildcard('http://a/*', 'http://a/b/c')).toBe(true)
        expect(matchWildcard('*/api/*', 'https://x.example.com/api/users')).toBe(true)
        expect(matchWildcard('*.json', 'https://x/data.JSON')).toBe(true)
        expect(matchWildcard('*/users', 'https://x/api/users?x=1')).toBe(false)
    })
    it('treats a pattern without wildcards as a prefix', () => {
        expect(matchWildcard('https://api.example.com', 'https://api.example.com/v1')).toBe(true)
        expect(matchWildcard('https://api.example.com/v2', 'https://api.example.com/v1')).toBe(
            false
        )
    })
    it('filters by method list', () => {
        const rule = { url: '*', method: 'post, put' }
        expect(ruleMatches(rule, 'POST', 'http://x')).toBe(true)
        expect(ruleMatches(rule, 'PUT', 'http://x')).toBe(true)
        expect(ruleMatches(rule, 'GET', 'http://x')).toBe(false)
        expect(ruleMatches({ url: '*', method: '' }, 'GET', 'http://x')).toBe(true)
    })
})

describe('rule helpers', () => {
    it('edits headers case-insensitively and removes with null', () => {
        const headers = { 'Content-Type': 'text/plain', 'X-Old': '1' }
        applyHeaderEdits(headers, {
            'content-type': 'application/json',
            'x-old': null,
            'X-New': 'n'
        })
        expect(headers).toEqual({ 'Content-Type': 'application/json', 'X-New': 'n' })
        setHeader(headers, 'x-new', null)
        expect(headers).toEqual({ 'Content-Type': 'application/json' })
    })
    it('remaps the origin and keeps path and query', () => {
        expect(remapUrl('https://api.example.com/v1/users?x=1', 'http://localhost:8080')).toBe(
            'http://localhost:8080/v1/users?x=1'
        )
        expect(remapUrl('https://a/v1', 'https://b/prefix/')).toBe('https://b/prefix/v1')
        expect(remapUrl('http://a/v1', 'localhost:3000')).toBe('http://localhost:3000/v1')
    })
    it('decodes gzip, deflate and brotli bodies, tolerating truncation', () => {
        const text = Buffer.from('hello '.repeat(1000))
        expect(decodeBody(zlib.gzipSync(text), 'gzip')).toEqual({ bytes: text, encoding: 'gzip' })
        expect(decodeBody(zlib.deflateSync(text), 'deflate').bytes).toEqual(text)
        expect(decodeBody(zlib.brotliCompressSync(text), 'br').bytes).toEqual(text)
        const cut = decodeBody(zlib.gzipSync(text).subarray(0, 40), 'gzip')
        expect(cut.encoding).toBe('gzip')
        expect(cut.bytes.length).toBeGreaterThan(0)
        expect(decodeBody(text, 'gzip')).toEqual({ bytes: text })
        expect(decodeBody(text, undefined)).toEqual({ bytes: text })
    })
})

const describeCore = existsSync(CORE) ? describe : describe.skip

describeCore('interception rules with the bundled core', () => {
    let engine: Engine
    let origin: Awaited<ReturnType<typeof httpServer>>
    let mirror: Awaited<ReturnType<typeof httpServer>>
    const directory = mkdtempSync(join(tmpdir(), 'tapline-rules-'))

    const echo = (name: string) =>
        httpServer((req, res) => {
            const chunks: Buffer[] = []
            req.on('data', (c) => chunks.push(c))
            req.on('end', () => {
                const body = Buffer.concat(chunks).toString()
                if (req.url === '/gzip') {
                    res.writeHead(200, {
                        'content-type': 'application/json',
                        'content-encoding': 'gzip'
                    })
                    res.end(zlib.gzipSync(JSON.stringify({ server: name, compressed: true })))
                    return
                }
                res.writeHead(200, { 'content-type': 'application/json', 'x-server': name })
                res.end(
                    JSON.stringify({
                        server: name,
                        method: req.method,
                        url: req.url,
                        body,
                        headers: req.headers
                    })
                )
            })
        })

    type Draft = { [K in Rule['kind']]: Omit<Extract<Rule, { kind: K }>, 'enabled'> }[Rule['kind']]
    const rule = (r: Draft & { enabled?: boolean }): Rule => ({ enabled: true, ...r }) as Rule
    const use = (...rules: Rule[]) => {
        engine.settings.rules = rules
    }

    beforeAll(async () => {
        origin = await echo('origin')
        mirror = await echo('mirror')
        engine = await startEngine()
    }, 60000)
    afterAll(async () => {
        await engine?.stop()
        origin?.server.close()
        mirror?.server.close()
    })

    it('blocks matching requests locally', async () => {
        use(rule({ id: 'b', kind: 'block', name: 'no-admin', url: '*/admin*' }))
        const url = `http://127.0.0.1:${origin.port}/admin/users`
        const reply = await viaProxy(engine.settings.port, url)
        expect(reply.status).toBe(403)
        expect(reply.body).toContain('no-admin')
        const t = await settled(engine, (t) => t.url === url)
        expect(t.local).toBe(true)
        expect(t.status).toBe(403)
        expect(t.rules).toEqual(['no-admin'])
        expect(t.state).toBe('completed')
        // Unmatched URLs still reach the server.
        const ok = await viaProxy(engine.settings.port, `http://127.0.0.1:${origin.port}/public`)
        expect(JSON.parse(ok.body).server).toBe('origin')
    })

    it('serves a local file or inline body instead of the server', async () => {
        const file = join(directory, 'users.json')
        writeFileSync(file, '[{"id":1}]')
        use(
            rule({ id: 'f', kind: 'mapLocal', url: '*/users.json', file }),
            rule({
                id: 'i',
                kind: 'mapLocal',
                url: '*/inline',
                body: '{"mock":true}',
                status: 201
            })
        )
        const fromFile = await viaProxy(
            engine.settings.port,
            `http://127.0.0.1:${origin.port}/users.json`
        )
        expect(fromFile.status).toBe(200)
        expect(fromFile.body).toBe('[{"id":1}]')
        const inline = await viaProxy(
            engine.settings.port,
            `http://127.0.0.1:${origin.port}/inline`
        )
        expect(inline.status).toBe(201)
        expect(JSON.parse(inline.body)).toEqual({ mock: true })
        const t = await settled(engine, (t) => t.path === '/inline')
        expect(t.responseHeaders['content-type']).toBe('application/json')
        expect(t.responseBody).toBe('{"mock":true}')
        expect(t.local).toBe(true)
    })

    it('answers 404 locally when the mapped file is missing', async () => {
        use(rule({ id: 'm', kind: 'mapLocal', url: '*/missing', file: join(directory, 'nope') }))
        const reply = await viaProxy(
            engine.settings.port,
            `http://127.0.0.1:${origin.port}/missing`
        )
        expect(reply.status).toBe(404)
    })

    it('maps a request to another origin', async () => {
        use(
            rule({
                id: 'r',
                kind: 'mapRemote',
                url: `http://127.0.0.1:${origin.port}/*`,
                to: `http://127.0.0.1:${mirror.port}`
            })
        )
        const url = `http://127.0.0.1:${origin.port}/api/x?y=1`
        const reply = await viaProxy(engine.settings.port, url)
        const parsed = JSON.parse(reply.body)
        expect(parsed.server).toBe('mirror')
        expect(parsed.url).toBe('/api/x?y=1')
        expect(parsed.headers.host).toBe(`127.0.0.1:${mirror.port}`)
        const t = await settled(engine, (t) => t.url === url)
        expect(t.upstreamUrl).toBe(`http://127.0.0.1:${mirror.port}/api/x?y=1`)
        expect(t.rules).toEqual(['mapRemote'])
    })

    it('rewrites request headers, body and the response', async () => {
        use(
            rule({
                id: 'w',
                kind: 'rewrite',
                name: 'tweak',
                url: '*/rewrite',
                request: {
                    headers: { 'x-added': 'yes', 'x-drop': null },
                    bodyReplace: { pattern: 'world', replacement: 'tapline' }
                },
                response: {
                    status: 418,
                    headers: { 'x-server': 'rewritten' },
                    bodyReplace: { pattern: '"server":"origin"', replacement: '"server":"edited"' }
                }
            })
        )
        const url = `http://127.0.0.1:${origin.port}/rewrite`
        const reply = await viaProxy(
            engine.settings.port,
            url,
            { method: 'POST', headers: { 'x-drop': '1', 'content-type': 'text/plain' } },
            'hello world'
        )
        expect(reply.status).toBe(418)
        const parsed = JSON.parse(reply.body)
        expect(parsed.server).toBe('edited')
        expect(parsed.body).toBe('hello tapline')
        expect(parsed.headers['x-added']).toBe('yes')
        expect(parsed.headers['x-drop']).toBeUndefined()
        expect(parsed.headers['content-length']).toBe('13')
        const t = await settled(engine, (t) => t.url === url)
        expect(t.requestBody).toBe('hello tapline')
        expect(t.requestHeaders['x-added']).toBe('yes')
        expect(t.status).toBe(418)
        expect(t.responseHeaders['x-server']).toBe('rewritten')
        expect(JSON.parse(t.responseBody).server).toBe('edited')
        expect(t.rules).toEqual(['tweak', 'tweak'])
    })

    it('replaces a whole response body', async () => {
        use(
            rule({
                id: 'rb',
                kind: 'rewrite',
                url: '*/whole',
                response: { body: 'replaced', headers: { 'content-type': 'text/plain' } }
            })
        )
        const reply = await viaProxy(engine.settings.port, `http://127.0.0.1:${origin.port}/whole`)
        expect(reply.body).toBe('replaced')
    })

    it('decodes gzip responses for the record and rewrites them plain', async () => {
        use()
        const url = `http://127.0.0.1:${origin.port}/gzip`
        await viaProxy(engine.settings.port, url)
        const t = await settled(engine, (t) => t.url === url && !t.rules)
        expect(t.responseEncoding).toBe('gzip')
        expect(JSON.parse(t.responseBody)).toEqual({ server: 'origin', compressed: true })
        use(
            rule({
                id: 'gz',
                kind: 'rewrite',
                url: '*/gzip',
                response: { bodyReplace: { pattern: 'true', replacement: 'false' } }
            })
        )
        const reply = await viaProxy(engine.settings.port, url)
        expect(JSON.parse(reply.body).compressed).toBe(false)
        const edited = await settled(engine, (t) => t.url === url && !!t.rules)
        expect(edited.responseHeaders['content-encoding']).toBeUndefined()
        expect(edited.responseEncoding).toBeUndefined()
    })

    it('adds latency and limits bandwidth', async () => {
        use(rule({ id: 't', kind: 'throttle', url: '*/slow', latencyMs: 300, kbps: 64 }))
        const started = Date.now()
        const reply = await viaProxy(
            engine.settings.port,
            `http://127.0.0.1:${origin.port}/slow`,
            { method: 'POST' },
            'x'.repeat(4000)
        )
        // 4000 bytes at 64 kbps ≈ 500 ms in each direction, plus 300 ms latency.
        expect(Date.now() - started).toBeGreaterThanOrEqual(700)
        expect(JSON.parse(reply.body).body.length).toBe(4000)
    })

    it('holds a request at a breakpoint until it is resumed with edits', async () => {
        use(rule({ id: 'bp', kind: 'breakpoint', url: '*/held*', request: true, response: true }))
        const url = `http://127.0.0.1:${origin.port}/held?x=1`
        const paused = new Promise<string>((resolve) => {
            const listener = (event: {
                type: string
                transaction?: { id: string; paused?: string; url: string }
            }) => {
                if (event.type === 'transaction' && event.transaction?.paused === 'request') {
                    engine.off('event', listener)
                    resolve(event.transaction.id)
                }
            }
            engine.on('event', listener)
        })
        const reply = viaProxy(
            engine.settings.port,
            url,
            { method: 'POST', headers: { 'x-a': '1' } },
            'original'
        )
        const id = await paused
        const held = engine.transactions.get(id)!
        expect(held.requestBody).toBe('original')
        expect(held.state).toBe('pending')
        engine.resume(id, {
            url: `http://127.0.0.1:${origin.port}/held-edited`,
            headers: { ...held.requestHeaders, 'x-a': '2' },
            body: 'edited'
        })
        // The response breakpoint fires next.
        const pausedResponse = new Promise<void>((resolve) => {
            const listener = (event: {
                type: string
                transaction?: { id: string; paused?: string }
            }) => {
                if (
                    event.type === 'transaction' &&
                    event.transaction?.id === id &&
                    event.transaction.paused === 'response'
                ) {
                    engine.off('event', listener)
                    resolve()
                }
            }
            engine.on('event', listener)
        })
        await pausedResponse
        expect(engine.transactions.get(id)!.status).toBe(200)
        engine.resume(id, { status: 202, body: '{"edited":"response"}' })
        const result = await reply
        expect(result.status).toBe(202)
        expect(JSON.parse(result.body)).toEqual({ edited: 'response' })
        const t = await settled(engine, (t) => t.id === id)
        expect(t.upstreamUrl).toBe(`http://127.0.0.1:${origin.port}/held-edited`)
        expect(t.requestBody).toBe('edited')
        expect(t.requestHeaders['x-a']).toBe('2')
        expect(t.paused).toBeUndefined()
        expect(t.rules).toEqual(['breakpoint', 'breakpoint'])
    })

    it('fails a request aborted at a breakpoint', async () => {
        use(rule({ id: 'bp2', kind: 'breakpoint', url: '*/abort', request: true }))
        const url = `http://127.0.0.1:${origin.port}/abort`
        const paused = new Promise<string>((resolve) => {
            const listener = (event: {
                type: string
                transaction?: { id: string; paused?: string }
            }) => {
                if (event.type === 'transaction' && event.transaction?.paused === 'request') {
                    engine.off('event', listener)
                    resolve(event.transaction.id)
                }
            }
            engine.on('event', listener)
        })
        const reply = viaProxy(engine.settings.port, url)
        const id = await paused
        engine.abort(id)
        expect((await reply).status).toBe(502)
        const t = await settled(engine, (t) => t.id === id)
        expect(t.state).toBe('error')
        expect(() => engine.resume(id)).toThrow()
    })

    it('ignores disabled rules', async () => {
        use(rule({ id: 'off', kind: 'block', url: '*', enabled: false }))
        const reply = await viaProxy(engine.settings.port, `http://127.0.0.1:${origin.port}/on`)
        expect(reply.status).toBe(200)
    })
})
