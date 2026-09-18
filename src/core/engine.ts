import { EventEmitter } from 'node:events'
import { isUtf8 } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import http from 'node:http'
import net from 'node:net'
import tls from 'node:tls'
import { certificatePaths, ensureRootIdentity, ensureTruststore, type RootIdentity } from './certificate'
import { Inspector, verifyCore, type Client, type Handlers } from './inspector'
import {
    defaultSettings,
    matchHost,
    type ComposeRequest,
    type Event,
    type Frame,
    type Headers,
    type LogEntry,
    type Settings,
    type Transaction
} from '../shared/model'

const flatten = (headers: Record<string, string | string[] | undefined>): Headers =>
    Object.fromEntries(
        Object.entries(headers)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)])
    )

interface Capture {
    chunks: Buffer[]
    retained: number
    total: number
}

/**
 * Capture engine: turns inspector sessions into `Transaction` records, bounded by
 * `maxEntries`/`maxBodyBytes`, and emits `Event`s for connected clients.
 */
export class Engine extends EventEmitter<{ event: [Event] }> implements Handlers {
    readonly transactions = new Map<string, Transaction>()
    readonly logs: LogEntry[] = []
    settings: Settings = { ...defaultSettings }
    recording = true
    running = false
    coreVersion?: string
    /** Extra PEM CA trusted for upstream TLS (tests and private CAs). */
    upstreamCA?: string
    private inspector?: Inspector
    private root?: RootIdentity
    private sequence = 0
    private starting?: Promise<void>
    private captures = new Map<string, { request: Capture; response: Capture }>()
    private started = new Map<string, number>()

    constructor(
        readonly directory: string,
        readonly corePath: string
    ) {
        super()
    }

    get certificatePath() {
        return certificatePaths(this.directory).certificate
    }
    get truststorePath() {
        return certificatePaths(this.directory).truststore
    }

    log(message: string, level: LogEntry['level'] = 'info') {
        const log = { time: Date.now(), level, message }
        this.logs.push(log)
        if (this.logs.length > 2000) this.logs.shift()
        this.emit('event', { type: 'log', log })
    }

    private publish(t: Transaction) {
        if (!this.transactions.has(t.id)) return
        this.emit('event', { type: 'transaction', transaction: t })
    }

    private add(t: Transaction) {
        this.transactions.set(t.id, t)
        this.enforceEntryLimit()
        this.publish(t)
    }

    enforceEntryLimit() {
        let evicted = false
        while (this.transactions.size > this.settings.maxEntries) {
            const oldest = this.transactions.keys().next().value
            if (oldest === undefined) break
            this.transactions.delete(oldest)
            this.captures.delete(oldest)
            evicted = true
        }
        if (evicted) this.emit('event', { type: 'reset' })
    }

    clear() {
        this.transactions.clear()
        this.captures.clear()
        this.emit('event', { type: 'reset' })
    }

    delete(ids: string[]) {
        for (const id of ids) {
            this.transactions.delete(id)
            this.captures.delete(id)
        }
        this.emit('event', { type: 'reset' })
    }

    // ---- lifecycle ---------------------------------------------------------

    async start() {
        if (this.running) return
        if (this.starting) return this.starting
        this.starting = this.listen().finally(() => (this.starting = undefined))
        return this.starting
    }

    private async listen() {
        const manifest = await verifyCore(this.corePath)
        this.coreVersion = manifest.version
        this.root = await ensureRootIdentity(this.directory)
        ensureTruststore(this.directory, this.root.certificate)
        await new Promise<void>((resolve, reject) => {
            const probe = net.createServer()
            probe.once('error', reject)
            probe.listen(this.settings.port, '127.0.0.1', () => probe.close(() => resolve()))
        }).catch((error) => {
            throw new Error(`Port ${this.settings.port} is unavailable: ${error.message}`)
        })
        const inspector = new Inspector(
            {
                corePath: this.corePath,
                directory: this.directory,
                host: '127.0.0.1',
                port: this.settings.port,
                root: this.root,
                intercept: (host) => this.intercepts(host),
                upstreamCA: this.upstreamCA
            },
            this
        )
        inspector.onExit((error) => {
            if (this.inspector !== inspector) return
            this.log(error.message, 'error')
            this.inspector = undefined
            this.running = false
            this.emit('event', { type: 'reset' })
        })
        await inspector.start()
        this.inspector = inspector
        this.running = true
        this.log(`Capture listening on 127.0.0.1:${this.settings.port} (sing-box ${manifest.version})`)
    }

    async stop() {
        const inspector = this.inspector
        this.inspector = undefined
        this.running = false
        await inspector?.stop()
        for (const t of this.transactions.values())
            if (t.state === 'pending') this.finish(t, 'Capture stopped')
        this.captures.clear()
        if (inspector) this.log('Capture stopped')
    }

