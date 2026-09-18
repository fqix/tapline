// Data contract shared by the agent, the extension and tests. Browser-safe: no node imports.

export type Headers = Record<string, string>

export interface Frame {
    id: string
    time: number
    direction: 'send' | 'receive'
    binary: boolean
    /** UTF-8 text, or base64 when `binary`. */
    data: string
}

export interface ServerEvent {
    id: string
    time: number
    event: string
    data: string
    lastEventId: string
    retry?: number
}

export interface Timings {
    dns?: number
    connect?: number
    tls?: number
    send?: number
    wait?: number
    receive?: number
}

export type TransactionState = 'pending' | 'completed' | 'error'

/** One length-prefixed gRPC message, decoded with the schema when one matched. */
export interface GrpcMessage {
    index: number
    size: number
    compressed: boolean
    /** Fully qualified protobuf type when decoded from a schema. */
    type?: string
    /** Decoded fields: names from the schema, or field numbers without one. */
    body?: unknown
    error?: string
}

export interface GrpcInfo {
    service: string
    method: string
    /** gRPC-Web (trailers travel in the body). */
    web: boolean
    encoding?: string
    requestType?: string
    responseType?: string
    request: GrpcMessage[]
    response: GrpcMessage[]
    /** From `grpc-status` in the trailers (or headers for trailers-only responses). */
    status?: number
    statusMessage?: string
}

export const grpcStatusNames = [
    'OK',
    'CANCELLED',
    'UNKNOWN',
    'INVALID_ARGUMENT',
    'DEADLINE_EXCEEDED',
    'NOT_FOUND',
    'ALREADY_EXISTS',
    'PERMISSION_DENIED',
    'RESOURCE_EXHAUSTED',
    'FAILED_PRECONDITION',
    'ABORTED',
    'OUT_OF_RANGE',
    'UNIMPLEMENTED',
    'INTERNAL',
    'UNAVAILABLE',
    'DATA_LOSS',
    'UNAUTHENTICATED'
]
export const grpcStatusName = (code: number) => grpcStatusNames[code] ?? String(code)

export interface Transaction {
    id: string
    sequence: number
    timestamp: number
    method: string
    url: string
    host: string
    path: string
    /** http, https, ws, wss or connect */
    scheme: string
    httpVersion?: string
    client: string
    state: TransactionState
    status?: number
    statusMessage?: string
    requestHeaders: Headers
    responseHeaders: Headers
    responseTrailers?: Headers
    requestBody: string
    responseBody: string
    /** Bodies are base64 when the bytes are not valid UTF-8. */
    requestBinary: boolean
    responseBinary: boolean
    requestBytes: number
    responseBytes: number
    /** Retained bytes were capped; the traffic itself was forwarded in full. */
    truncated: boolean
    duration: number
    timings?: Timings
    tls: boolean
    error?: string
    frames: Frame[]
    /** Present for text/event-stream responses, including streams awaiting their first event. */
    events?: ServerEvent[]
    eventsTruncated?: boolean
    /** Present for gRPC and gRPC-Web calls; messages decoded from the retained bodies. */
    grpc?: GrpcInfo
    replayOf?: string
}

export interface Settings {
    port: number
    ssl: boolean
    sslHosts: string[]
    maxEntries: number
    maxBodyBytes: number
    /** Absolute paths of .proto files used to decode gRPC messages. */
    protoFiles: string[]
}

export const defaultSettings: Settings = {
    port: 3606,
    ssl: true,
    sslHosts: ['*'],
    maxEntries: 2000,
    maxBodyBytes: 512 * 1024,
    protoFiles: []
}

export interface LogEntry {
    time: number
    level: 'info' | 'warn' | 'error'
    message: string
}

export interface ComposeRequest {
    url: string
    method: string
    headers: Headers
    body: string
    replayOf?: string
}

export interface AgentState {
    running: boolean
    recording: boolean
    port: number
    certificatePath: string
    /** PKCS#12 trust store (public roots + Tapline CA) for JVM clients. */
    truststorePath: string
    clients: number
    pid: number
    coreVersion?: string
}

