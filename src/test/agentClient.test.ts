import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import net from 'node:net'
import { createInterface } from 'node:readline'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type * as vscode from 'vscode'
import { pipePath } from '../agent/paths'
import { AgentClient } from '../client/agentClient'

vi.mock('vscode', () => ({
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
        getConfiguration: () => ({ get: (_name: string, fallback: unknown) => fallback })
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
    let requests: string[]
    let respond: (socket: net.Socket, request: { id: number; method: string }) => void
    const state = {
        running: false,
        recording: true,
        port: 3636,
        clients: 1,
        pid: 1,
        certificatePath: '/test/ca.pem',
        truststorePath: '/test/ca.p12'
    }
    const reply = (socket: net.Socket, id: number, result: unknown) =>
        socket.write(JSON.stringify({ id, result }) + '\n')

    beforeEach(async () => {
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
            extensionPath: directory,
            globalStorageUri: { fsPath: directory },
            subscriptions: []
        } as unknown as vscode.ExtensionContext)
    })

    afterEach(async () => {
        client.dispose()
        for (const socket of sockets) socket.destroy()
        await new Promise<void>((resolve) => server.close(() => resolve()))
        vi.useRealTimers()
        rmSync(directory, { recursive: true, force: true })
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
