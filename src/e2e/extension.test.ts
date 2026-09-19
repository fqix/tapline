// End-to-end: the packaged extension inside a real VS Code, driving a real capture agent
// and sing-box core. Requests go through the proxy from this test process; assertions
// read the extension's transaction mirror through the API `activate` returns.
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import * as vscode from 'vscode'
import type { TaplineApi } from '../extension'
import type { Rule, Transaction } from '../shared/model'

const PROXY_PORT = 3626

function until<T>(probe: () => T | undefined | false, timeout = 20000, what = 'condition') {
    return new Promise<T>((resolve, reject) => {
        const started = Date.now()
        const tick = () => {
            const value = probe()
            if (value) return resolve(value)
            if (Date.now() - started > timeout) return reject(new Error(`Timed out: ${what}`))
            setTimeout(tick, 50)
        }
        tick()
    })
}

/** Plain HTTP request through the proxy (absolute-URI form). */
function viaProxy(url: string, options: http.RequestOptions = {}, body?: string) {
    return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>(
        (resolve, reject) => {
            const request = http.request(
                {
                    host: '127.0.0.1',
                    port: PROXY_PORT,
                    path: url,
                    method: options.method ?? 'GET',
                    headers: { host: new URL(url).host, ...options.headers }
                },
                (response) => {
                    const chunks: Buffer[] = []
                    response.on('data', (c) => chunks.push(c))
                    response.on('end', () =>
                        resolve({
                            status: response.statusCode!,
                            body: Buffer.concat(chunks).toString(),
                            headers: response.headers
                        })
                    )
                }
            )
            request.on('error', reject)
            request.end(body)
        }
    )
}

function echoServer() {
    return new Promise<{ server: http.Server; port: number }>((resolve) => {
        const server = http.createServer((req, res) => {
            const chunks: Buffer[] = []
            req.on('data', (c) => chunks.push(c))
            req.on('end', () => {
                res.writeHead(200, { 'content-type': 'application/json', 'x-echo': '1' })
                res.end(
                    JSON.stringify({
                        method: req.method,
                        url: req.url,
                        body: Buffer.concat(chunks).toString(),
                        headers: req.headers
                    })
                )
            })
        })
        server.listen(0, '127.0.0.1', () =>
            resolve({ server, port: (server.address() as net.AddressInfo).port })
        )
    })
}

const setRules = async (rules: Rule[]) => {
    await vscode.workspace
        .getConfiguration('tapline')
        .update('rules', rules, vscode.ConfigurationTarget.Workspace)
    // The client pushes settings to the agent on the change event; give it a moment.
    await new Promise((r) => setTimeout(r, 400))
}

