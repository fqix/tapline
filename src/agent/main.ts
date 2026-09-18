// Shared capture agent: one process per VS Code user profile owns sing-box and the
// capture engine. Every VS Code window connects as a client; when the last client
// disconnects the agent stops capture and exits, so quitting VS Code always shuts
// sing-box down. The extension starts it with ELECTRON_RUN_AS_NODE=1.
import { createInterface } from 'node:readline'
import net from 'node:net'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { Engine } from '../core/engine'
import type { AgentState, Event } from '../shared/model'
import { pipePath } from './paths'
import type { Message, Request } from './protocol'

const [directory, corePath] = process.argv.slice(2)
if (!directory || !corePath) {
    process.stderr.write('usage: agent <storage-directory> <sing-box-path>\n')
    process.exit(2)
}
mkdirSync(directory, { recursive: true, mode: 0o700 })
const clients = new Set<net.Socket>()
const engine = new Engine(directory, corePath)
let exitTimer: NodeJS.Timeout | undefined

function state(): AgentState {
    return {
        running: engine.running,
        recording: engine.recording,
        port: engine.settings.port,
        certificatePath: engine.certificatePath,
        truststorePath: engine.truststorePath,
        clients: clients.size,
        pid: process.pid,
        coreVersion: engine.coreVersion
    }
}
function send(socket: net.Socket, message: Message) {
    if (!socket.destroyed) socket.write(JSON.stringify(message) + '\n')
}
function broadcast(event: Event) {
    const line = JSON.stringify({ event } satisfies Message) + '\n'
    for (const socket of clients) if (!socket.destroyed) socket.write(line)
}
engine.on('event', (event) => {
    broadcast(event)
    if (event.type === 'reset') broadcast({ type: 'state', state: state() })
})

async function handle(request: Request): Promise<unknown> {
    switch (request.method) {
        case 'hello':
        case 'settings': {
            const restart = engine.running && request.settings.port !== engine.settings.port
            engine.settings = { ...engine.settings, ...request.settings }
            engine.enforceEntryLimit()
            if (restart) {
                await engine.stop()
                await engine.start()
            }
            broadcast({ type: 'state', state: state() })
            return state()
        }
        case 'state':
            return state()
        case 'snapshot':
            return { state: state(), transactions: [...engine.transactions.values()] }
        case 'start':
            await engine.start()
            broadcast({ type: 'state', state: state() })
            return state()
        case 'stop':
            await engine.stop()
            broadcast({ type: 'state', state: state() })
            return state()
        case 'record':
            engine.recording = request.value
            broadcast({ type: 'state', state: state() })
            return state()
        case 'clear':
            engine.clear()
            return state()
        case 'delete':
            engine.delete(request.ids)
            return state()
        case 'compose':
            return engine.compose(request.request)
        case 'logs':
            return engine.logs
    }
}

const path = pipePath(directory)

/** Stop capture, remove the socket file and exit. */
function shutdown(code: number) {
    void engine.stop().finally(() => {
        server.close()
        if (process.platform !== 'win32') {
            try {
                unlinkSync(path)
            } catch {}
        }
        process.exit(code)
    })
}

function scheduleExit() {
    clearTimeout(exitTimer)
    // Grace period lets a window reload (extension host restart) reconnect.
    exitTimer = setTimeout(() => {
        if (!clients.size) shutdown(0)
    }, 3000)
}

const server = net.createServer((socket) => {
    clearTimeout(exitTimer)
    clients.add(socket)
    broadcast({ type: 'state', state: state() })
    let greeted = false
    let queue = Promise.resolve()
    createInterface({ input: socket }).on('line', (line) => {
        if (line.length > 8 * 1024 * 1024) return socket.destroy()
        queue = queue.then(async () => {
            let id = 0
            try {
                const parsed = JSON.parse(line) as { id: number } & Request
                id = parsed.id
                if (!greeted && parsed.method !== 'hello') throw new Error('hello first')
                greeted = true
                send(socket, { id, result: await handle(parsed) })
            } catch (error) {
                send(socket, { id, error: error instanceof Error ? error.message : String(error) })
            }
        })
    })
    socket.on('error', () => {})
    socket.on('close', () => {
        clients.delete(socket)
        broadcast({ type: 'state', state: state() })
        if (!clients.size) scheduleExit()
    })
})
if (process.platform !== 'win32' && existsSync(path)) {
    // Never steal a live agent's socket; only reclaim a stale file.
    const probe = net.connect(path)
    probe.once('connect', () => {
        probe.destroy()
        process.exit(3)
    })
    probe.once('error', () => {
        unlinkSync(path)
        listen()
    })
} else listen()

function listen() {
    server.once('error', (error) => {
        process.stderr.write(`agent listen failed: ${error.message}\n`)
        process.exit(3)
    })
    server.listen(path, () => {
        process.stdout.write(`listening ${path}\n`)
        scheduleExit()
    })
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => shutdown(0))
process.on('uncaughtException', (error) => {
    process.stderr.write(`agent crashed: ${error.stack ?? error}\n`)
    shutdown(1)
})
