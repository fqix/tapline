import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { build } from 'esbuild'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { X509Certificate, createPublicKey } from 'node:crypto'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { pipePath } from '../../agent/paths'
import type { Message } from '../../agent/protocol'
import { defaultSettings } from '../../shared/model'
import { CORE, freePort, httpServer, viaProxy } from '../helpers/helpers'

const describeCore = existsSync(CORE) ? describe : describe.skip

class TestClient {
    socket!: net.Socket
    events: any[] = []
    private sequence = 0
    private pending = new Map<number, (m: Message) => void>()
    async connect(path: string) {
        this.socket = net.connect(path)
        await new Promise<void>((resolve, reject) => {
            this.socket.once('connect', resolve)
            this.socket.once('error', reject)
        })
        createInterface({ input: this.socket }).on('line', (line) => {
            const message = JSON.parse(line) as Message
            if ('event' in message) this.events.push(message.event)
            else this.pending.get(message.id)?.(message)
        })
    }
    call(method: string, args: Record<string, unknown> = {}): Promise<any> {
        const id = ++this.sequence
        return new Promise((resolve, reject) => {
            this.pending.set(id, (m) => {
                if ('error' in m) reject(new Error(m.error))
                else if ('result' in m) resolve(m.result)
            })
            this.socket.write(JSON.stringify({ id, method, ...args }) + '\n')
        })
    }
}

