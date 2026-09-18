import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { join } from 'node:path'
import { Duplex, Readable, Transform } from 'node:stream'
import type { RootIdentity } from './certificate'
import { Streams } from './streams'
import { Wire } from './wire'

/** Client endpoint as reported by the core for one session. */
export interface Client {
    remoteAddress: string
    remotePort: number
}

export interface RequestInfo {
    method: string
    url: string
    httpVersion?: string
    headers: Record<string, string | string[]>
    client: Client
}
export interface ResponseInfo {
    status: number
    statusMessage?: string
    httpVersion?: string
    headers: Record<string, string | string[]>
    timings?: Record<string, number>
}

/** Callbacks the engine implements. The inspector relays bytes; the engine records. */
export interface Handlers {
    connect(id: string, host: string, port: number, client: Client): boolean
    tunnelBytes(id: string, direction: 'send' | 'receive', count: number): void
    request(id: string, info: RequestInfo): void
    requestData(id: string, chunk: Buffer): void
    requestEnd(id: string, trailers: Record<string, string>): void
    response(id: string, info: ResponseInfo): void
    responseData(id: string, chunk: Buffer): void
    responseEnd(id: string, trailers: Record<string, string>): void
    websocket(id: string, url: string, headers: Record<string, string | string[]>, client: Client): void
    frame(id: string, fromServer: boolean, data: Buffer, binary: boolean): void
    closed(id: string, aborted: boolean): void
    failure(id: string, error: string): void
    log(message: string, level?: 'info' | 'warn' | 'error'): void
}

export interface InspectorOptions {
    corePath: string
    directory: string
    host: string
    port: number
    root: RootIdentity
    /** Whether TLS for this host is decrypted (else the CONNECT is tunnelled). */
    intercept(host: string): boolean
    /** Extra PEM CA the core should trust for upstream servers (tests, private CAs). */
    upstreamCA?: string
}

export function coreConfig(host: string, port: number) {
    return {
        log: { level: 'info', output: 'stderr', disabled: false, timestamp: false },
        services: [{ type: 'fluxy-inspector', tag: 'inspector' }],
        inbounds: [{ type: 'fluxy-mixed', tag: 'proxy', listen: host, listen_port: port }],
        outbounds: [{ type: 'fluxy-inspect', tag: 'inspect', inspector: 'inspector' }],
        route: {
            final: 'inspect',
            rules: [
                { network: 'udp', action: 'sniff', sniffer: ['quic'], timeout: '300ms' },
                { network: 'udp', protocol: 'quic', action: 'route', outbound: 'inspect' },
                { network: 'udp', action: 'reject' }
            ]
        }
    }
}

/** Verify the bundled core against its build manifest before executing it. */
export async function verifyCore(corePath: string) {
    const manifest = JSON.parse(await readFile(corePath + '.build.json', 'utf8'))
    const hash = createHash('sha256').update(await readFile(corePath)).digest('hex')
    if (manifest.sha256 !== hash) throw new Error('Bundled sing-box core failed its integrity check')
    return manifest as { version: string; target: string }
}

/**
 * Owns one sing-box child and speaks the inspector IPC on its stdin/stdout.
 * Session streams: `<id>:request:in|out`, `<id>:response:in|out`, `<id>:tunnel:in|out`.
 */
export class Inspector {
    port = 0
    private child?: ChildProcess
    private wire?: Wire
    private streams?: Streams
    private directory?: string
    private tunnels = new Map<string, Duplex>()
    private sessions = new Set<string>()
    private stopping?: Promise<void>
    private exitHandlers: ((error: Error) => void)[] = []

    constructor(
        private options: InspectorOptions,
        private handlers: Handlers
    ) {}

    onExit(handler: (error: Error) => void) {
        this.exitHandlers.push(handler)
    }

    private send(message: Record<string, unknown>) {
        this.wire?.send(message)
    }

    private fail(id: string, error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        if (this.sessions.delete(id)) this.handlers.failure(id, message)
        this.send({ type: 'abort', id })
        this.streams?.cancel(`${id}:`)
        this.tunnels.get(id)?.destroy()
        this.tunnels.delete(id)
    }

