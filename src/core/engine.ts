import { EventEmitter } from 'node:events'
import { isUtf8 } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import tls from 'node:tls'
import {
    certificatePaths,
    ensureRootIdentity,
    ensureTruststore,
    type RootIdentity
} from './certificate'
import { GrpcDecoder } from './grpc'
import { SSEParser } from './sse'
import {
    Inspector,
    verifyCore,
    type Client,
    type Handlers,
    type RequestDecision,
    type RequestInfo,
    type ResponseDecision,
    type ResponseInfo,
    type WireHeaders
} from './inspector'
import {
    applyHeaderEdits,
    decodeBody,
    getHeader,
    mimeFor,
    mimeForBody,
    regex,
    remapUrl,
    setHeader,
    toWire
} from './rules'
import {
    defaultSettings,
    matchHost,
    ruleLabel,
    ruleMatches,
    type BreakpointEdit,
    type ComposeRequest,
    type Event,
    type Frame,
    type Headers,
    type LogEntry,
    type Rule,
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
    private eventStreams = new WeakMap<Transaction, SSEParser>()
    private started = new Map<string, number>()
    private grpc = new GrpcDecoder((message, level) => this.log(message, level))
    /** Rules that matched each in-flight session, so the response phase sees the same set. */
    private matched = new Map<string, Rule[]>()
    /** Transactions held at a breakpoint, resolved by `resume` / `abort`. */
    private holds = new Map<string, (result: BreakpointEdit | 'abort') => void>()

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
        for (const id of this.holds.keys()) this.release(id)
        this.transactions.clear()
        this.captures.clear()
        // Sequence numbers are display order only, so a cleared session restarts at 1.
        this.sequence = 0
        this.emit('event', { type: 'reset' })
    }

    delete(ids: string[]) {
        for (const id of ids) {
            this.release(id)
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
        this.log(
            `Capture listening on 127.0.0.1:${this.settings.port} (sing-box ${manifest.version})`
        )
    }

    async stop() {
        const inspector = this.inspector
        this.inspector = undefined
        this.running = false
        for (const id of this.holds.keys()) this.release(id)
        await inspector?.stop()
        for (const t of this.transactions.values())
            if (t.state === 'pending') this.finish(t, 'Capture stopped')
        this.captures.clear()
        if (inspector) this.log('Capture stopped')
    }

    private intercepts(host: string) {
        return (
            this.settings.ssl && this.settings.sslHosts.some((pattern) => matchHost(pattern, host))
        )
    }

    // ---- inspector handlers ------------------------------------------------

    private create(
        id: string,
        method: string,
        url: string,
        client: Client,
        scheme?: string
    ): Transaction | undefined {
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
        this.eventStreams.delete(t)
        t.state = error ? 'error' : 'completed'
        if (error) t.error = error
        this.publish(t)
    }

    private capture(id: string, side: 'request' | 'response', chunk: Buffer) {
        const t = this.transactions.get(id)
        if (!t) return
        let captures = this.captures.get(id)
        if (!captures) {
            captures = {
                request: { chunks: [], retained: 0, total: 0 },
                response: { chunks: [], retained: 0, total: 0 }
            }
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

    private seal(id: string, side: 'request' | 'response'): Buffer | undefined {
        const t = this.transactions.get(id)
        const c = this.captures.get(id)?.[side]
        if (!t || !c) return undefined
        const body = Buffer.concat(c.chunks)
        this.retain(t, side, body)
        c.chunks = []
        return body
    }

    /** Store a body on the record, decoding Content-Encoding so the panel shows text. */
    private retain(t: Transaction, side: 'request' | 'response', raw: Buffer) {
        const headers = side === 'request' ? t.requestHeaders : t.responseHeaders
        const { bytes, encoding } = decodeBody(raw, getHeader(headers, 'content-encoding'))
        const text = isUtf8(bytes)
        if (side === 'request') {
            t.requestBody = bytes.toString(text ? 'utf8' : 'base64')
            t.requestBinary = !text
        } else {
            t.responseBody = bytes.toString(text ? 'utf8' : 'base64')
            t.responseBinary = !text
            t.responseEncoding = encoding
        }
    }

    /** Reload the gRPC schema from `settings.protoFiles`. */
    reloadProtos() {
        return this.grpc.load(this.settings.protoFiles)
    }

    connect(id: string, host: string, port: number, client: Client) {
        const intercept = this.intercepts(host)
        if (!intercept) {
            const t = this.create(
                id,
                'CONNECT',
                `https://${net.isIPv6(host) ? `[${host}]` : host}:${port}/`,
                client,
                'connect'
            )
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
    async request(id: string, info: RequestInfo): Promise<RequestDecision | undefined> {
        const t = this.create(id, info.method, info.url, info.client)
        if (t) {
            t.httpVersion = info.httpVersion
            t.requestHeaders = flatten(info.headers)
            this.publish(t)
        }
        const rules = this.settings.rules.filter(
            (r) => r.enabled && ruleMatches(r, info.method, info.url)
        )
        if (!rules.length) return undefined
        this.matched.set(id, rules)
        const decision: RequestDecision = {}
        const applied: string[] = []
        let method = info.method
        let url = info.url
        let headers: WireHeaders = { ...info.headers }
        let body: Buffer | undefined
        let hold = false
        const decoded = async () =>
            decodeBody(body ?? (await info.body()), getHeader(headers, 'content-encoding')).bytes
        rules: for (const rule of rules) {
            switch (rule.kind) {
                case 'block':
                    decision.local = {
                        status: rule.status ?? 403,
                        headers: { 'content-type': 'text/plain; charset=utf-8' },
                        body: Buffer.from(`Blocked by Tapline rule "${ruleLabel(rule)}"\n`)
                    }
                    applied.push(ruleLabel(rule))
                    break rules
                case 'mapLocal':
                    decision.local = await this.localResponse(rule)
                    applied.push(ruleLabel(rule))
                    break rules
                case 'mapRemote':
                    url = remapUrl(url, rule.to)
                    setHeader(headers, 'host', new URL(url).host)
                    applied.push(ruleLabel(rule))
                    break
                case 'rewrite': {
                    const edit = rule.request
                    if (!edit) break
                    if (edit.method) method = edit.method.toUpperCase()
                    if (edit.url) {
                        const re = regex(edit.url.pattern)
                        if (re) url = url.replace(re, edit.url.replacement)
                        setHeader(headers, 'host', new URL(url).host)
                    }
                    if (edit.headers) applyHeaderEdits(headers, edit.headers)
                    if (edit.body !== undefined) body = Buffer.from(edit.body)
                    else if (edit.bodyReplace) {
                        const re = regex(edit.bodyReplace.pattern, 'gi')
                        if (re)
                            body = Buffer.from(
                                (await decoded())
                                    .toString('utf8')
                                    .replace(re, edit.bodyReplace.replacement)
                            )
                    }
                    applied.push(ruleLabel(rule))
                    break
                }
                case 'throttle':
                    decision.throttle = { latencyMs: rule.latencyMs, kbps: rule.kbps }
                    applied.push(ruleLabel(rule))
                    break
                case 'breakpoint':
                    if (rule.request && t) hold = true
                    break
            }
        }
        if (hold && t && !decision.local) {
            // Show the request as it stands after the rules above, then wait for the user.
            const original = body ?? (await decoded())
            this.describeRequest(t, method, url, headers)
            this.retain(t, 'request', original)
            t.paused = 'request'
            this.publish(t)
            const edit = await this.hold(id)
            t.paused = undefined
            applied.push('breakpoint')
            if (edit === 'abort') {
                decision.abort = 'Aborted at a Tapline breakpoint'
                t.rules = applied
                this.publish(t)
                return decision
            }
            if (edit.method) method = edit.method.toUpperCase()
            if (edit.url) {
                url = edit.url
                setHeader(headers, 'host', new URL(url).host)
            }
            if (edit.headers) headers = toWire(edit.headers)
            if (edit.body !== undefined && !t.requestBinary) body = Buffer.from(edit.body)
        }
        if (body !== undefined) {
            setHeader(headers, 'content-length', String(body.length))
            setHeader(headers, 'transfer-encoding', null)
            setHeader(headers, 'content-encoding', null)
        }
        if (t) {
            this.describeRequest(t, method, url, headers)
            t.rules = applied
            if (decision.local) {
                t.local = true
                t.status = decision.local.status
                t.statusMessage = http.STATUS_CODES[decision.local.status]
                t.responseHeaders = flatten({
                    ...decision.local.headers,
                    'content-length': String(decision.local.body.length)
                })
                t.responseBytes = decision.local.body.length
                this.retain(t, 'response', decision.local.body)
                // The core never reports a response for local answers; finish on the
                // client's body instead, which `requestEnd` seals.
            }
            this.publish(t)
        }
        if (method !== info.method) decision.method = method
        if (url !== info.url) decision.url = url
        decision.headers = headers
        if (body !== undefined) decision.body = body
        return decision
    }

    /** Update the record's request line for a rewritten method, URL or header set. */
    private describeRequest(t: Transaction, method: string, url: string, headers: WireHeaders) {
        t.method = method
        if (url !== t.url) {
            t.upstreamUrl = url
        }
        t.requestHeaders = flatten(headers)
    }

    private async localResponse(rule: Extract<Rule, { kind: 'mapLocal' }>) {
        const status = rule.status ?? 200
        if (rule.file) {
            try {
                const body = await readFile(rule.file)
                return {
                    status,
                    headers: { 'content-type': rule.contentType || mimeFor(rule.file) },
                    body
                }
            } catch (error) {
                this.log(`Map local: cannot read ${rule.file}: ${error}`, 'warn')
                return {
                    status: 404,
                    headers: { 'content-type': 'text/plain; charset=utf-8' },
                    body: Buffer.from(`Tapline: cannot read ${rule.file}\n`)
                }
            }
        }
        const body = rule.body ?? ''
        return {
            status,
            headers: { 'content-type': rule.contentType || mimeForBody(body) },
            body: Buffer.from(body)
        }
    }

    private hold(id: string) {
        return new Promise<BreakpointEdit | 'abort'>((resolve) => this.holds.set(id, resolve))
    }
    /** Resolve a held transaction as aborted, e.g. when its client went away. */
    private release(id: string) {
        const resolve = this.holds.get(id)
        if (!resolve) return
        this.holds.delete(id)
        resolve('abort')
    }
    /** Let a transaction held at a breakpoint continue, with the user's edits. */
    resume(id: string, edit: BreakpointEdit = {}) {
        const resolve = this.holds.get(id)
        if (!resolve) throw new Error('This request is not paused')
        this.holds.delete(id)
        resolve(edit)
    }
    /** Fail a transaction held at a breakpoint. */
    abort(id: string) {
        if (!this.holds.has(id)) throw new Error('This request is not paused')
        this.release(id)
    }

    requestData(id: string, chunk: Buffer) {
        this.capture(id, 'request', chunk)
    }
    requestEnd(id: string) {
        const body = this.seal(id, 'request')
        const t = this.transactions.get(id)
        if (!t) return
        if (body) this.decodeGrpc(t, 'request', body)
        if (t.local) {
            this.captures.delete(id)
            this.matched.delete(id)
            this.finish(t)
        } else this.publish(t)
    }

    private decodeGrpc(t: Transaction, side: 'request' | 'response', body: Buffer) {
        try {
            this.grpc.decorate(t, side, body)
        } catch (error) {
            this.log(`gRPC decode failed for ${t.path}: ${error}`, 'warn')
        }
    }
    async response(id: string, info: ResponseInfo): Promise<ResponseDecision | undefined> {
        const t = this.transactions.get(id)
        const rules = this.matched.get(id) ?? []
        const decision: ResponseDecision = {}
        let status = info.status
        let headers: WireHeaders = { ...info.headers }
        let body: Buffer | undefined
        const streaming =
            getHeader(headers, 'content-type')?.split(';')[0].trim().toLowerCase() ===
            'text/event-stream'
        const applied: string[] = []
        const decoded = async () =>
            decodeBody(body ?? (await info.body()), getHeader(headers, 'content-encoding')).bytes
        let hold = false
        for (const rule of rules) {
            if (rule.kind === 'rewrite' && rule.response) {
                const edit = rule.response
                if (edit.status) status = edit.status
                if (edit.headers) applyHeaderEdits(headers, edit.headers)
                if (!streaming) {
                    if (edit.body !== undefined) body = Buffer.from(edit.body)
                    else if (edit.bodyReplace) {
                        const re = regex(edit.bodyReplace.pattern, 'gi')
                        if (re)
                            body = Buffer.from(
                                (await decoded())
                                    .toString('utf8')
                                    .replace(re, edit.bodyReplace.replacement)
                            )
                    }
                }
                applied.push(ruleLabel(rule))
            } else if (rule.kind === 'throttle') decision.throttle = { kbps: rule.kbps }
            else if (rule.kind === 'breakpoint' && rule.response && t && !streaming) hold = true
        }
        if (t) {
            if (hold) {
                // Hand the user the decoded body; whatever they send back goes out plain.
                const original = body ?? (await decoded())
                if (body === undefined) setHeader(headers, 'content-encoding', null)
                this.describeResponse(t, status, headers, info)
                this.retain(t, 'response', original)
                t.paused = 'response'
                this.publish(t)
                const edit = await this.hold(id)
                t.paused = undefined
                applied.push('breakpoint')
                if (edit === 'abort') {
                    decision.abort = 'Aborted at a Tapline breakpoint'
                    t.rules = [...(t.rules ?? []), ...applied]
                    this.publish(t)
                    return decision
                }
                if (edit.status) status = edit.status
                if (edit.headers) headers = toWire(edit.headers)
                body =
                    edit.body !== undefined && !t.responseBinary ? Buffer.from(edit.body) : original
            }
            if (body !== undefined) {
                setHeader(headers, 'content-length', String(body.length))
                setHeader(headers, 'transfer-encoding', null)
                setHeader(headers, 'content-encoding', null)
            }
            this.describeResponse(t, status, headers, info)
            if (applied.length) t.rules = [...(t.rules ?? []), ...applied]
            if (info.timings) t.timings = info.timings
            this.trackEvents(t)
            this.publish(t)
        }
        if (!rules.length) return undefined
        if (status !== info.status) decision.status = status
        decision.headers = headers
        if (body !== undefined) decision.body = body
        return decision
    }

    private describeResponse(
        t: Transaction,
        status: number,
        headers: WireHeaders,
        info: ResponseInfo
    ) {
        t.status = status
        t.statusMessage =
            status === info.status
                ? (info.statusMessage ?? http.STATUS_CODES[status])
                : http.STATUS_CODES[status]
        t.httpVersion = info.httpVersion ?? t.httpVersion
        t.responseHeaders = flatten(headers)
    }

    /** Attach an SSE parser to `text/event-stream` responses so events show as they arrive. */
    private trackEvents(t: Transaction) {
        const contentType = Object.entries(t.responseHeaders).find(
            ([name]) => name.toLowerCase() === 'content-type'
        )?.[1]
        if (contentType?.split(';')[0].trim().toLowerCase() !== 'text/event-stream') return
        if (this.eventStreams.has(t)) return
        t.events = []
        let retained = 0
        const sizes: number[] = []
        const limit = this.settings.maxBodyBytes
        this.eventStreams.set(
            t,
            new SSEParser(
                limit,
                (event) => {
                    const size = Buffer.byteLength(event.data + event.event + event.lastEventId)
                    if (size > limit) {
                        t.eventsTruncated = true
                        return
                    }
                    t.events!.push({ ...event, id: randomUUID(), time: Date.now() })
                    sizes.push(size)
                    retained += size
                    while (t.events!.length > 500 || retained > limit) {
                        t.events!.shift()
                        retained -= sizes.shift()!
                        t.eventsTruncated = true
                    }
                },
                () => {
                    t.eventsTruncated = true
                }
            )
        )
    }
    responseData(id: string, chunk: Buffer) {
        this.capture(id, 'response', chunk)
        const t = this.transactions.get(id)
        const parser = t && this.eventStreams.get(t)
        if (!t || !parser) return
        parser.push(chunk)
        const capture = this.captures.get(id)?.response
        if (capture && t.responseBody.length < this.settings.maxBodyBytes)
            t.responseBody = Buffer.concat(capture.chunks).toString('utf8')
        this.publish(t)
    }
    responseEnd(id: string, trailers: Headers) {
        const body = this.seal(id, 'response')
        const t = this.transactions.get(id)
        if (!t) return
        if (Object.keys(trailers).length) t.responseTrailers = trailers
        if (body) this.decodeGrpc(t, 'response', body)
        this.captures.delete(id)
        this.matched.delete(id)
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
        this.matched.delete(id)
        this.release(id)
        if (!t) return
        if (t.state === 'pending') {
            if (t.scheme === 'connect' || t.frames.length || t.status === 101) this.finish(t)
            else this.finish(t, aborted ? 'Client disconnected' : undefined)
        }
    }
    failure(id: string, error: string) {
        const t = this.transactions.get(id)
        this.captures.delete(id)
        this.matched.delete(id)
        this.release(id)
        if (t) this.finish(t, error)
    }

    // ---- replay ------------------------------------------------------------

    /** Send a request through the proxy so it is captured like any other client. */
    async compose(input: ComposeRequest): Promise<Transaction> {
        if (!this.running || !this.root) throw new Error('Start capture before replaying requests')
        const target = new URL(input.url)
        if (!/^https?:$/.test(target.protocol))
            throw new Error('Only HTTP and HTTPS URLs can be replayed')
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
            if (
                ![
                    'content-length',
                    'transfer-encoding',
                    'host',
                    'connection',
                    'proxy-connection'
                ].includes(name.toLowerCase())
            )
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
                    if (!/^HTTP\/1\.[01] 200/.test(buffer))
                        return reject(
                            new Error(`Proxy refused CONNECT: ${buffer.split('\r\n')[0]}`)
                        )
                    resolve()
                }
                proxy.on('data', onData)
                proxy.once('error', reject)
            })
            socket = tls.connect({
                socket: proxy,
                servername: target.hostname,
                ca: [this.root.certificate]
            })
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