describeCore('shared agent', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tapline-agent-'))
    const script = join(directory, 'agent.js')
    let agent: ChildProcess
    let exited: Promise<number | null>

    beforeAll(async () => {
        await build({
            entryPoints: [join(__dirname, '../../agent/main.ts')],
            bundle: true,
            platform: 'node',
            format: 'cjs',
            outfile: script,
            define: { 'process.env.TAPLINE_VERSION': JSON.stringify('0.10.0-test') },
            logLevel: 'silent'
        })
        agent = spawn(process.execPath, [script, directory, CORE], {
            stdio: ['ignore', 'pipe', 'pipe']
        })
        exited = new Promise((resolve) => agent.once('exit', resolve))
        await new Promise<void>((resolve) =>
            createInterface({ input: agent.stdout! }).once('line', () => resolve())
        )
    }, 60000)
    afterAll(() => agent?.kill())

    it('shares one capture between clients and exits after the last one leaves', async () => {
        const path = pipePath(directory)
        const a = new TestClient()
        const b = new TestClient()
        await a.connect(path)
        await b.connect(path)
        const settings = { ...defaultSettings, mcpPort: await freePort() }
        const hello = await a.call('hello', { settings })
        expect(hello.clients).toBe(1)
        expect(hello.mcpPort).toBe(settings.mcpPort)
        // A fresh installation must be able to inspect/install the CA before capture.
        expect(hello.running).toBe(false)
        const certificate = readFileSync(hello.certificatePath, 'utf8')
        const root = new X509Certificate(certificate)
        expect(root.ca).toBe(true)
        expect(
            root.publicKey.equals(createPublicKey(readFileSync(join(directory, 'ca.key'))))
        ).toBe(true)
        expect(existsSync(hello.truststorePath)).toBe(true)
        await expect(b.call('state')).rejects.toThrow('hello first')
        await b.call('hello', { settings })
        expect(readFileSync(hello.certificatePath, 'utf8')).toBe(certificate)
        const state = await a.call('start')
        expect(state.running).toBe(true)
        expect(state.port).toBeGreaterThan(0)
        expect(readFileSync(hello.certificatePath, 'utf8')).toBe(certificate)
        // The MCP endpoint serves the same engine over Streamable HTTP.
        const mcp = new Client({ name: 'test', version: '0' })
        await mcp.connect(
            new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${settings.mcpPort}/mcp`))
        )
        const status = (await mcp.callTool({ name: 'status', arguments: {} })) as {
            content: { text: string }[]
        }
        expect(JSON.parse(status.content[0].text)).toMatchObject({
            running: true,
            proxy: `http://127.0.0.1:${state.port}`
        })
        await mcp.close()
        // b learns about a's start through the event stream.
        await new Promise((r) => setTimeout(r, 100))
        expect(b.events.some((e) => e.type === 'state' && e.state.running)).toBe(true)
        expect((await b.call('state')).running).toBe(true)
        a.socket.destroy()
        await new Promise((r) => setTimeout(r, 200))
        expect((await b.call('state')).clients).toBe(1)
        b.socket.destroy()
        // Grace period is 3 s; sing-box must be gone with the agent.
        expect(await exited).toBe(0)
    }, 20000)

    it('resumes a breakpoint over the protocol (transaction id must not clash with the message id)', async () => {
        const again = spawn(process.execPath, [script, directory, CORE], {
            stdio: ['ignore', 'pipe', 'pipe']
        })
        await new Promise<void>((resolve) =>
            createInterface({ input: again.stdout! }).once('line', () => resolve())
        )
        const origin = await httpServer((_req, res) => res.end('ok'))
        const client = new TestClient()
        try {
            await client.connect(pipePath(directory))
            await client.call('hello', {
                settings: {
                    ...defaultSettings,
                    mcpPort: 0,
                    rules: [
                        { id: 'bp', enabled: true, kind: 'breakpoint', url: '*', request: true }
                    ]
                }
            })
            const { port } = await client.call('start')
            const reply = viaProxy(port, `http://127.0.0.1:${origin.port}/held`)
            let held: { id: string } | undefined
            for (let i = 0; i < 100 && !held; i++) {
                await new Promise((r) => setTimeout(r, 50))
                held = client.events.find(
                    (e) => e.type === 'transaction' && e.transaction.paused === 'request'
                )?.transaction
            }
            expect(held).toBeDefined()
            const state = await Promise.race([
                client.call('resume', { transaction: held!.id, edit: {} }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('resume hung')), 5000))
            ])
            expect(state.running).toBe(true)
            expect((await reply).body).toBe('ok')
            await expect(client.call('abort', { transaction: held!.id })).rejects.toThrow(
                'not paused'
            )
        } finally {
            client.socket.destroy()
            origin.server.close()
            again.kill()
        }
    }, 30000)

    it('prepares a new core before retiring the old agent and promoting its endpoint', async () => {
        const launch = async (path?: string) => {
            const process = spawn(
                globalThis.process.execPath,
                [script, directory, CORE, ...(path ? [path] : [])],
                {
                    stdio: ['ignore', 'pipe', 'pipe']
                }
            )
            await new Promise<void>((resolve) =>
                createInterface({ input: process.stdout! }).once('line', () => resolve())
            )
            return process
        }
        const previous = await launch()
        const previousGone = new Promise((resolve) => previous.once('exit', resolve))
        const stagedPath = pipePath(directory + '-staged')
        let replacement: ChildProcess | undefined
        const old = new TestClient()
        const next = new TestClient()
        const reconnected = new TestClient()
        try {
            await old.connect(pipePath(directory))
            const settings = { ...defaultSettings, mcpPort: 0 }
            await old.call('hello', { settings })
            const oldState = await old.call('start')
            replacement = await launch(stagedPath)
            await next.connect(stagedPath)
            await next.call('hello', { settings })
            const newState = await next.call('start')
            expect(newState.running).toBe(true)
            expect(newState.corePid).not.toBe(oldState.corePid)
            expect((await old.call('state')).running).toBe(true)
            await old.call('shutdown')
            await previousGone
            await next.call('promote')
            await reconnected.connect(pipePath(directory))
            const active = await reconnected.call('hello', { settings })
            expect(active.pid).toBe(replacement.pid)
            expect(active.corePid).toBe(newState.corePid)
            expect(active.running).toBe(true)
        } finally {
            old.socket?.destroy()
            next.socket?.destroy()
            reconnected.socket?.destroy()
            previous.kill()
            if (replacement) {
                const gone = new Promise((resolve) => replacement!.once('exit', resolve))
                replacement.kill()
                await gone
            }
        }
    }, 30000)

    it('reports its build and exits on shutdown so a newer build can replace it', async () => {
        const again = spawn(process.execPath, [script, directory, CORE], {
            stdio: ['ignore', 'pipe', 'pipe']
        })
        const gone = new Promise<number | null>((resolve) => again.once('exit', resolve))
        await new Promise<void>((resolve) =>
            createInterface({ input: again.stdout! }).once('line', () => resolve())
        )
        const path = pipePath(directory)
        const client = new TestClient()
        await client.connect(path)
        const hello = await client.call('hello', {
            settings: { ...defaultSettings, mcpPort: 0 }
        })
        expect(hello.build).toBeTypeOf('number')
        expect(hello.agentVersion).toBe('0.10.0-test')
        expect((await client.call('shutdown')).pid).toBe(again.pid)
        expect(await gone).toBe(0)
        if (process.platform !== 'win32') expect(existsSync(path)).toBe(false)
    }, 20000)
})