    /** Relay `<id>:<phase>:in` to `<id>:<phase>:out`, tapping every chunk. */
    private async relay(id: string, phase: 'request' | 'response', source: Readable & { trailers?: Record<string, string> }) {
        const handlers = this.handlers
        const tap = new Transform({
            transform(chunk: Buffer, _encoding, done) {
                if (phase === 'request') handlers.requestData(id, chunk)
                else handlers.responseData(id, chunk)
                done(null, chunk)
            }
        })
        source.on('error', (error) => tap.destroy(error))
        const output = source.pipe(tap) as Transform & { trailers?: Record<string, string> }
        Object.defineProperty(output, 'trailers', { get: () => source.trailers })
        await this.streams!.pipe(`${id}:${phase}:out`, output)
        const trailers = source.trailers ?? {}
        if (phase === 'request') handlers.requestEnd(id, trailers)
        else handlers.responseEnd(id, trailers)
    }

    private client(socket: any): Client {
        return { remoteAddress: String(socket?.remoteAddress ?? ''), remotePort: Number(socket?.remotePort ?? 0) }
    }

    private async message(message: any) {
        const { id, type } = message
        if (message.stream) return this.streams?.receive(message)
        switch (type) {
            case 'certificate':
                // No custom server certificates: the core mints leaves from the root CA.
                this.send({ type: 'certificate-result', id })
                return
            case 'quic':
                this.send({ type: 'quic-result', id, inspect: this.options.intercept(message.host), route: '' })
                return
            case 'connect': {
                const target = new URL(`https://${message.request?.url ?? ''}`)
                const host = target.hostname.replace(/^\[|\]$/g, '')
                const port = Number(target.port) || 443
                const client = this.client(message.socket)
                this.sessions.add(id)
                if (this.handlers.connect(id, host, port, client)) {
                    this.send({ type: 'inspect', id })
                    return
                }
                // Opaque tunnel: the core hands both directions to us as streams.
                const socket = Duplex.from({
                    readable: this.streams!.reader(`${id}:tunnel:in`),
                    writable: this.streams!.writer(`${id}:tunnel:out`)
                })
                socket.on('error', () => {})
                this.tunnels.set(id, socket)
                const upstream = net.connect(port, host)
                upstream.setNoDelay(true)
                const head = Buffer.from(message.head ?? [])
                upstream.once('connect', () => {
                    // The core hands us the raw client socket; we answer the CONNECT
                    // ourselves, and that first write is what starts the relay.
                    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
                    if (head.length) upstream.write(head)
                    socket.pipe(upstream)
                    upstream.pipe(socket)
                })
                socket.on('data', (chunk: Buffer) => this.handlers.tunnelBytes(id, 'send', chunk.length))
                upstream.on('data', (chunk: Buffer) => this.handlers.tunnelBytes(id, 'receive', chunk.length))
                upstream.once('error', (error) => {
                    if (!upstream.connecting) return
                    socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n')
                    this.fail(id, error)
                })
                socket.once('close', () => upstream.destroy())
                upstream.once('close', () => socket.destroy())
                return
            }
            case 'request': {
                const request = message.request ?? {}
                this.sessions.add(id)
                const headers = request.headers ?? {}
                this.handlers.request(id, {
                    method: request.method ?? 'GET',
                    url: request.url,
                    httpVersion: request.httpVersion,
                    headers,
                    client: this.client(message.socket)
                })
                const target = new URL(request.url)
                const options = {
                    host: target.hostname,
                    port: target.port || (target.protocol === 'https:' ? 443 : 80),
                    path: target.pathname + target.search,
                    method: request.method ?? 'GET',
                    headers,
                    ...(this.options.upstreamCA ? { ca: this.options.upstreamCA } : {})
                }
                this.send({ type: 'request-result', id, options, url: request.url, route: '' })
                await this.relay(id, 'request', this.streams!.reader(`${id}:request:in`))
                return
            }
            case 'response': {
                if (!this.sessions.has(id)) return this.send({ type: 'abort', id })
                const response = message.response ?? {}
                this.handlers.response(id, {
                    status: response.statusCode,
                    statusMessage: response.statusMessage,
                    httpVersion: response.httpVersion,
                    headers: response.headers ?? {},
                    timings: message.timings
                })
                this.send({
                    type: 'response-result',
                    id,
                    status: response.statusCode,
                    statusMessage: response.statusMessage,
                    headers: response.headers ?? {},
                    rawHeaders: response.rawHeaders
                })
                await this.relay(id, 'response', this.streams!.reader(`${id}:response:in`))
                return
            }
            case 'closed':
                this.tunnels.get(id)?.destroy()
                this.tunnels.delete(id)
                this.streams?.cancel(`${id}:`)
                if (this.sessions.delete(id)) this.handlers.closed(id, !!message.aborted)
                return
            case 'failure':
                this.fail(id, new Error(message.error))
                return
            case 'websocket':
                this.sessions.add(id)
                this.handlers.websocket(id, message.url, message.headers ?? {}, this.client(message.socket))
                this.send({
                    type: 'websocket-result',
                    id,
                    options: { url: message.url, headers: message.headers },
                    route: ''
                })
                return
            case 'frame': {
                const data = Buffer.from(message.data ?? [])
                this.handlers.frame(message.session ?? id, !!message.fromServer, data, !!message.binary)
                this.send({ type: 'frame-result', id: message.frameId, data, binary: !!message.binary })
                return
            }
        }
    }

