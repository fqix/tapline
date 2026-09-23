import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import net from 'node:net'
import { createInterface } from 'node:readline'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type * as vscode from 'vscode'
import { pipePath } from '../../agent/paths'
import { AgentClient, needsAgentUpgrade } from '../../extension/client'

const config = vi.hoisted(() => ({ sessionId: 'window-a' }))

vi.mock('../../extension/preferences', () => ({
    preferences: {
        onDidChange: () => ({ dispose() {} }),
        get: (_name: string, fallback: unknown) => fallback
    }
}))

vi.mock('vscode', () => ({
    env: {
        get sessionId() {
            return config.sessionId
        }
    },
    EventEmitter: class {
        event = () => ({ dispose() {} })
        fire() {}
        dispose() {}
    },
    window: {
        createOutputChannel: () => ({ info() {}, warn() {}, error() {}, debug() {}, dispose() {} })
    },
    workspace: {
        onDidChangeConfiguration: () => ({ dispose() {} }),
        getConfiguration: () => ({
            get: (_name: string, fallback: unknown) => fallback
        })
    },
    l10n: {
        t: (message: string, ...args: unknown[]) =>
            message.replace(/\{(\d+)\}/g, (_, i) => String(args[i]))
    }
}))

describe('capture agent client lifecycle', () => {
    let directory: string
    let server: net.Server
    let client: AgentClient
    const sockets = new Set<net.Socket>()
    const stagedServers: net.Server[] = []
    let requests: string[]
    let respond: (socket: net.Socket, request: { id: number; method: string }) => void
    const state = {
        running: false,
        recording: true,
        port: 3636,
        clients: 1,
        pid: 1,
        certificatePath: '/test/ca.pem',
        truststorePath: '/test/ca.p12',
        agentVersion: '0.10.0'
    }
    const reply = (socket: net.Socket, id: number, result: unknown) =>
        socket.write(JSON.stringify({ id, result }) + '\n')

    beforeEach(async () => {
        config.sessionId = 'window-a'
        directory = mkdtempSync(join(tmpdir(), 'tapline-client-'))
        requests = []
        respond = (socket, request) =>
            reply(
                socket,
                request.id,
                request.method === 'snapshot' ? { state, transactions: [] } : state
            )
        server = net.createServer((socket) => {
            sockets.add(socket)
            socket.on('close', () => sockets.delete(socket))
            createInterface({ input: socket }).on('line', (line) => {
                const request = JSON.parse(line)
                requests.push(request.method)
                respond(socket, request)
            })
        })
        await new Promise<void>((resolve) => server.listen(pipePath(directory), resolve))
        client = new AgentClient({
            extension: { packageJSON: { version: '0.10.0' } },
            extensionPath: directory,
            globalStorageUri: { fsPath: directory },
            subscriptions: []
        } as unknown as vscode.ExtensionContext)
    })

    afterEach(async () => {
        client.dispose()
        for (const socket of sockets) socket.destroy()
        await new Promise<void>((resolve) => server.close(() => resolve()))
        for (const staged of stagedServers.splice(0))
            await new Promise<void>((resolve) => staged.close(() => resolve()))
        vi.restoreAllMocks()
        vi.useRealTimers()
        rmSync(directory, { recursive: true, force: true })
    })

    it('identifies each window by its session on the shared agent pipe', async () => {
        client.dispose()
        const seen: any[] = []
        const previous = respond
        respond = (socket, request) => {
            if (request.method === 'hello') seen.push(request)
            previous(socket, request)
        }
        const context = {
            extension: { packageJSON: { version: '0.10.0' } },
            extensionPath: directory,
            globalStorageUri: { fsPath: directory },
            subscriptions: []
        } as unknown as vscode.ExtensionContext
        client = new AgentClient(context)
        await client.connect()
        config.sessionId = 'window-b'
        const other = new AgentClient(context)
        try {
            await other.connect()
            expect(seen.map((hello) => hello.sessionId)).toEqual(['window-a', 'window-b'])
            expect(seen.every((hello) => hello.settings.port === 3606)).toBe(true)
            client.dispose()
            config.sessionId = 'window-a'
            client = new AgentClient(context)
            await client.connect()
            expect(seen[2].sessionId).toBe('window-a')
        } finally {
            other.dispose()
        }
    })

    it('waits for hello and snapshot before sending a start requested during connection', async () => {
        let finishHello!: () => void
        const hello = new Promise<void>((resolve) => {
            respond = (socket, request) => {
                if (request.method === 'hello') {
                    finishHello = () => reply(socket, request.id, state)
                    resolve()
                } else
                    reply(
                        socket,
                        request.id,
                        request.method === 'snapshot'
                            ? { state, transactions: [] }
                            : { ...state, running: true }
                    )
            }
        })
        const connecting = client.connect()
        await hello
        const starting = client.start()
        await new Promise((resolve) => setImmediate(resolve))
        expect(requests).toEqual(['hello'])
        finishHello()
        await Promise.all([connecting, starting])
        expect(requests).toEqual(['hello', 'snapshot', 'start'])
        expect(client.running).toBe(true)
    })

    it.each(['older', 'newer', 'unstamped'] as const)(
        'reuses the same release with a compatible %s build across reconnects without stopping capture',
        async (kind) => {
            mkdirSync(join(directory, 'dist'))
            const script = join(directory, 'dist', 'agent.js')
            writeFileSync(script, '// local build')
            const build = statSync(script).mtimeMs
            const remote = {
                ...state,
                running: true,
                build: kind === 'unstamped' ? undefined : build + (kind === 'older' ? -1 : 1)
            }
            const transaction = { id: 'existing-traffic' }
            const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
            respond = (socket, request) =>
                reply(
                    socket,
                    request.id,
                    request.method === 'snapshot'
                        ? { state: remote, transactions: [transaction] }
                        : remote
                )
            try {
                await client.connect()
                expect(client.running).toBe(true)
                expect(client.transactions.get(transaction.id)).toEqual(transaction)
                // Simulate a transient disconnect with another build still serving.
                const socket = [...sockets][0]
                await new Promise<void>((resolve) => {
                    socket.once('close', resolve)
                    socket.destroy()
                })
                await vi.waitFor(() => expect(client.connected).toBe(false))
                await client.connect()
                expect(client.running).toBe(true)
                expect(client.transactions.get(transaction.id)).toEqual(transaction)
                expect(requests).toEqual(['hello', 'snapshot', 'hello', 'snapshot'])
                expect(kill).not.toHaveBeenCalled()
            } finally {
                kill.mockRestore()
            }
        }
    )

    function stageAgent(failStart = false) {
        vi.spyOn(client as any, 'spawnAgent').mockImplementation((...args: unknown[]) => {
            const path = args[1] as string
            const staged = net.createServer((socket) => {
                sockets.add(socket)
                socket.on('close', () => sockets.delete(socket))
                createInterface({ input: socket }).on('line', (line) => {
                    const request = JSON.parse(line)
                    requests.push(`new:${request.method}`)
                    if (failStart && request.method === 'start') {
                        socket.write(
                            JSON.stringify({ id: request.id, error: 'new core failed' }) + '\n'
                        )
                        return
                    }
                    reply(
                        socket,
                        request.id,
                        request.method === 'snapshot' ? { state, transactions: [] } : state
                    )
                })
            })
            stagedServers.push(staged)
            staged.listen(path)
        })
    }

    it.each(['0.9.0', undefined])(
        'starts and verifies the replacement before stopping agent %s',
        async (agentVersion) => {
            mkdirSync(join(directory, 'dist'))
            writeFileSync(join(directory, 'dist', 'agent.js'), '// current build')
            const remote = { ...state, agentVersion, build: 1, running: true }
            stageAgent()
            respond = (socket, request) => {
                reply(socket, request.id, remote)
                if (request.method === 'shutdown') socket.end()
            }
            await client.connect()
            expect(requests).toEqual([
                'hello',
                'new:hello',
                'new:start',
                'new:snapshot',
                'shutdown',
                'new:promote',
                'new:settings',
                'new:snapshot'
            ])
            expect(client.state.agentVersion).toBe('0.10.0')
        }
    )

    it('keeps the old agent and its traffic when replacement startup fails', async () => {
        const remote = { ...state, agentVersion: '0.9.0', running: true }
        const transaction = { id: 'preserved-traffic' }
        stageAgent(true)
        respond = (socket, request) =>
            reply(
                socket,
                request.id,
                request.method === 'snapshot'
                    ? { state: remote, transactions: [transaction] }
                    : remote
            )
        await client.connect()
        expect(requests).toEqual(['hello', 'new:hello', 'new:start', 'snapshot'])
        expect(client.running).toBe(true)
        expect(client.state.agentVersion).toBe('0.9.0')
        expect(client.transactions.get(transaction.id)).toEqual(transaction)
        await client.clear()
        expect(requests.at(-1)).toBe('clear')
    })

    it('never replaces a newer release even if its file timestamp is older', async () => {
        mkdirSync(join(directory, 'dist'))
        writeFileSync(join(directory, 'dist', 'agent.js'), '// older client')
        const remote = { ...state, agentVersion: '0.11.0', build: 1 }
        respond = (socket, request) =>
            reply(
                socket,
                request.id,
                request.method === 'snapshot' ? { state: remote, transactions: [] } : remote
            )
        await client.connect()
        expect(requests).toEqual(['hello', 'snapshot'])
        expect(client.state.agentVersion).toBe('0.11.0')
    })

    it('compares numeric release versions and keeps unstamped development clients safe', () => {
        expect(needsAgentUpgrade('0.10.0', { ...state, agentVersion: '0.9.9' })).toBe(true)
        expect(needsAgentUpgrade('0.9.9', { ...state, agentVersion: '0.10.0' })).toBe(false)
        expect(needsAgentUpgrade(undefined, { ...state, agentVersion: undefined }, 1)).toBe(false)
        expect(
            needsAgentUpgrade('0.10.0', { ...state, agentVersion: undefined, build: 1 }, 1)
        ).toBe(false)
    })

    it('rejects a silent start after 30 seconds and allows a new connection', async () => {
        await client.connect()
        let startSeen!: () => void
        const received = new Promise<void>((resolve) => {
            startSeen = resolve
        })
        const normal = respond
        respond = (socket, request) =>
            request.method === 'start' ? startSeen() : normal(socket, request)
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const starting = client.start()
        const rejected = expect(starting).rejects.toThrow('timed out while handling start')
        await received
        await vi.advanceTimersByTimeAsync(30000)
        await rejected
        // Let the socket close before reconnecting; do not replay an uncertain mutation.
        await new Promise((resolve) => setImmediate(resolve))
        vi.useRealTimers()
        respond = normal
        await client.connect()
        expect(client.connected).toBe(true)
        expect(requests.filter((method) => method === 'start')).toHaveLength(1)
    })

    it('rejects failed initialization instead of caching a broken connection', async () => {
        const normal = respond
        respond = (socket, request) =>
            request.method === 'snapshot'
                ? socket.write(
                      JSON.stringify({ id: request.id, error: 'snapshot unavailable' }) + '\n'
                  )
                : normal(socket, request)
        await expect(client.connect()).rejects.toThrow('snapshot unavailable')
        await new Promise((resolve) => setImmediate(resolve))
        respond = normal
        await client.connect()
        expect(client.connected).toBe(true)
        expect(requests.filter((method) => method === 'hello')).toHaveLength(2)
    })
})
