// One shared agent and sing-box process; every VS Code window is its own capture session.
import { createInterface } from 'node:readline'
import net from 'node:net'
import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { SharedCore } from './sharedCore'
import { Engine } from '../core/engine'
import { McpEndpoint } from '../mcp/endpoint'
import type { AgentState, Event } from '../shared/model'
import { pipePath } from './paths'
import type { Message, Request, Responses } from './protocol'

const [directory, corePath] = process.argv.slice(2)
if (!directory || !corePath) {
    process.stderr.write('usage: agent <storage-directory> <sing-box-path>\n')
    process.exit(2)
}
mkdirSync(directory, { recursive: true, mode: 0o700 })
/** Identifies the running build for client diagnostics. */
const build = statSync(process.argv[1]).mtimeMs
const clients = new Map<net.Socket, string>()
const sessions = new Map<string, { engine: Engine; name: string; timer?: NodeJS.Timeout }>()
const core = new SharedCore(directory, corePath)
const mcp = new McpEndpoint(
    {
        sessions: () =>
            [...sessions]
                .filter(([id]) => [...clients.values()].includes(id))
                .map(([id, session]) => ({
                    sessionId: id,
                    workspaceName: session.name,
                    ...state(id)
                })),
        select: (id?: string) => {
            const active = [...new Set(clients.values())].filter(
                (id) => Boolean(id) && sessions.has(id)
            )
            if (!id && active.length === 1) id = active[0]
            if (!id || !active.includes(id)) throw new Error('Specify sessionId from list_sessions')
            const sessionId = id
            return {
                transactions: sessions.get(id)!.engine.transactions,
                state: () => state(sessionId),
                call: <M extends Request['method']>(method: M, args: object) =>
                    dispatch({ method, ...args } as Request, sessionId) as Promise<Responses[M]>
            }
        }
    },
    (message) => process.stdout.write(message + '\n')
)
let operations: Promise<unknown> = Promise.resolve()
function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = operations.then(operation)
    operations = result.catch(() => {})
    return result
}
let exitTimer: NodeJS.Timeout | undefined

function state(sessionId: string): AgentState {
    const engine = sessions.get(sessionId)!.engine
    return {
        running: engine.running,
        recording: engine.recording,
        port: engine.settings.port,
        certificatePath: engine.certificatePath,
        truststorePath: engine.truststorePath,
        clients: [...clients.values()].filter((id) => id === sessionId).length,
        pid: process.pid,
        corePid: core.pid,
        coreVersion: engine.coreVersion,
        mcpPort: mcp.port,
        build
    }
}
function send(socket: net.Socket, message: Message) {
    if (!socket.destroyed) socket.write(JSON.stringify(message) + '\n')
}
function broadcast(event: Event, sessionId: string) {
    const line = JSON.stringify({ event } satisfies Message) + '\n'
    for (const [socket, id] of clients)
        if (id === sessionId && !socket.destroyed) socket.write(line)
}
function ensureSession(id: string, name = '') {
    const existing = sessions.get(id)
    if (existing) {
        clearTimeout(existing.timer)
        return existing
    }
    const engine = new Engine(directory, corePath, core)
    engine.settings.port = 0
    core.register(engine, 'tapline-' + createHash('sha256').update(id).digest('hex').slice(0, 32))
    const session = { engine, name }
    sessions.set(id, session)
    engine.on('event', (event) => {
        if (sessions.get(id)?.engine !== engine) return
        broadcast(event, id)
        if (event.type === 'reset') broadcast({ type: 'state', state: state(id) }, id)
    })
    return session
}

function dispatch(request: Request, sessionId: string): Promise<unknown> {
    if (shuttingDown) return Promise.reject(new Error('Capture agent is shutting down'))
    return ['hello', 'settings', 'start', 'stop'].includes(request.method)
        ? serial(() => handle(request, sessionId))
        : handle(request, sessionId)
}