    private intercepts(host: string) {
        return this.settings.ssl && this.settings.sslHosts.some((pattern) => matchHost(pattern, host))
    }

    // ---- inspector handlers ------------------------------------------------

    private create(id: string, method: string, url: string, client: Client, scheme?: string): Transaction | undefined {
        if (!this.recording) return undefined
        const target = new URL(url)
        const t: Transaction = {
            id,
            sequence: ++this.sequence,
            timestamp: Date.now(),
            method,
            url,
            host: target.hostname,
            path: target.pathname + target.search,
            scheme: scheme ?? target.protocol.replace(':', ''),
            client: `${client.remoteAddress}:${client.remotePort}`,
            state: 'pending',
            requestHeaders: {},
            responseHeaders: {},
            requestBody: '',
            responseBody: '',
            requestBinary: false,
            responseBinary: false,
            requestBytes: 0,
            responseBytes: 0,
            truncated: false,
            duration: 0,
            tls: target.protocol === 'https:' || target.protocol === 'wss:',
            frames: []
        }
        this.started.set(id, performance.now())
        this.add(t)
        return t
    }

    private finish(t: Transaction, error?: string) {
        if (t.state !== 'pending') return
        const started = this.started.get(t.id)
        if (started !== undefined) t.duration = Math.round((performance.now() - started) * 10) / 10
        this.started.delete(t.id)
        t.state = error ? 'error' : 'completed'
        if (error) t.error = error
        this.publish(t)
    }

    private capture(id: string, side: 'request' | 'response', chunk: Buffer) {
        const t = this.transactions.get(id)
        if (!t) return
        let captures = this.captures.get(id)
        if (!captures) {
            captures = { request: { chunks: [], retained: 0, total: 0 }, response: { chunks: [], retained: 0, total: 0 } }
            this.captures.set(id, captures)
        }
        const c = captures[side]
        c.total += chunk.length
        const room = this.settings.maxBodyBytes - c.retained
        if (room > 0) {
            const slice = chunk.length > room ? chunk.subarray(0, room) : chunk
            c.chunks.push(Buffer.from(slice))
            c.retained += slice.length
        }
        if (c.total > this.settings.maxBodyBytes) t.truncated = true
        if (side === 'request') t.requestBytes = c.total
        else t.responseBytes = c.total
    }

    private seal(id: string, side: 'request' | 'response') {
        const t = this.transactions.get(id)
        const c = this.captures.get(id)?.[side]
        if (!t || !c) return
        const body = Buffer.concat(c.chunks)
        const text = isUtf8(body)
        if (side === 'request') {
            t.requestBody = body.toString(text ? 'utf8' : 'base64')
            t.requestBinary = !text
        } else {
            t.responseBody = body.toString(text ? 'utf8' : 'base64')
            t.responseBinary = !text
        }
        c.chunks = []
    }

    connect(id: string, host: string, port: number, client: Client) {
        const intercept = this.intercepts(host)
        if (!intercept) {
            const t = this.create(id, 'CONNECT', `https://${net.isIPv6(host) ? `[${host}]` : host}:${port}/`, client, 'connect')
            if (t) {
                t.path = `${host}:${port}`
                t.tls = false
            }
        }
        return intercept
    }
    tunnelBytes(id: string, direction: 'send' | 'receive', count: number) {
        const t = this.transactions.get(id)
        if (!t) return
        if (direction === 'send') t.requestBytes += count
        else t.responseBytes += count
    }
    request(id: string, info: Parameters<Handlers['request']>[1]) {
        const t = this.create(id, info.method, info.url, info.client)
        if (!t) return
        t.httpVersion = info.httpVersion
        t.requestHeaders = flatten(info.headers)
        this.publish(t)
    }
    requestData(id: string, chunk: Buffer) {
        this.capture(id, 'request', chunk)
    }
    requestEnd(id: string) {
        this.seal(id, 'request')
        const t = this.transactions.get(id)
        if (t) this.publish(t)
    }
    response(id: string, info: Parameters<Handlers['response']>[1]) {
        const t = this.transactions.get(id)
        if (!t) return
        t.status = info.status
        t.statusMessage = info.statusMessage
        t.httpVersion = info.httpVersion ?? t.httpVersion
        t.responseHeaders = flatten(info.headers)
        if (info.timings) t.timings = info.timings
        this.publish(t)
    }
    responseData(id: string, chunk: Buffer) {
        this.capture(id, 'response', chunk)
    }
    responseEnd(id: string, trailers: Headers) {
        this.seal(id, 'response')
        const t = this.transactions.get(id)
        if (!t) return
        if (Object.keys(trailers).length) t.responseTrailers = trailers
        this.captures.delete(id)
        this.finish(t)
    }
    websocket(id: string, url: string, headers: Record<string, string | string[]>, client: Client) {
        const t = this.create(id, 'GET', url, client)
        if (!t) return
        t.requestHeaders = flatten(headers)
        t.status = 101
        t.statusMessage = 'Switching Protocols'
        this.publish(t)
    }
    frame(id: string, fromServer: boolean, data: Buffer, binary: boolean) {
        const t = this.transactions.get(id)
        if (!t) return
        if (fromServer) t.responseBytes += data.length
        else t.requestBytes += data.length
        const text = !binary && isUtf8(data)
        const frame: Frame = {
            id: randomUUID(),
            time: Date.now(),
            direction: fromServer ? 'receive' : 'send',
            binary: !text,
            data: data.subarray(0, this.settings.maxBodyBytes).toString(text ? 'utf8' : 'base64')
        }
        t.frames.push(frame)
        if (t.frames.length > 500) t.frames.shift()
        this.publish(t)
    }
    closed(id: string, aborted: boolean) {
        const t = this.transactions.get(id)
        this.captures.delete(id)
        if (!t) return
        if (t.state === 'pending') {
            if (t.scheme === 'connect' || t.frames.length || t.status === 101) this.finish(t)
            else this.finish(t, aborted ? 'Client disconnected' : undefined)
        }
    }
    failure(id: string, error: string) {
        const t = this.transactions.get(id)
        this.captures.delete(id)
        if (t) this.finish(t, error)
    }

