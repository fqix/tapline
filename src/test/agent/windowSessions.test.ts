import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'
import { createInterface } from 'node:readline'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { pipePath } from '../../agent/paths'
import { defaultSettings } from '../../shared/model'
import { CORE, freePort, httpServer, viaProxy } from '../helpers/helpers'

const describeCore = existsSync(CORE) ? describe : describe.skip

describeCore('window sessions', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tapline-windows-'))
    const script = join(directory, 'agent.js')
    let agent: ChildProcess
    let exited: Promise<number | null>
    const peers: Peer[] = []
    class Peer {
        socket!: net.Socket
        events: any[] = []
        sequence = 0
        pending = new Map<number, (message: any) => void>()
        async connect() {
            this.socket = net.connect(pipePath(directory))
            await new Promise<void>((resolve, reject) => {
                this.socket.once('connect', resolve)
                this.socket.once('error', reject)
            })
            createInterface({ input: this.socket }).on('line', (line) => {
                const m = JSON.parse(line)
                if (m.event) this.events.push(m.event)
                else {
                    this.pending.get(m.id)?.(m)
                    this.pending.delete(m.id)
                }
            })
            peers.push(this)
            return this
        }
        call(method: string, args: object = {}): Promise<any> {
            const id = ++this.sequence
            return new Promise((resolve, reject) => {
                this.pending.set(id, (m) =>
                    m.error ? reject(new Error(m.error)) : resolve(m.result)
                )
                this.socket.write(JSON.stringify({ id, method, ...args }) + '\n')
            })
        }
    }

    beforeEach(async () => {
        await build({
            entryPoints: [join(__dirname, '../../agent/main.ts')],
            bundle: true,
            platform: 'node',
            format: 'cjs',
            outfile: script,
            logLevel: 'silent'
        })
        agent = spawn(process.execPath, [script, directory, CORE], {
            stdio: ['ignore', 'pipe', 'pipe']
        })
        exited = new Promise((resolve) => agent.once('exit', resolve))
        await new Promise<void>((resolve) =>
            createInterface({ input: agent.stdout! }).once('line', () => resolve())
        )
    })
    afterEach(async () => {
        for (const peer of peers) peer.socket.destroy()
        if (agent.exitCode === null && agent.signalCode === null) agent.kill()
        await exited
        rmSync(directory, { recursive: true, force: true })
    })

    it('isolates concurrent windows on unique OS-bound ports with one core and one MCP endpoint', async () => {
        const windows = await Promise.all([
            new Peer().connect(),
            new Peer().connect(),
            new Peer().connect()
        ])
        const mcpPort = await freePort()
        const settings = { ...defaultSettings, port: 0, mcpPort }
        const hellos = await Promise.all(
            windows.map((w, i) =>
                w.call('hello', {
                    sessionId: `window-${i}`,
                    workspaceName: 'same-workspace',
                    settings
                })
            )
        )
        expect(new Set(hellos.map((s) => s.certificatePath)).size).toBe(1)
        const started = await Promise.all(windows.map((w) => w.call('start')))
        expect(new Set(started.map((s) => s.port)).size).toBe(windows.length)
        expect(started.every((s) => s.port > 0)).toBe(true)
        expect(new Set(started.map((s) => s.corePid)).size).toBe(1)
        expect(started[0].corePid).toBeGreaterThan(0)
        const origin = await httpServer((req, res) => res.end(req.url))
        const mcp = new Client({ name: 'test', version: '0' })
        try {
            await Promise.all(
                started.map((s, i) =>
                    viaProxy(s.port, `http://127.0.0.1:${origin.port}/window-${i}`)
                )
            )
            for (const [i, w] of windows.entries()) {
                const snapshot = await w.call('snapshot')
                expect(snapshot.transactions).toHaveLength(1)
                expect(snapshot.transactions[0].path).toBe(`/window-${i}`)
                expect(
                    w.events
                        .filter((e) => e.type === 'transaction')
                        .every((e) => e.transaction.path === `/window-${i}`)
                ).toBe(true)
            }
            await mcp.connect(
                new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`))
            )
            const sessions: any = await mcp.callTool({ name: 'list_sessions', arguments: {} })
            expect(JSON.parse(sessions.content[0].text)).toHaveLength(3)
            const ambiguous: any = await mcp.callTool({ name: 'clear', arguments: {} })
            expect(ambiguous.isError).toBe(true)
            const listings: any[] = await Promise.all(
                windows.map((_, i) =>
                    mcp.callTool({ name: 'list_requests', arguments: { sessionId: `window-${i}` } })
                )
            )
            listings.forEach((r, i) => {
                expect(r.isError).not.toBe(true)
                expect(r.content[0].text).toContain(`/window-${i}`)
                expect(r.content[0].text).not.toContain(`/window-${(i + 1) % 3}`)
            })
            const cleared: any = await mcp.callTool({
                name: 'clear',
                arguments: { sessionId: 'window-0' }
            })
            expect(cleared.isError).not.toBe(true)
            expect((await windows[0].call('snapshot')).transactions).toHaveLength(0)
            expect((await windows[1].call('snapshot')).transactions).toHaveLength(1)
            const unfinished = net.connect(started[0].port, '127.0.0.1')
            const unfinishedClosed = new Promise<void>((resolve) =>
                unfinished.once('close', () => resolve())
            )
            await new Promise<void>((resolve) => unfinished.once('connect', resolve))
            await windows[0].call('stop')
            await unfinishedClosed
            const restarted = await windows[0].call('start')
            expect(restarted.corePid).toBe(started[0].corePid)
            expect([started[1].port, started[2].port]).not.toContain(restarted.port)
            expect(
                (await viaProxy(restarted.port, `http://127.0.0.1:${origin.port}/restarted`)).body
            ).toBe('/restarted')
            expect((await windows[1].call('state')).corePid).toBe(started[0].corePid)
            expect(
                (await viaProxy(started[1].port, `http://127.0.0.1:${origin.port}/still-running`))
                    .body
            ).toBe('/still-running')
            // A preferred port that another window holds falls back to a free one.
            const conflict = await new Peer().connect()
            await conflict.call('hello', { settings: { ...settings, port: started[1].port } })
            const fallback = await conflict.call('start')
            expect(fallback.running).toBe(true)
            expect(fallback.port).toBeGreaterThan(0)
            expect(fallback.port).not.toBe(started[1].port)
            conflict.socket.destroy()
            expect((await windows[1].call('state')).corePid).toBe(started[0].corePid)
            windows[1].socket.destroy()
            await new Promise((r) => setTimeout(r, 3500))
            await expect(
                viaProxy(started[1].port, `http://127.0.0.1:${origin.port}/closed`)
            ).rejects.toThrow()
            expect((await windows[2].call('state')).running).toBe(true)
            for (const w of windows) w.socket.destroy()
            expect(await exited).toBe(0)
            expect(() => process.kill(started[0].corePid, 0)).toThrow()
            // MCP connection remains open but must not keep the agent alive.
            await expect(
                viaProxy(started[2].port, `http://127.0.0.1:${origin.port}/closed`)
            ).rejects.toThrow()
        } finally {
            for (const w of windows) w.socket.destroy()
            agent.kill()
            await mcp.close()
            await new Promise<void>((resolve) => origin.server.close(() => resolve()))
        }
    }, 30000)

    it('shuts down sing-box after abrupt loss of its managing process', async () => {
        const peer = await new Peer().connect()
        await peer.call('hello', {
            sessionId: 'crash-window',
            settings: { ...defaultSettings, port: 0, mcpPort: 0 }
        })
        const state = await peer.call('start')
        agent.kill('SIGKILL')
        await exited
        let alive = true
        for (let i = 0; i < 40 && alive; i++) {
            await new Promise((resolve) => setTimeout(resolve, 100))
            try {
                process.kill(state.corePid, 0)
            } catch {
                alive = false
            }
        }
        expect(alive).toBe(false)
        await expect(viaProxy(state.port, 'http://127.0.0.1:1/closed')).rejects.toThrow()
    })

    it('recovers an unexpectedly exited core without reusing another window inlet', async () => {
        const a = await new Peer().connect()
        const b = await new Peer().connect()
        const settings = { ...defaultSettings, port: 0, mcpPort: 0 }
        await a.call('hello', { sessionId: 'recover-a', settings })
        await b.call('hello', { sessionId: 'recover-b', settings })
        const original = await a.call('start')
        await b.call('start')
        process.kill(original.corePid, 'SIGKILL')
        for (let i = 0; i < 40 && (await a.call('state')).running; i++)
            await new Promise((resolve) => setTimeout(resolve, 100))
        expect((await a.call('state')).running).toBe(false)
        expect((await b.call('state')).running).toBe(false)
        const [one, two] = await Promise.all([a.call('start'), b.call('start')])
        expect(one.corePid).toBe(two.corePid)
        expect(one.corePid).not.toBe(original.corePid)
        expect(one.port).not.toBe(two.port)
    })

    it('keeps the preferred port across starts and applies live changes on restart', async () => {
        const peer = await new Peer().connect()
        const port = await freePort()
        const settings = { ...defaultSettings, port, mcpPort: 0 }
        const hello = await peer.call('hello', { sessionId: 'preferred-window', settings })
        expect(hello.port).toBe(0)
        expect((await peer.call('start')).port).toBe(port)
        expect((await peer.call('stop')).port).toBe(0)
        expect((await peer.call('start')).port).toBe(port)

        const nextPort = await freePort()
        expect(
            (await peer.call('settings', { settings: { ...settings, port: nextPort } })).port
        ).toBe(port)
        expect((await peer.call('start')).port).toBe(port)
        await peer.call('stop')
        expect((await peer.call('start')).port).toBe(nextPort)
    })

    it('attempts preferred port and falls back to dynamic port when occupied', async () => {
        const blocker = net.createServer().listen(0, '127.0.0.1')
        await new Promise<void>((resolve) => blocker.once('listening', resolve))
        const busyPort = (blocker.address() as net.AddressInfo).port
        try {
            const peer = await new Peer().connect()
            await peer.call('hello', {
                sessionId: 'fallback-window',
                settings: { ...defaultSettings, port: busyPort, mcpPort: 0 }
            })
            const state = await peer.call('start')
            expect(state.port).toBeGreaterThan(0)
            expect(state.port).not.toBe(busyPort)
            const logs = await peer.call('logs')
            expect(
                logs.some((entry: { message: string }) =>
                    entry.message.includes(`Port ${busyPort} is unavailable`)
                )
            ).toBe(true)
            await new Promise<void>((resolve, reject) =>
                blocker.close((error) => (error ? reject(error) : resolve()))
            )
            await peer.call('stop')
            expect((await peer.call('start')).port).toBe(busyPort)
        } finally {
            if (blocker.listening) blocker.close()
        }
    })
})
