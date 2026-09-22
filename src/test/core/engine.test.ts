import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { Engine } from '../../core/engine'
import {
    CORE,
    httpServer,
    httpsServer,
    selfSigned,
    settled,
    startEngine,
    viaProxy,
    viaProxyTLS
} from '../helpers/helpers'

const describeCore = existsSync(CORE) ? describe : describe.skip

describeCore('engine with the bundled core', () => {
    let engine: Engine
    let plain: Awaited<ReturnType<typeof httpServer>>
    let secure: Awaited<ReturnType<typeof httpsServer>>
    const identity = selfSigned()

    beforeAll(async () => {
        plain = await httpServer((req, res) => {
            if (req.url === '/events') {
                res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
                res.write(': hello\ndata: one\n\n')
                setTimeout(() => res.write('event: tick\nid: 2\ndata: two\ndata: lines\n\n'), 50)
                setTimeout(() => res.end('data: unfinished'), 100)
                return
            }
            const chunks: Buffer[] = []
            req.on('data', (c) => chunks.push(c))
            req.on('end', () => {
                res.setHeader('content-type', 'application/json')
                res.end(
                    JSON.stringify({
                        method: req.method,
                        url: req.url,
                        body: Buffer.concat(chunks).toString(),
                        ...(req.url === '/binary'
                            ? { base64: Buffer.concat(chunks).toString('base64') }
                            : {})
                    })
                )
            })
        })
        secure = await httpsServer(identity, (req, res) => {
            res.setHeader('content-type', 'text/plain')
            res.end(`secret for ${req.url}`)
        })
        engine = await startEngine((e) => {
            e.upstreamCA = identity.cert
        })
    }, 60000)

    afterAll(async () => {
        await engine?.stop()
        plain?.server.close()
        secure?.server.close()
    })

    it('records a plain HTTP request and response', async () => {
        const url = `http://127.0.0.1:${plain.port}/hello?x=1`
        const reply = await viaProxy(
            engine.settings.port,
            url,
            { method: 'POST', headers: { 'content-type': 'text/plain' } },
            'ping'
        )
        expect(reply.status).toBe(200)
        const t = await settled(engine, (t) => t.url === url)
        expect(t.method).toBe('POST')
        expect(t.state).toBe('completed')
        expect(t.status).toBe(200)
        expect(t.requestBody).toBe('ping')
        expect(JSON.parse(t.responseBody)).toEqual({
            method: 'POST',
            url: '/hello?x=1',
            body: 'ping'
        })
        expect(t.responseHeaders['content-type']).toBe('application/json')
        expect(t.requestBytes).toBe(4)
        expect(t.tls).toBe(false)
        expect(t.duration).toBeGreaterThanOrEqual(0)
        expect(t.serverAddress).toBe(`127.0.0.1:${plain.port}`)
    })

    it('decrypts HTTPS for matching hosts using the root CA', async () => {
        const root = readFileSync(engine.certificatePath, 'utf8')
        const url = `https://127.0.0.1:${secure.port}/private`
        const reply = await viaProxyTLS(engine.settings.port, url, root)
        expect(reply.body).toBe('secret for /private')
        const t = await settled(engine, (t) => t.url === url)
        expect(t.tls).toBe(true)
        expect(t.status).toBe(200)
        expect(t.responseBody).toBe('secret for /private')
    })

    it('tunnels CONNECT without decryption for excluded hosts', async () => {
        engine.settings.sslHosts = []
        try {
            const url = `https://127.0.0.1:${secure.port}/opaque`
            const reply = await viaProxyTLS(engine.settings.port, url, identity.cert)
            expect(reply.body).toBe('secret for /opaque')
            const t = await settled(engine, (t) => t.scheme === 'connect')
            expect(t.method).toBe('CONNECT')
            expect(t.requestBytes).toBeGreaterThan(0)
            expect(t.responseBytes).toBeGreaterThan(0)
            expect(t.responseBody).toBe('')
            expect(t.serverAddress).toBe(`127.0.0.1:${secure.port}`)
        } finally {
            engine.settings.sslHosts = ['*']
        }
    })

    it('does not record while recording is paused', async () => {
        engine.recording = false
        const before = engine.transactions.size
        const url = `http://127.0.0.1:${plain.port}/paused`
        await viaProxy(engine.settings.port, url)
        engine.recording = true
        expect(engine.transactions.size).toBe(before)
    })

    it('replays a captured request through the proxy', async () => {
        const url = `http://127.0.0.1:${plain.port}/replay`
        await viaProxy(
            engine.settings.port,
            url,
            { method: 'PUT', headers: { 'x-test': 'a' } },
            'body'
        )
        const original = await settled(engine, (t) => t.url === url)
        const replayed = await engine.compose({
            url,
            method: 'PUT',
            headers: original.requestHeaders,
            body: original.requestBody,
            replayOf: original.id
        })
        expect(replayed.id).not.toBe(original.id)
        expect(replayed.replayOf).toBe(original.id)
        expect(JSON.parse(replayed.responseBody).body).toBe('body')
        expect(replayed.requestHeaders['x-test']).toBe('a')
        expect(replayed.url).toBe(url)
    })

    it('sends binary compose payloads without changing their bytes', async () => {
        const bytes = Buffer.from([0, 255, 128, 13, 10, 195, 40])
        const reply = await engine.compose({
            url: `http://127.0.0.1:${plain.port}/binary`,
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: bytes.toString('base64'),
            bodyEncoding: 'base64'
        })
        expect(JSON.parse(reply.responseBody).base64).toBe(bytes.toString('base64'))
    })

    it('parses server-sent events as they stream', async () => {
        const url = `http://127.0.0.1:${plain.port}/events`
        const seen: number[] = []
        const listener = (event: {
            type: string
            transaction?: { url: string; events?: unknown[] }
        }) => {
            if (event.type === 'transaction' && event.transaction?.url === url)
                seen.push(event.transaction.events?.length ?? -1)
        }
        engine.on('event', listener)
        try {
            const reply = await viaProxy(engine.settings.port, url)
            expect(reply.body).toContain('data: unfinished')
            const t = await settled(engine, (t) => t.url === url)
            expect(
                t.events?.map((e) => ({ event: e.event, data: e.data, id: e.lastEventId }))
            ).toEqual([
                { event: 'message', data: 'one', id: '' },
                { event: 'tick', data: 'two\nlines', id: '2' }
            ])
            expect(t.eventsTruncated).toBeFalsy()
            expect(t.responseBody).toContain('data: unfinished')
            // The first event was published before the second arrived.
            expect(seen).toContain(1)
        } finally {
            engine.off('event', listener)
        }
    })

    it('truncates retained bodies beyond the limit while forwarding in full', async () => {
        engine.settings.maxBodyBytes = 16
        try {
            const url = `http://127.0.0.1:${plain.port}/big`
            const reply = await viaProxy(
                engine.settings.port,
                url,
                { method: 'POST' },
                'x'.repeat(1000)
            )
            expect(JSON.parse(reply.body).body.length).toBe(1000)
            const t = await settled(engine, (t) => t.url === url)
            expect(t.truncated).toBe(true)
            expect(t.requestBody.length).toBe(16)
            expect(t.requestBytes).toBe(1000)
        } finally {
            engine.settings.maxBodyBytes = 512 * 1024
        }
    })

    it('evicts the oldest entries beyond maxEntries', async () => {
        engine.settings.maxEntries = 3
        try {
            for (let i = 0; i < 5; i++)
                await viaProxy(engine.settings.port, `http://127.0.0.1:${plain.port}/evict/${i}`)
            await settled(engine, (t) => t.path === '/evict/4')
            expect(engine.transactions.size).toBeLessThanOrEqual(3)
        } finally {
            engine.settings.maxEntries = 2000
        }
    })

    it('restarts sequence numbers at 1 after clear', async () => {
        engine.clear()
        expect(engine.transactions.size).toBe(0)
        await viaProxy(engine.settings.port, `http://127.0.0.1:${plain.port}/fresh`)
        await settled(engine, (t) => t.path === '/fresh')
        expect([...engine.transactions.values()].map((t) => t.sequence)).toEqual([1])
    })
})
