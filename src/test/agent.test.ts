import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { build } from 'esbuild'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { pipePath } from '../agent/paths'
import type { Message } from '../agent/protocol'
import { defaultSettings } from '../shared/model'
import { CORE, freePort } from './helpers'

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
            entryPoints: [join(__dirname, '../agent/main.ts')],
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
    }, 60000)
    afterAll(() => agent?.kill())

    it('shares one capture between clients and exits after the last one leaves', async () => {
        const path = pipePath(directory)
        const a = new TestClient()
        const b = new TestClient()
        await a.connect(path)
        await b.connect(path)
        const settings = { ...defaultSettings, port: await freePort(), mcpPort: await freePort() }
        const hello = await a.call('hello', { settings })
        expect(hello.clients).toBe(2)
        expect(hello.mcpPort).toBe(settings.mcpPort)
        await expect(b.call('state')).rejects.toThrow('hello first')
        await b.call('hello', { settings })
        const state = await a.call('start')
        expect(state.running).toBe(true)
        expect(state.port).toBe(settings.port)
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
            proxy: `http://127.0.0.1:${settings.port}`
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
})