suite('Tapline end to end', function () {
    this.timeout(120000)
    let api: TaplineApi
    let origin: Awaited<ReturnType<typeof echoServer>>
    const transactions = () => [...api.client.transactions.values()]
    const find = (predicate: (t: Transaction) => boolean, what = 'transaction') =>
        until(() => transactions().find(predicate), 20000, what)
    const settled = (predicate: (t: Transaction) => boolean, what = 'transaction') =>
        find((t) => predicate(t) && t.state !== 'pending', what)

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension<TaplineApi>('fqix.tapline')
        assert.ok(extension, 'extension is installed')
        api = await extension.activate()
        origin = await echoServer()
    })

    suiteTeardown(async () => {
        await setRules([])
        origin?.server.close()
        if (api?.client.running) await api.client.stop()
    })

    test('activates and registers its commands', async () => {
        const commands = await vscode.commands.getCommands(true)
        for (const name of [
            'tapline.start',
            'tapline.stop',
            'tapline.openSequence',
            'tapline.compose',
            'tapline.rules',
            'tapline.stats',
            'tapline.exportHar',
            'tapline.configureMcp'
        ])
            assert.ok(commands.includes(name), `${name} is registered`)
    })

    test('starts capture on the configured port without a trusted certificate', async () => {
        await vscode.commands.executeCommand('tapline.start')
        await until(() => api.client.running, 30000, 'capture running')
        assert.equal(api.client.port, PROXY_PORT)
        assert.ok(api.client.mcpUrl?.endsWith(':3627/mcp'), 'MCP endpoint is served')
    })

    test('records a request sent through the proxy', async () => {
        const url = `http://127.0.0.1:${origin.port}/hello?x=1`
        const reply = await viaProxy(url, { method: 'POST', headers: { 'x-test': 'a' } }, 'ping')
        assert.equal(reply.status, 200)
        const t = await settled((t) => t.url === url)
        assert.equal(t.method, 'POST')
        assert.equal(t.status, 200)
        assert.equal(t.requestBody, 'ping')
        assert.equal(t.requestHeaders['x-test'], 'a')
        assert.equal(JSON.parse(t.responseBody).body, 'ping')
        assert.equal(t.responseHeaders['x-echo'], '1')
        assert.equal(t.sequence >= 1, true)
    })

    test('opens the traffic panel and its side panes', async () => {
        await vscode.commands.executeCommand('tapline.openSequence')
        await until(
            () =>
                vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => t.label === 'Tapline')),
            10000,
            'panel tab'
        )
        // Pane commands post to the webview; they must not throw even right after opening.
        await vscode.commands.executeCommand('tapline.rules')
        await vscode.commands.executeCommand('tapline.stats')
        await vscode.commands.executeCommand('tapline.compose')
    })

    test('copies a request as cURL', async () => {
        const t = transactions().find((t) => t.path === '/hello?x=1')!
        await vscode.commands.executeCommand('tapline.copyCurl', { kind: 'transaction', id: t.id })
        const text = await vscode.env.clipboard.readText()
        assert.ok(text.startsWith('curl -X POST'), text)
        assert.ok(text.includes("-H 'x-test: a'"), text)
    })

    test('replays and composes requests through the proxy', async () => {
        const original = transactions().find((t) => t.path === '/hello?x=1')!
        await vscode.commands.executeCommand('tapline.replay', {
            kind: 'transaction',
            id: original.id
        })
        const replayed = await settled((t) => t.replayOf === original.id, 'replay')
        assert.equal(JSON.parse(replayed.responseBody).body, 'ping')

        const url = `http://127.0.0.1:${origin.port}/composed`
        const sent = await api.client.compose({
            url,
            method: 'PUT',
            headers: { 'content-type': 'text/plain' },
            body: 'from composer'
        })
        assert.equal(sent.url, url)
        assert.equal(JSON.parse(sent.responseBody).body, 'from composer')
        assert.equal(JSON.parse(sent.responseBody).method, 'PUT')
    })

    test('blocks and mocks requests according to tapline.rules', async () => {
        await setRules([
            { id: 'e2e-block', enabled: true, kind: 'block', url: '*/admin*', status: 451 },
            {
                id: 'e2e-mock',
                name: 'e2e-mock',
                enabled: true,
                kind: 'mapLocal',
                url: '*/users.json',
                file: 'mocks/users.json'
            },
            {
                id: 'e2e-rewrite',
                enabled: true,
                kind: 'rewrite',
                url: '*/rewrite',
                request: { headers: { 'x-added': 'yes' } },
                response: { status: 418 }
            }
        ])
        const blocked = await viaProxy(`http://127.0.0.1:${origin.port}/admin/x`)
        assert.equal(blocked.status, 451)
        const mocked = await viaProxy(`http://127.0.0.1:${origin.port}/users.json`)
        assert.equal(mocked.status, 200)
        assert.equal(mocked.body, '[{"id":1,"name":"mock"}]')
        assert.equal(mocked.headers['content-type'], 'application/json')
        const rewritten = await viaProxy(`http://127.0.0.1:${origin.port}/rewrite`)
        assert.equal(rewritten.status, 418)
        assert.equal(JSON.parse(rewritten.body).headers['x-added'], 'yes')
        const t = await settled((t) => t.path === '/users.json')
        assert.equal(t.local, true)
        assert.deepEqual(t.rules, ['e2e-mock'])
    })

    test('holds a request at a breakpoint until it is resumed with edits', async () => {
        await setRules([
            {
                id: 'e2e-bp',
                enabled: true,
                kind: 'breakpoint',
                url: '*/held',
                request: true,
                response: false
            }
        ])
        const url = `http://127.0.0.1:${origin.port}/held`
        const reply = viaProxy(url, { method: 'POST' }, 'original')
        const held = await find((t) => t.url === url && t.paused === 'request', 'breakpoint')
        assert.equal(held.requestBody, 'original')
        await api.client.resume(held.id, {
            headers: { ...held.requestHeaders, 'x-edited': '1' },
            body: 'edited'
        })
        const result = await reply
        assert.equal(JSON.parse(result.body).body, 'edited')
        assert.equal(JSON.parse(result.body).headers['x-edited'], '1')
        const done = await settled((t) => t.id === held.id)
        assert.equal(done.paused, undefined)
        assert.equal(done.requestBody, 'edited')
    })

    test('aborts a held request', async () => {
        const url = `http://127.0.0.1:${origin.port}/held`
        const reply = viaProxy(url)
        const held = await find(
            (t) => t.url === url && t.method === 'GET' && t.paused === 'request',
            'breakpoint'
        )
        await api.client.abort(held.id)
        assert.equal((await reply).status, 502)
        const done = await settled((t) => t.id === held.id)
        assert.equal(done.state, 'error')
    })

    test('clears the session and stops capture', async () => {
        await setRules([])
        await vscode.commands.executeCommand('tapline.clear')
        await until(() => transactions().length === 0, 10000, 'cleared')
        await vscode.commands.executeCommand('tapline.stop')
        await until(() => !api.client.running, 10000, 'stopped')
    })
})
