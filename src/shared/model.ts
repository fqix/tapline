// Data contract shared by the agent, the extension and tests. Browser-safe: no node imports.

export type Headers = Record<string, string>

export interface Frame {
    id: string
    time: number
    direction: 'send' | 'receive'
    binary: boolean
    /** UTF-8 text, or base64 when `binary`. */
    data: string
    /** Original payload size, before the capture limit is applied. */
    size?: number
    truncated?: boolean
    /** Captured message resent on this connection. */
    replayOf?: string
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
    /** Session-scoped annotations shared by every window. */
    note?: string
    marked?: boolean
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
    framesTruncated?: boolean
    /** Present for text/event-stream responses, including streams awaiting their first event. */
    events?: ServerEvent[]
    eventsTruncated?: boolean
    /** Present for gRPC and gRPC-Web calls; messages decoded from the retained bodies. */
    grpc?: GrpcInfo
    replayOf?: string
    /** Set while a breakpoint holds the request or the response; cleared when it continues. */
    paused?: RulePhase
    /** Names of the rules that acted on this transaction, in the order they applied. */
    rules?: string[]
    /** The response was produced by Tapline (map local, block) instead of the server. */
    local?: boolean
    /** Where the request was actually sent when a rule changed its URL. */
    upstreamUrl?: string
    /** Content-Encoding the retained response body was decoded from. */
    responseEncoding?: string
    /** Upstream endpoint (`ip:port`) the response came from, or the tunnel target. */
    serverAddress?: string
}

// ---- rules ---------------------------------------------------------------

export type RulePhase = 'request' | 'response'
export type RuleKind = 'breakpoint' | 'rewrite' | 'mapLocal' | 'mapRemote' | 'block' | 'throttle'
export const ruleKinds: RuleKind[] = [
    'breakpoint',
    'rewrite',
    'mapLocal',
    'mapRemote',
    'block',
    'throttle'
]

/** Header, status, URL and body edits applied by a rewrite rule (or at a breakpoint). */
export interface Edit {
    method?: string
    /** Regular-expression replacement over the whole URL. */
    url?: { pattern: string; replacement: string }
    status?: number
    /** Header values to set; `null` removes the header. Names are case-insensitive. */
    headers?: Record<string, string | null>
    /** Replace the whole body (text). */
    body?: string
    /** Regular-expression replacement over a text body (`g` and `i` flags). */
    bodyReplace?: { pattern: string; replacement: string }
}

interface RuleBase {
    id: string
    enabled: boolean
    name?: string
    /** Wildcard URL pattern (`*` matches any run of characters); empty matches every URL. */
    url?: string
    /** Comma-separated methods, case-insensitive; empty matches every method. */
    method?: string
}

export type Rule = RuleBase &
    (
        | { kind: 'breakpoint'; request?: boolean; response?: boolean }
        | { kind: 'rewrite'; request?: Edit; response?: Edit }
        | {
              kind: 'mapLocal'
              /** Absolute file path served as the response; `body` is used when empty. */
              file?: string
              body?: string
              status?: number
              contentType?: string
          }
        | {
              kind: 'mapRemote'
              /** Origin (scheme://host[:port]) the request is sent to instead; a path prefix is kept. */
              to: string
          }
        | { kind: 'block'; status?: number }
        | { kind: 'throttle'; latencyMs?: number; kbps?: number }
    )

/** Fields a user can change while a transaction is held at a breakpoint. */
export interface BreakpointEdit {
    method?: string
    url?: string
    status?: number
    headers?: Headers
    /** Text body; omitted keeps the original bytes (binary bodies cannot be edited). */
    body?: string
}

/** `*` matches any run of characters (including `/`); everything else is literal. */
export function matchWildcard(pattern: string, value: string): boolean {
    const p = pattern.trim()
    if (!p || p === '*') return true
    if (!p.includes('*')) return value === p || value.startsWith(p)
    return new RegExp('^' + p.split('*').map(escape).join('.*') + '$', 'i').test(value)
}

export function ruleMatches(rule: Pick<Rule, 'url' | 'method'>, method: string, url: string) {
    if (rule.method?.trim()) {
        const wanted = rule.method
            .split(',')
            .map((m) => m.trim().toUpperCase())
            .filter(Boolean)
        if (wanted.length && !wanted.includes(method.toUpperCase())) return false
    }
    return matchWildcard(rule.url ?? '', url)
}

export const ruleLabel = (rule: Rule) => rule.name?.trim() || rule.kind

export interface Settings {
    /** Proxy port; 0 asks the core for a free one. Defaults to 3606. */
    port: number
    sslHosts: string[]
    /** Host patterns excluded from HTTPS decryption (opaque tunnel). */
    sslNoHosts: string[]
    /**
     * Accept any upstream certificate on decrypted connections. Off by default: the
     * client only ever sees our own leaf, so a rejected upstream chain would otherwise
     * be invisible. Turn it on for self-signed or expired development backends.
     */
    insecureUpstream: boolean
    maxEntries: number
    maxBodyBytes: number
    /** Loopback port of the MCP endpoint; 0 disables it. */
    mcpPort: number
    /** Absolute paths of .proto files used to decode gRPC messages. */
    protoFiles: string[]
    /** Interception rules, applied in order. */
    rules: Rule[]
}

export const defaultSettings: Settings = {
    port: 3606,
    sslHosts: ['*'],
    sslNoHosts: [],
    insecureUpstream: false,
    maxEntries: 2000,
    maxBodyBytes: 512 * 1024,
    mcpPort: 3607,
    protoFiles: [],
    rules: []
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
    /** Binary payloads are transported losslessly through the webview as base64. */
    bodyEncoding?: 'base64'
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
    corePid?: number
    coreVersion?: string
    /** Extension release running the shared agent; used for upgrade handover. */
    agentVersion?: string
    /** Port the MCP endpoint is listening on, 0 when disabled or failed. */
    mcpPort?: number
    /** Modification time of the agent script, so clients notice a stale agent. */
    build?: number
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

/**
 * Checks if a host should be intercepted according to patterns.
 * Patterns starting with `!` are exclusion rules (e.g. `!*.alayanew.com` or `!vcluster.*`).
 * A host is intercepted if it matches at least one positive pattern and does not match any negative pattern.
 */
export function isHostIntercepted(patterns: readonly string[], host: string): boolean {
    const positive: string[] = []
    const negative: string[] = []
    for (const p of patterns) {
        const trimmed = p.trim()
        if (trimmed.startsWith('!')) {
            if (trimmed.length > 1) negative.push(trimmed.slice(1))
        } else if (trimmed) {
            positive.push(trimmed)
        }
    }
    if (negative.some((p) => matchHost(p, host))) return false
    return positive.some((p) => matchHost(p, host))
}

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

export function formatHttpVersion(v?: string): string {
    if (!v) return ''
    return v.startsWith('HTTP/') ? v : `HTTP/${v}`
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
                    serverIPAddress:
                        t.serverAddress?.replace(/:\d+$/, '').replace(/^\[|\]$/g, '') ?? '',
                    _client: t.client
                }
            })
        }
    }
}