    async start(): Promise<void> {
        const { corePath, host, port } = this.options
        const temporary = await mkdtemp(join(this.options.directory, 'core-'))
        this.directory = temporary
        const config = join(temporary, 'config.json')
        await writeFile(config, JSON.stringify(coreConfig(host, port)), { mode: 0o600 })
        const child = (this.child = spawn(corePath, ['run', '-c', config], {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
            env: { ...process.env, FLUXY_HELPER_STDIN: '1', FLUXY_HELPER_PARENT: String(process.pid) }
        }))
        const wire = (this.wire = new Wire(child.stdin!))
        this.streams = new Streams((message) => this.send(message))
        let log = ''
        await new Promise<void>((resolve, reject) => {
            let settled = false
            let inspectorReady = false
            let coreReady = false
            const finish = (error?: Error) => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                error ? reject(error) : resolve()
            }
            const fatal = (error: Error) => {
                finish(error)
                if (this.child === child && coreReady && inspectorReady) this.exitHandlers.forEach((h) => h(error))
                void this.stop().catch(() => {})
            }
            const timer = setTimeout(() => fatal(new Error(`sing-box startup timed out: ${log}`)), 15000)
            child.stdout!.on('data', (data: Buffer) => {
                try {
                    wire.receive(data)
                } catch (error) {
                    fatal(error instanceof Error ? error : new Error(String(error)))
                }
            })
            child.stderr!.on('data', (data: Buffer) => {
                const text = String(data)
                log = (log + text).slice(-8000)
                for (const line of text.split('\n')) if (line.trim()) this.handlers.log(`core: ${line.trim()}`, line.includes('ERROR') || line.includes('FATAL') ? 'error' : 'info')
                if (log.includes('sing-box started (')) coreReady = true
                if (coreReady && inspectorReady) finish()
            })
            child.on('error', fatal)
            child.stdin!.on('error', fatal)
            child.on('exit', (code) => {
                const error = new Error(`sing-box exited (${code}): ${log.slice(-2000)}`)
                finish(error)
                if (this.child === child) this.exitHandlers.forEach((h) => h(error))
                for (const id of [...this.sessions]) this.fail(id, new Error('sing-box stopped'))
                this.streams?.close()
            })
            wire.on('message', (message: any) => {
                if (message.type === 'ready') {
                    this.port = message.port
                    inspectorReady = true
                    if (coreReady) finish()
                } else void this.message(message).catch((error) => this.fail(message.id, error))
            })
            wire.send({ type: 'start', port, host, ingressPort: port, root: this.options.root })
        })
    }

    stop(): Promise<void> {
        return (this.stopping ??= this.shutdown())
    }

    private async shutdown() {
        const child = this.child
        const exited =
            child?.pid && child.exitCode === null && child.signalCode === null
                ? new Promise<void>((resolve) => child.once('exit', () => resolve()))
                : Promise.resolve()
        this.streams?.close()
        this.child = undefined
        child?.stdin?.end()
        child?.kill()
        const force = setTimeout(() => child?.kill('SIGKILL'), 2000)
        force.unref()
        for (const socket of this.tunnels.values()) socket.destroy()
        this.tunnels.clear()
        this.sessions.clear()
        await exited
        clearTimeout(force)
        if (this.directory) await rm(this.directory, { recursive: true, force: true })
        this.directory = undefined
    }
}
