// End-to-end: the packaged extension inside a real VS Code, driving a real capture agent
// and sing-box core. Requests go through the proxy from this test process; assertions
// read the extension's transaction mirror through the API `activate` returns.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { X509Certificate } from 'node:crypto'
import { httpsServer, selfSigned, viaProxyTLS } from '../test/helpers/helpers'
import { promisify } from 'node:util'
import * as vscode from 'vscode'
import type { TaplineApi } from '../extension'
import { defaultSettings, type Rule, type Transaction } from '../shared/model'

/** The window's proxy port is OS-assigned; read after capture starts. */
let proxyPort = 0

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
                    port: proxyPort,
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

function viaProxyConnect(host: string, port: number) {
    return new Promise<net.Socket>((resolve, reject) => {
        const request = http.request({
            host: '127.0.0.1',
            port: proxyPort,
            method: 'CONNECT',
            path: `${host}:${port}`
        })
        request.on('connect', (_res, socket) => resolve(socket))
        request.on('error', reject)
        request.end()
    })
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
    await vscode.extensions
        .getExtension<TaplineApi>('fqix.tapline')!
        .exports.client.saveRules(rules)
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
            'tapline.settings',
            'tapline.stats',
            'tapline.exportHar',
            'tapline.compare',
            'tapline.compareOriginal',
            'tapline.copyResponse',
            'tapline.toggleMark',
            'tapline.editNote',
            'tapline.configureMcp'
        ])
            assert.ok(commands.includes(name), `${name} is registered`)
    })

    test('prepares the root certificate before capture or OS trust operations', async () => {
        await api.client.connect()
        assert.equal(api.client.running, false)
        assert.ok(existsSync(api.client.certificatePath), 'CA exists before capture starts')
        assert.ok(
            existsSync(api.client.truststorePath),
            'Java trust store exists before capture starts'
        )
    })

    test('starts capture on a free port without a trusted certificate', async () => {
        await vscode.commands.executeCommand('tapline.start')
        await until(() => api.client.running, 30000, 'capture running')
        proxyPort = api.client.port
        assert.ok(proxyPort > 0, 'proxy port assigned')
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

    test('tunnels CONNECT requests when host is not intercepted', async () => {
        const socket = await viaProxyConnect('127.0.0.1', origin.port)
        const data = await new Promise<string>((resolve, reject) => {
            const chunks: Buffer[] = []
            socket.setTimeout(10000, () =>
                socket.destroy(new Error('CONNECT tunnel did not close'))
            )
            socket.on('error', reject)
            socket.on('data', (c) => chunks.push(c))
            socket.on('end', () => resolve(Buffer.concat(chunks).toString()))
            socket.write('GET /via-tunnel HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
        })
        assert.ok(data.includes('200 OK'))
        const t = await settled((t) => t.path === `127.0.0.1:${origin.port}`)
        assert.equal(t.method, 'CONNECT')
        assert.equal(t.tls, false)
    })

    test('opens immutable request comparisons in the native diff editor', async () => {
        const url = `http://127.0.0.1:${origin.port}/diff`
        await viaProxy(url, { method: 'POST' }, 'before')
        const left = await settled((t) => t.url === url && t.requestBody === 'before')
        await viaProxy(url, { method: 'POST' }, 'after')
        const right = await settled((t) => t.url === url && t.requestBody === 'after')
        const activeGroup = vscode.window.tabGroups.activeTabGroup
        const groupCount = vscode.window.tabGroups.all.length
        // Reverse the selection order: the earlier sequence must still be on the left.
        await vscode.commands.executeCommand('tapline.compare', { ids: [right.id, left.id] })
        const tab = await until(
            () =>
                vscode.window.tabGroups.all
                    .flatMap((g) => g.tabs)
                    .find(
                        (t) =>
                            t.input instanceof vscode.TabInputTextDiff &&
                            t.input.original.scheme === 'tapline-diff'
                    ),
            10000,
            'comparison editor'
        )
        const input = tab.input as vscode.TabInputTextDiff
        assert.equal(
            vscode.window.tabGroups.all.length,
            groupCount,
            'Diff must not split the editor group'
        )
        assert.equal(tab.group, activeGroup)
        const original = await vscode.workspace.openTextDocument(input.original)
        const modified = await vscode.workspace.openTextDocument(input.modified)
        assert.ok(original.getText().includes('before'))
        assert.ok(modified.getText().includes('after'))
        const snapshot = original.getText()
        await api.client.delete([left.id, right.id])
        assert.equal(original.getText(), snapshot)
        assert.equal((await vscode.workspace.openTextDocument(input.original)).getText(), snapshot)
        await vscode.window.tabGroups.close(tab)
    })

    test('compares replays with their original requests', async () => {
        const url = `http://127.0.0.1:${origin.port}/compare-original`
        await viaProxy(url)
        const original = await settled((t) => t.url === url)
        const replay = await api.client.compose({
            url,
            method: 'GET',
            headers: {},
            body: '',
            replayOf: original.id
        })
        await settled((t) => t.id === replay.id)
        await vscode.commands.executeCommand('tapline.compareOriginal', { id: replay.id })
        const tab = await until(() =>
            vscode.window.tabGroups.all
                .flatMap((g) => g.tabs)
                .find(
                    (t) =>
                        t.input instanceof vscode.TabInputTextDiff &&
                        t.input.original.path.endsWith(`/request-${original.sequence}.taplinehttp`)
                )
        )
        assert.ok(
            (tab.input as vscode.TabInputTextDiff).modified.path.endsWith(
                `/request-${replay.sequence}.taplinehttp`
            )
        )
        await vscode.window.tabGroups.close(tab)
    })

    test('shares request notes and markers in the capture session', async () => {
        const url = `http://127.0.0.1:${origin.port}/annotated`
        await viaProxy(url)
        const original = await settled((t) => t.url === url)
        await api.client.call('annotate', { transaction: original.id, note: '检查登录态' })
        await vscode.commands.executeCommand('tapline.toggleMark', { id: original.id })
        await until(() => api.client.transactions.get(original.id)?.marked)
        assert.equal(api.client.transactions.get(original.id)?.note, '检查登录态')
        const snapshot = await api.client.call('snapshot', {})
        assert.equal(snapshot.transactions.find((t) => t.id === original.id)?.note, '检查登录态')
        await vscode.commands.executeCommand('tapline.toggleMark', { id: original.id })
        await until(() => api.client.transactions.get(original.id)?.marked === false)
        await api.client.call('annotate', { transaction: original.id, note: '' })
        await until(() => api.client.transactions.get(original.id)?.note === undefined)
    })

    test('copies the retained response body', async () => {
        const url = `http://127.0.0.1:${origin.port}/copy-response`
        await viaProxy(url)
        const original = await settled((t) => t.url === url)
        await vscode.commands.executeCommand('tapline.copyResponse', { id: original.id })
        assert.equal(await vscode.env.clipboard.readText(), original.responseBody)
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

    test('keeps Settings in a separate reusable tab from traffic', async () => {
        const tabs = () => vscode.window.tabGroups.all.flatMap((group) => group.tabs)
        const settingsTabs = () =>
            tabs().filter(
                (tab) =>
                    tab.input instanceof vscode.TabInputWebview &&
                    tab.input.viewType.includes('tapline.settings.panel')
            )
        await vscode.commands.executeCommand('tapline.settings')
        await until(() => settingsTabs().length === 1, 10000, 'standalone Settings tab')
        assert.ok(
            tabs().some((tab) => tab.label === 'Tapline'),
            'traffic remains open'
        )
        await vscode.commands.executeCommand('tapline.settings')
        assert.equal(settingsTabs().length, 1, 'reuses Settings tab')
        await vscode.window.tabGroups.close(settingsTabs())
        await until(() => settingsTabs().length === 0, 10000, 'Settings closes')
        assert.ok(
            tabs().some((tab) => tab.label === 'Tapline'),
            'closing Settings preserves traffic'
        )
        await vscode.commands.executeCommand('tapline.settings')
        await until(() => settingsTabs().length === 1, 10000, 'Settings reopens')
        await vscode.window.tabGroups.close(settingsTabs())
    })

    test('decrypts and records HTTP/3 over the SOCKS5 UDP relay', async () => {
        const wasRunning = api.client.running
        const url = 'https://localhost:18443/tapline-e2e-h3?source=quic'
        const body = '{"protocol":"h3","message":"你好 Tapline"}'
        try {
            // Scope TLS inspection to this test via the agent API. Trust the CA in
            // the probe only, without changing the machine's certificate store.
            await api.client.call('settings', {
                settings: {
                    ...defaultSettings,
                    port: proxyPort,
                    mcpPort: 3627,
                    sslHosts: ['localhost'],
                    rules: [
                        {
                            id: 'e2e-h3',
                            name: 'e2e-h3',
                            enabled: true,
                            kind: 'mapLocal',
                            url,
                            status: 201,
                            contentType: 'application/json',
                            body
                        }
                    ]
                }
            })
            await api.client.start()
            // A local rule keeps the test offline while exercising real QUIC,
            // TLS verification, decryption, body streaming and the client mirror.
            const probe = join(
                __dirname,
                '..',
                process.platform === 'win32' ? 'h3-probe.exe' : 'h3-probe'
            )
            const { stdout } = await promisify(execFile)(
                probe,
                [
                    '-proxy',
                    `127.0.0.1:${proxyPort}`,
                    '-ca',
                    api.client.certificatePath,
                    '-timeout',
                    '15s',
                    url
                ],
                { timeout: 25000, windowsHide: true }
            ).catch(async (error) => {
                const logs = await api.client.call('logs', {})
                throw new Error(
                    `${error.message}\n${error.stdout ?? ''}\n${error.stderr ?? ''}\n${logs.map((log) => log.message).join('\n')}`
                )
            })
            assert.match(stdout, /HTTP\/3\.0 201\s+/)
            assert.ok(stdout.includes(`${Buffer.byteLength(body)} bytes`), stdout)

            const t = await settled((t) => t.url === url, 'HTTP/3 transaction')
            assert.equal(t.state, 'completed', t.error)
            assert.equal(t.httpVersion, '3.0')
            assert.equal(t.tls, true)
            assert.equal(t.scheme, 'https')
            assert.equal(t.method, 'GET')
            assert.equal(t.status, 201)
            assert.ok(t.requestHeaders['user-agent'])
            assert.equal(t.responseHeaders['content-type'], 'application/json')
            assert.equal(t.responseBody, body)
            assert.equal(t.responseBytes, Buffer.byteLength(body))
            assert.equal(t.local, true)
            assert.deepEqual(t.rules, ['e2e-h3'])
        } finally {
            await api.client.pushSettings()
            if (!wasRunning) await api.client.stop()
        }
    })

    test('switches TLS policy without retrying pinned requests or remembering failures', async () => {
        const identity = selfSigned()
        const fingerprint = new X509Certificate(identity.cert).fingerprint256
        let requests = 0
        const upstream = await httpsServer(identity, (req, res) => {
            requests++
            const chunks: Buffer[] = []
            req.on('data', (chunk) => chunks.push(chunk))
            req.on('end', () => res.end(Buffer.concat(chunks)))
        })
        const root = readFileSync(api.client.certificatePath, 'utf8')
        const url = `https://127.0.0.1:${upstream.port}/pinned-payment`
        const configure = (sslHosts = defaultSettings.sslHosts, sslNoHosts: string[] = []) =>
            api.client.call('settings', {
                settings: {
                    ...defaultSettings,
                    port: proxyPort,
                    mcpPort: 3627,
                    sslHosts,
                    sslNoHosts,
                    insecureUpstream: true
                }
            })
        const pinned = () =>
            viaProxyTLS(
                proxyPort,
                url,
                root + '\n' + identity.cert,
                {
                    method: 'POST',
                    checkServerIdentity: (_host, certificate) =>
                        certificate.fingerprint256 === fingerprint
                            ? undefined
                            : new Error('Pinned certificate mismatch')
                },
                'send-once'
            )
        try {
            await configure()
            assert.equal(
                (await viaProxyTLS(proxyPort, url, root, { method: 'POST' }, 'decrypted')).body,
                'decrypted'
            )
            const decrypted = await settled((t) => t.url === url)
            assert.equal(decrypted.scheme, 'https')
            assert.equal(decrypted.tls, true)
            assert.equal(decrypted.requestBody, 'decrypted')
            for (let attempt = 0; attempt < 2; attempt++)
                await assert.rejects(pinned(), /Pinned certificate mismatch/)
            assert.equal(requests, 1, 'pinning failures must not retry the POST upstream')

            for (const [hosts, excluded] of [
                [[], []],
                [['*'], ['127.0.0.1']],
                [['*', '!127.0.0.1'], []]
            ] as [string[], string[]][]) {
                await configure(hosts, excluded)
                const before = new Set(transactions().map((t) => t.id))
                assert.deepEqual(await pinned(), { status: 200, body: 'send-once' })
                const tunnel = await settled(
                    (t) => !before.has(t.id) && t.path === `127.0.0.1:${upstream.port}`
                )
                assert.equal(tunnel.scheme, 'connect')
                assert.equal(tunnel.method, 'CONNECT')
                assert.equal(tunnel.tls, false)
                assert.equal(tunnel.state, 'completed', tunnel.error)
                assert.equal(tunnel.requestBody, '')
                assert.equal(tunnel.responseBody, '')
                assert.ok(tunnel.requestBytes > 0)
                assert.ok(tunnel.responseBytes > 0)
            }
            assert.equal(requests, 4, 'each successful request reaches the origin exactly once')
            await configure()
            await assert.rejects(pinned(), /Pinned certificate mismatch/)
            assert.equal(requests, 4, 're-enabling SSL Proxying restores pinning rejection')
        } finally {
            upstream.server.closeAllConnections()
            upstream.server.close()
            await api.client.pushSettings()
        }
    })

    test('composes HTTPS in passthrough mode without changing other clients’ TLS policy', async () => {
        const identity = selfSigned()
        const upstream = await httpsServer(identity, (_req, res) => res.end('private response'))
        const url = `https://127.0.0.1:${upstream.port}/compose-tls`
        try {
            await api.client.call('settings', {
                settings: {
                    ...defaultSettings,
                    port: proxyPort,
                    mcpPort: 3627,
                    sslHosts: [],
                    insecureUpstream: true
                }
            })
            const composed = await api.client.compose({ url, method: 'GET', headers: {}, body: '' })
            assert.equal(composed.status, 200)
            assert.equal(composed.responseBody, 'private response')
            assert.equal(composed.tls, true)
            // Trust only the origin: an accidental global interception override fails TLS.
            assert.equal(
                (await viaProxyTLS(proxyPort, url, identity.cert)).body,
                'private response'
            )
            const tunnel = await settled(
                (t) => t.scheme === 'connect' && t.path === `127.0.0.1:${upstream.port}`
            )
            assert.equal(tunnel.responseBody, '')
        } finally {
            upstream.server.closeAllConnections()
            upstream.server.close()
            await api.client.pushSettings()
        }
    })

    test('passes an unparseable legacy certificate through without probing or duplicating the POST', async () => {
        // OpenSSL accepts negative serials; Go's certificate parser rejects them.
        const identity = selfSigned('80')
        let connections = 0
        let requests = 0
        const upstream = await httpsServer(identity, (req, res) => {
            requests++
            const chunks: Buffer[] = []
            req.on('data', (chunk) => chunks.push(chunk))
            req.on('end', () => res.end(Buffer.concat(chunks)))
        })
        upstream.server.on('connection', () => connections++)
        try {
            await api.client.call('settings', {
                settings: { ...defaultSettings, port: proxyPort, mcpPort: 3627, sslHosts: [] }
            })
            const reply = await viaProxyTLS(
                proxyPort,
                `https://127.0.0.1:${upstream.port}/legacy`,
                identity.cert,
                { method: 'POST' },
                'legacy-once'
            )
            assert.deepEqual(reply, { status: 200, body: 'legacy-once' })
            const tunnel = await settled(
                (t) => t.scheme === 'connect' && t.path === `127.0.0.1:${upstream.port}`
            )
            assert.equal(tunnel.state, 'completed', tunnel.error)
            assert.equal(tunnel.requestBody, '')
            assert.equal(tunnel.responseBody, '')
            assert.equal(connections, 1, 'passthrough must not preflight TLS')
            assert.equal(requests, 1)
        } finally {
            upstream.server.closeAllConnections()
            upstream.server.close()
            await api.client.pushSettings()
        }
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