    // ---- replay ------------------------------------------------------------

    /** Send a request through the proxy so it is captured like any other client. */
    async compose(input: ComposeRequest): Promise<Transaction> {
        if (!this.running || !this.root) throw new Error('Start capture before replaying requests')
        const target = new URL(input.url)
        if (!/^https?:$/.test(target.protocol)) throw new Error('Only HTTP and HTTPS URLs can be replayed')
        const proxy = await new Promise<net.Socket>((resolve, reject) => {
            const socket = net.connect(this.settings.port, '127.0.0.1')
            socket.once('connect', () => resolve(socket))
            socket.once('error', reject)
        })
        const localPort = proxy.localPort!
        const found = new Promise<Transaction>((resolve, reject) => {
            const listener = (event: Event) => {
                if (event.type !== 'transaction') return
                const t = event.transaction
                if (t.client !== `127.0.0.1:${localPort}` || t.state === 'pending') return
                this.off('event', listener)
                if (input.replayOf) {
                    t.replayOf = input.replayOf
                    this.publish(t)
                }
                resolve(t)
            }
            this.on('event', listener)
            setTimeout(() => {
                this.off('event', listener)
                reject(new Error('Replay timed out'))
            }, 60000).unref()
        })
        const headers: Headers = {}
        for (const [name, value] of Object.entries(input.headers))
            if (!['content-length', 'transfer-encoding', 'host', 'connection', 'proxy-connection'].includes(name.toLowerCase()))
                headers[name] = value
        const body = Buffer.from(input.body ?? '')
        if (body.length) headers['content-length'] = String(body.length)
        // URL.host omits default ports, matching what browsers and curl send.
        headers['host'] = target.host
        let socket: net.Socket | tls.TLSSocket = proxy
        if (target.protocol === 'https:') {
            const host = `${target.hostname}:${target.port || 443}`
            proxy.write(`CONNECT ${host} HTTP/1.1\r\nHost: ${host}\r\n\r\n`)
            await new Promise<void>((resolve, reject) => {
                let buffer = ''
                const onData = (chunk: Buffer) => {
                    buffer += chunk.toString('latin1')
                    const end = buffer.indexOf('\r\n\r\n')
                    if (end < 0) return
                    proxy.off('data', onData)
                    if (!/^HTTP\/1\.[01] 200/.test(buffer)) return reject(new Error(`Proxy refused CONNECT: ${buffer.split('\r\n')[0]}`))
                    resolve()
                }
                proxy.on('data', onData)
                proxy.once('error', reject)
            })
            socket = tls.connect({ socket: proxy, servername: target.hostname, ca: [this.root.certificate] })
        }
        const request = http.request({
            createConnection: () => socket as net.Socket,
            method: input.method,
            host: target.hostname,
            port: target.port || (target.protocol === 'https:' ? 443 : 80),
            path: target.protocol === 'https:' ? target.pathname + target.search : input.url,
            headers,
            setHost: false,
            timeout: 30000
        })
        request.on('response', (response) => response.resume())
        request.on('error', () => {})
        request.on('timeout', () => request.destroy(new Error('Replay timed out')))
        request.end(body)
        try {
            return await found
        } finally {
            request.destroy()
            socket.destroy()
        }
    }
}