export type Event =
    | { type: 'transaction'; transaction: Transaction }
    | { type: 'reset' }
    | { type: 'log'; log: LogEntry }
    | { type: 'state'; state: AgentState }

/** Wildcard host match: `*` any, `*.example.com` subdomains, exact otherwise. */
export function matchHost(pattern: string, host: string): boolean {
    const p = pattern.trim().toLowerCase()
    const h = host.toLowerCase()
    if (!p) return false
    if (p === '*') return true
    if (p.startsWith('*.')) return h === p.slice(2) || h.endsWith(p.slice(1))
    if (p.includes('*')) return new RegExp('^' + p.split('*').map(escape).join('.*') + '$').test(h)
    return h === p
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function toCurl(
    t: Pick<Transaction, 'method' | 'url' | 'requestHeaders' | 'requestBody' | 'requestBinary'>
) {
    const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'"
    const parts = ['curl', '-X', t.method, quote(t.url)]
    for (const [name, value] of Object.entries(t.requestHeaders))
        if (
            !['host', 'content-length', 'connection', 'transfer-encoding'].includes(
                name.toLowerCase()
            )
        )
            parts.push('-H', quote(`${name}: ${value}`))
    if (t.requestBody && !t.requestBinary) parts.push('--data-raw', quote(t.requestBody))
    return parts.join(' ')
}

export function pretty(text: string): string {
    try {
        return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
        return text
    }
}

export function bytes(n: number): string {
    return n < 1024
        ? `${n} B`
        : n < 1048576
          ? `${(n / 1024).toFixed(1)} KB`
          : `${(n / 1048576).toFixed(1)} MB`
}

export function duration(ms: number): string {
    return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`
}

/** HAR 1.2 export of completed HTTP transactions. */
export function toHAR(items: Transaction[], creator = { name: 'Tapline', version: '0.1.0' }) {
    const headers = (h: Headers) => Object.entries(h).map(([name, value]) => ({ name, value }))
    const mime = (h: Headers) =>
        Object.entries(h).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
    return {
        log: {
            version: '1.2',
            creator,
            entries: items.map((t) => {
                const url = new URL(t.url)
                return {
                    startedDateTime: new Date(t.timestamp).toISOString(),
                    time: t.duration,
                    request: {
                        method: t.method,
                        url: t.url,
                        httpVersion: `HTTP/${t.httpVersion ?? '1.1'}`,
                        cookies: [],
                        headers: headers(t.requestHeaders),
                        queryString: [...url.searchParams].map(([name, value]) => ({
                            name,
                            value
                        })),
                        headersSize: -1,
                        bodySize: t.requestBytes,
                        ...(t.requestBody
                            ? {
                                  postData: {
                                      mimeType: mime(t.requestHeaders),
                                      text: t.requestBody,
                                      ...(t.requestBinary ? { encoding: 'base64' } : {})
                                  }
                              }
                            : {})
                    },
                    response: {
                        status: t.status ?? 0,
                        statusText: t.statusMessage ?? '',
                        httpVersion: `HTTP/${t.httpVersion ?? '1.1'}`,
                        cookies: [],
                        headers: headers(t.responseHeaders),
                        content: {
                            size: t.responseBytes,
                            mimeType: mime(t.responseHeaders),
                            text: t.responseBody,
                            ...(t.responseBinary ? { encoding: 'base64' } : {})
                        },
                        redirectURL: t.responseHeaders.location ?? '',
                        headersSize: -1,
                        bodySize: t.responseBytes
                    },
                    cache: {},
                    timings: {
                        blocked: -1,
                        dns: t.timings?.dns ?? -1,
                        connect: t.timings?.connect ?? -1,
                        ssl: t.timings?.tls ?? -1,
                        send: t.timings?.send ?? 0,
                        wait: t.timings?.wait ?? 0,
                        receive: t.timings?.receive ?? 0
                    },
                    serverIPAddress: '',
                    _client: t.client
                }
            })
        }
    }
}