async function handle(request: Request, sessionId: string): Promise<unknown> {
    const session = sessions.get(sessionId)
    if (!session) throw new Error('Capture session closed')
    const engine = session.engine
    switch (request.method) {
        case 'hello':
        case 'settings': {
            if (request.method === 'hello') await engine.prepareCertificates()
            // The engine keeps the port it is actually bound to (0 while stopped).
            request.settings.port = engine.settings.port
            engine.settings = { ...engine.settings, ...request.settings }
            engine.enforceEntryLimit()
            void engine.reloadProtos()
            // MCP belongs to the shared agent. Conflicting window settings cannot steal its port.
            const desiredMcp = request.settings.mcpPort
            const others = [...sessions].filter(
                ([id]) => id !== sessionId && [...clients.values()].includes(id)
            )
            if (
                desiredMcp !== mcp.port &&
                (!mcp.port || !others.some(([, s]) => s.engine.settings.mcpPort))
            ) {
                await mcp
                    .listen(desiredMcp)
                    .catch((error) => process.stdout.write(`mcp: ${error.message}\n`))
            }
            broadcast({ type: 'state', state: state(sessionId) }, sessionId)
            return state(sessionId)
        }
        case 'state':
            return state(sessionId)
        case 'snapshot':
            return { state: state(sessionId), transactions: [...engine.transactions.values()] }
        case 'start':
            await engine.start()
            broadcast({ type: 'state', state: state(sessionId) }, sessionId)
            return state(sessionId)
        case 'stop':
            await engine.stop()
            engine.settings.port = 0
            broadcast({ type: 'state', state: state(sessionId) }, sessionId)
            return state(sessionId)
        case 'record':
            engine.recording = request.value
            broadcast({ type: 'state', state: state(sessionId) }, sessionId)
            return state(sessionId)
        case 'clear':
            engine.clear()
            return state(sessionId)
        case 'delete':
            engine.delete(request.ids)
            return state(sessionId)
        case 'annotate':
            engine.annotate(request.transaction, request)
            return state(sessionId)
        case 'compose':
            return engine.compose(request.request)
        case 'resendFrame':
            await engine.resendFrame(request.transaction, request.frame)
            return state(sessionId)
        case 'resume':
            engine.resume(request.transaction, request.edit)
            return state(sessionId)
        case 'abort':
            engine.abort(request.transaction)
            return state(sessionId)
        case 'logs':
            return engine.logs
        case 'shutdown':
            setImmediate(() => shutdown(0))
            return state(sessionId)
    }
}

const path = pipePath(directory)

/**
 * Stop accepting clients first (so a reconnecting client spawns a fresh agent instead
 * of finding this one), then stop capture and exit.
 */
let shuttingDown = false
function shutdown(code: number) {
    if (shuttingDown) return
    shuttingDown = true
    for (const session of sessions.values()) clearTimeout(session.timer)
    server.close()
    if (process.platform !== 'win32') {
        try {
            unlinkSync(path)
        } catch {}
    }
    void serial(async () => {
        await core.close()
        await mcp.close()
    }).finally(() => process.exit(code))
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
    clients.set(socket, '')
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
                if (greeted && parsed.method === 'hello') throw new Error('Already registered')
                const result =
                    parsed.method === 'hello'
                        ? await serial(async () => {
                              if (socket.destroyed) throw new Error('Client disconnected')
                              if (parsed.method === 'hello') {
                                  const sessionId = parsed.sessionId || 'default'
                                  if (sessionId.length > 256) throw new Error('Invalid sessionId')
                                  ensureSession(sessionId, parsed.workspaceName)
                                  clients.set(socket, sessionId)
                              }
                              return handle(parsed, clients.get(socket)!)
                          })
                        : await dispatch(parsed, clients.get(socket)!)
                greeted = true
                send(socket, { id, result })
            } catch (error) {
                send(socket, { id, error: error instanceof Error ? error.message : String(error) })
            }
        })
    })
    socket.on('error', () => {})
    socket.on('close', () => {
        const sessionId = clients.get(socket)!
        clients.delete(socket)
        const session = sessions.get(sessionId)
        if (session && ![...clients.values()].includes(sessionId)) {
            session.timer = setTimeout(
                () =>
                    void serial(async () => {
                        if ([...clients.values()].includes(sessionId)) return
                        await session.engine.stop()
                        core.forget(session.engine)
                        sessions.delete(sessionId)
                    }).catch((error) => {
                        process.stderr.write(String(error))
                        shutdown(1)
                    }),
                3000
            )
        }
        if (session) broadcast({ type: 'state', state: state(sessionId) }, sessionId)
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
