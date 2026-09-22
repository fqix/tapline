// MCP tools and resources over the capture agent's transaction mirror.
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { z } from 'zod'
import type { Request, Responses } from '../protocol'
import {
    bytes,
    toCurl,
    toHAR,
    type AgentState,
    type Headers,
    type Transaction
} from '../../shared/model'
import { contentType, renderTransaction } from '../../utils/format'

type Method = Request['method']

/** What the tools need from the agent: its live transaction map, state and commands. */
export interface TrafficSource {
    transactions: Map<string, Transaction>
    state(): AgentState
    call<M extends Method>(
        method: M,
        args: Omit<Extract<Request, { method: M }>, 'method'>
    ): Promise<Responses[M]>
}

// Injected by esbuild from package.json; tests run the source and get the fallback.
const VERSION = process.env.TAPLINE_VERSION ?? '0.0.0'
const BODY_LIMIT = 20_000

const text = (value: unknown) => ({
    content: [
        {
            type: 'text' as const,
            text: typeof value === 'string' ? value : JSON.stringify(value, null, 2)
        }
    ]
})
const failure = (message: string) => ({ ...text(message), isError: true })

const iso = (ms: number) => new Date(ms).toISOString()

/** Compact row for listings: everything but headers, bodies, frames and events. */
function summarize(t: Transaction) {
    return {
        id: t.id,
        time: iso(t.timestamp),
        method: t.method,
        url: t.url,
        status: t.status ?? null,
        state: t.state,
        durationMs: t.state === 'pending' ? null : Math.round(t.duration),
        requestBytes: t.requestBytes,
        responseBytes: t.responseBytes,
        contentType: contentType(t.responseHeaders).split(';')[0] || null,
        protocol: `${t.scheme}${t.httpVersion ? ` HTTP/${t.httpVersion}` : ''}`,
        ...(t.error ? { error: t.error } : {}),
        ...(t.frames.length ? { websocketFrames: t.frames.length } : {}),
        ...(t.events ? { sseEvents: t.events.length } : {}),
        ...(t.grpc
            ? {
                  grpc: `${t.grpc.service}/${t.grpc.method}`,
                  grpcStatus: t.grpc.status ?? null
              }
            : {}),
        ...(t.replayOf ? { replayOf: t.replayOf } : {}),
        ...(t.rules?.length ? { rules: t.rules } : {}),
        ...(t.local ? { answeredLocally: true } : {}),
        ...(t.upstreamUrl ? { sentTo: t.upstreamUrl } : {}),
        ...(t.paused ? { pausedAt: t.paused } : {})
    }
}

function body(value: string, binary: boolean, limit: number) {
    if (binary) {
        const size = Math.floor((value.length * 3) / 4)
        return {
            binary: true,
            size,
            note: `binary body (${bytes(size)}); pass raw=true for base64`
        }
    }
    return value.length > limit
        ? { text: value.slice(0, limit), truncated: true, totalChars: value.length }
        : { text: value }
}

function matchStatus(t: Transaction, status: string) {
    const code = t.status
    if (/^\dxx$/i.test(status))
        return code !== undefined && Math.floor(code / 100) === Number(status[0])
    if (status === 'pending') return t.state === 'pending'
    if (status === 'error') return t.state === 'error'
    return String(code ?? '') === status
}

const headerText = (h: Headers) =>
    Object.entries(h)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')

export interface SessionSource {
    sessions(): Array<AgentState & { sessionId: string; workspaceName: string }>
    select(sessionId?: string): TrafficSource
}

export function createServer(source: TrafficSource | SessionSource) {
    const scope = new AsyncLocalStorage<TrafficSource>()
    const select = (sessionId?: string) => ('select' in source ? source.select(sessionId) : source)
    const agent = new Proxy({} as TrafficSource, {
        get: (_, property: keyof TrafficSource) => {
            const current = scope.getStore() ?? select()
            const value = current[property]
            return typeof value === 'function' ? value.bind(current) : value
        }
    })
    const server = new McpServer(
        { name: 'tapline', version: VERSION },
        {
            instructions:
                'Tapline captures HTTP(S), HTTP/2, HTTP/3, gRPC, WebSocket and SSE traffic from ' +
                'VS Code terminals and debug sessions. Use list_requests or search to find ' +
                'requests, get_request for headers and bodies, and replay or send to issue ' +
                'requests through the proxy. Bodies are truncated in get_request; use get_body ' +
                'to page through large ones. Requests must be captured while the capture is ' +
                'running (see status / start_capture). Use list_sessions and specify sessionId when multiple windows are connected.'
        }
    )

    if ('sessions' in source)
        server.registerTool(
            'list_sessions',
            {
                title: 'Capture sessions',
                description:
                    'List active windows and sessionIds. Select a sessionId for all other tools.',
                annotations: { readOnlyHint: true }
            },
            () => text(source.sessions())
        )

    const ordered = () => [...agent.transactions.values()].sort((a, b) => a.sequence - b.sequence)
    const find = (id: string) => {
        const t = agent.transactions.get(id)
        if (!t) throw new Error(`No captured request with id ${id}`)
        return t
    }
    /** Wrap a handler so a thrown error becomes a readable tool error. */
    const guard =
        <A>(fn: (args: A) => Promise<unknown> | unknown) =>
        async (args: A) => {
            try {
                return await scope.run(
                    select((args as { sessionId?: string })?.sessionId),
                    async () => text(await fn(args))
                )
            } catch (error) {
                return failure(error instanceof Error ? error.message : String(error))
            }
        }

    server.registerTool(
        'status',
        {
            inputSchema: { sessionId: z.string().optional() },
            title: 'Capture status',
            description:
                'Whether Tapline is capturing, on which proxy port, and how many requests are retained.',
            annotations: { readOnlyHint: true }
        },
        guard(() => {
            const s = agent.state()
            const items = ordered()
            return {
                running: s.running,
                recording: s.recording,
                proxy: s.running ? `http://127.0.0.1:${s.port}` : null,
                certificatePath: s.certificatePath,
                requests: items.length,
                pending: items.filter((t) => t.state === 'pending').length,
                hosts: [...new Set(items.map((t) => t.host))].sort(),
                oldest: items[0] ? iso(items[0].timestamp) : null,
                newest: items.at(-1) ? iso(items.at(-1)!.timestamp) : null
            }
        })
    )

    server.registerTool(
        'list_requests',
        {
            title: 'List captured requests',
            description:
                'Captured requests, newest last, without headers or bodies. Filter by host, method, status (e.g. 404, 5xx, pending, error), a substring of the URL, or a time window.',
            inputSchema: {
                sessionId: z
                    .string()
                    .optional()
                    .describe(
                        'Window session from list_sessions; required when multiple windows are connected'
                    ),
                host: z.string().optional().describe('Exact host name'),
                method: z.string().optional().describe('HTTP method, case-insensitive'),
                status: z
                    .string()
                    .optional()
                    .describe('Status code, class like 4xx, or pending / error'),
                url: z.string().optional().describe('Case-insensitive substring of the URL'),
                since: z
                    .string()
                    .optional()
                    .describe('ISO timestamp; only requests started at or after it'),
                limit: z.number().int().min(1).max(500).default(50),
                offset: z.number().int().min(0).default(0).describe('Skip this many newest rows')
            },
            annotations: { readOnlyHint: true }
        },
        guard(({ host, method, status, url, since, limit, offset }) => {
            const after = since ? Date.parse(since) : NaN
            const needle = url?.toLowerCase()
            const all = ordered().filter(
                (t) =>
                    (!host || t.host === host) &&
                    (!method || t.method.toLowerCase() === method.toLowerCase()) &&
                    (!status || matchStatus(t, status)) &&
                    (!needle || t.url.toLowerCase().includes(needle)) &&
                    (Number.isNaN(after) || t.timestamp >= after)
            )
            const end = Math.max(0, all.length - offset)
            const page = all.slice(Math.max(0, end - limit), end)
            return { total: all.length, returned: page.length, requests: page.map(summarize) }
        })
    )

    server.registerTool(
        'get_request',
        {
            title: 'Get a captured request',
            description:
                'Full request and response: headers, bodies (truncated to maxBodyChars), timings, WebSocket frames and SSE events.',
            inputSchema: {
                sessionId: z
                    .string()
                    .optional()
                    .describe(
                        'Window session from list_sessions; required when multiple windows are connected'
                    ),
                id: z.string(),
                maxBodyChars: z.number().int().min(0).max(1_000_000).default(BODY_LIMIT),
                raw: z
                    .boolean()
                    .default(false)
                    .describe('Return binary bodies as base64 instead of a size note')
            },
            annotations: { readOnlyHint: true }
        },
        guard(({ id, maxBodyChars, raw }) => {
            const t = find(id)
            const bodyOf = (value: string, binary: boolean) =>
                raw && binary ? { base64: value } : body(value, binary, maxBodyChars)
            return {
                ...summarize(t),
                host: t.host,
                path: t.path,
                client: t.client,
                tls: t.tls,
                statusMessage: t.statusMessage,
                timings: t.timings,
                ...(t.grpc ? { grpc: t.grpc } : {}),
                request: {
                    headers: t.requestHeaders,
                    body: bodyOf(t.requestBody, t.requestBinary)
                },
                response: {
                    headers: t.responseHeaders,
                    ...(t.responseTrailers ? { trailers: t.responseTrailers } : {}),
                    body: bodyOf(t.responseBody, t.responseBinary),
                    ...(t.truncated ? { bodyTruncatedByCaptureLimit: true } : {})
                },
                ...(t.frames.length
                    ? {
                          frames: t.frames.slice(-200).map((f) => ({
                              time: iso(f.time),
                              direction: f.direction,
                              ...(f.binary ? { base64: f.data } : { data: f.data })
                          }))
                      }
                    : {}),
                ...(t.events
                    ? {
                          events: t.events.slice(-200).map((e) => ({
                              time: iso(e.time),
                              event: e.event,
                              id: e.lastEventId,
                              data: e.data
                          }))
                      }
                    : {}),
                curl: toCurl(t)
            }
        })
    )

    server.registerTool(
        'get_body',
        {
            title: 'Read part of a body',
            description:
                'A window of a request or response body, for bodies larger than get_request returns.',
            inputSchema: {
                sessionId: z
                    .string()
                    .optional()
                    .describe(
                        'Window session from list_sessions; required when multiple windows are connected'
                    ),
                id: z.string(),
                side: z.enum(['request', 'response']),
                offset: z.number().int().min(0).default(0),
                length: z.number().int().min(1).max(1_000_000).default(BODY_LIMIT)
            },
            annotations: { readOnlyHint: true }
        },
        guard(({ id, side, offset, length }) => {
            const t = find(id)
            const value = side === 'request' ? t.requestBody : t.responseBody
            const binary = side === 'request' ? t.requestBinary : t.responseBinary
            return {
                encoding: binary ? 'base64' : 'utf8',
                totalChars: value.length,
                offset,
                text: value.slice(offset, offset + length)
            }
        })
    )

    server.registerTool(
        'search',
        {
            title: 'Search captured traffic',
            description:
                'Regular-expression search over URLs, headers and text bodies of captured requests.',
            inputSchema: {
                sessionId: z
                    .string()
                    .optional()
                    .describe(
                        'Window session from list_sessions; required when multiple windows are connected'
                    ),
                pattern: z.string().describe('JavaScript regular expression, case-insensitive'),
                scope: z.enum(['url', 'headers', 'body', 'all']).default('all'),
                limit: z.number().int().min(1).max(200).default(30)
            },
            annotations: { readOnlyHint: true }
        },
        guard(({ pattern, scope, limit }) => {
            const re = new RegExp(pattern, 'i')
            const hits: unknown[] = []
            for (const t of ordered().reverse()) {
                const fields: [string, string][] = []
                if (scope === 'url' || scope === 'all') fields.push(['url', t.url])
                if (scope === 'headers' || scope === 'all')
                    fields.push(
                        ['requestHeaders', headerText(t.requestHeaders)],
                        ['responseHeaders', headerText(t.responseHeaders)]
                    )
                if (scope === 'body' || scope === 'all') {
                    if (!t.requestBinary) fields.push(['requestBody', t.requestBody])
                    if (!t.responseBinary) fields.push(['responseBody', t.responseBody])
                }
                for (const [field, value] of fields) {
                    const m = re.exec(value)
                    if (!m) continue
                    const start = Math.max(0, m.index - 80)
                    hits.push({
                        ...summarize(t),
                        matchedIn: field,
                        snippet: value.slice(start, m.index + m[0].length + 80)
                    })
                    break
                }
                if (hits.length >= limit) break
            }
            return { returned: hits.length, matches: hits }
        })
    )

    server.registerTool(
        'replay',
        {
            title: 'Replay a request',
            description:
                'Send a captured request again through the proxy and return the new transaction.',
            inputSchema: {
                sessionId: z
                    .string()
                    .optional()
                    .describe(
                        'Window session from list_sessions; required when multiple windows are connected'
                    ),
                id: z.string()
            }
        },
        guard(async ({ id }) => {
            const t = find(id)
            if (t.scheme === 'connect' || t.frames.length || t.status === 101 || t.requestBinary)
                throw new Error('Only HTTP requests with text bodies can be replayed')
            const replayed = await agent.call('compose', {
                request: {
                    url: t.url,
                    method: t.method,
                    headers: t.requestHeaders,
                    body: t.requestBody,
                    replayOf: t.id
                }
            })
            return summarize(replayed)
        })
    )

    server.registerTool(
        'send',
        {
            title: 'Send a request',
            description:
                'Issue an HTTP request through the Tapline proxy so it is captured like any other; returns the completed transaction.',
            inputSchema: {
                sessionId: z
                    .string()
                    .optional()
                    .describe(
                        'Window session from list_sessions; required when multiple windows are connected'
                    ),
                url: z.string().url(),
                method: z.string().default('GET'),
                headers: z.record(z.string(), z.string()).default({}),
                body: z.string().default('')
            }
        },
        guard(async ({ url, method, headers, body: payload }) => {
            const t = await agent.call('compose', {
                request: { url, method: method.toUpperCase(), headers, body: payload }
            })
            return {
                ...summarize(t),
                response: {
                    headers: t.responseHeaders,
                    body: body(t.responseBody, t.responseBinary, BODY_LIMIT)
                }
            }
        })
    )

    server.registerTool(
        'start_capture',
        {
            inputSchema: { sessionId: z.string().optional() },
            title: 'Start capture',
            description: 'Start the capture proxy.'
        },
        guard(async () => {
            const s = await agent.call('start', {})
            return { running: s.running, proxy: `http://127.0.0.1:${s.port}` }
        })
    )
    server.registerTool(
        'stop_capture',
        {
            inputSchema: { sessionId: z.string().optional() },
            title: 'Stop capture',
            description: 'Stop the capture proxy.'
        },
        guard(async () => ({ running: (await agent.call('stop', {})).running }))
    )
    server.registerTool(
        'set_recording',
        {
            title: 'Pause or resume recording',
            description: 'Keep the proxy running but pause or resume recording of new requests.',
            inputSchema: {
                sessionId: z
                    .string()
                    .optional()
                    .describe(
                        'Window session from list_sessions; required when multiple windows are connected'
                    ),
                recording: z.boolean()
            }
        },
        guard(async ({ recording }) => ({
            recording: (await agent.call('record', { value: recording })).recording
        }))
    )
    server.registerTool(
        'clear',
        {
            inputSchema: { sessionId: z.string().optional() },
            title: 'Clear captured requests',
            description: 'Discard every captured request.',
            annotations: { destructiveHint: true }
        },
        guard(async () => {
            await agent.call('clear', {})
            return 'Cleared'
        })
    )
    server.registerTool(
        'delete',
        {
            title: 'Delete captured requests',
            description: 'Discard the given requests.',
            inputSchema: {
                sessionId: z
                    .string()
                    .optional()
                    .describe(
                        'Window session from list_sessions; required when multiple windows are connected'
                    ),
                ids: z.array(z.string()).min(1)
            },
            annotations: { destructiveHint: true }
        },
        guard(async ({ ids }) => {
            await agent.call('delete', { ids })
            return `Deleted ${ids.length}`
        })
    )

    server.registerTool(
        'export_har',
        {
            title: 'Export HAR',
            description:
                'HTTP Archive (HAR 1.2) JSON of completed HTTP requests, optionally limited to the given ids or host.',
            inputSchema: {
                sessionId: z
                    .string()
                    .optional()
                    .describe(
                        'Window session from list_sessions; required when multiple windows are connected'
                    ),
                ids: z.array(z.string()).optional(),
                host: z.string().optional(),
                limit: z.number().int().min(1).max(500).default(100)
            },
            annotations: { readOnlyHint: true }
        },
        guard(({ ids, host, limit }) => {
            const wanted = ids ? new Set(ids) : undefined
            const items = ordered()
                .filter(
                    (t) =>
                        (!wanted || wanted.has(t.id)) &&
                        (!host || t.host === host) &&
                        t.state !== 'pending' &&
                        t.scheme !== 'connect' &&
                        t.status !== 101
                )
                .slice(-limit)
            if (!items.length) throw new Error('Nothing to export')
            return JSON.stringify(toHAR(items, { name: 'Tapline', version: VERSION }))
        })
    )

    server.registerResource(
        'request',
        new ResourceTemplate('tapline://requests/{id}', { list: undefined }),
        {
            title: 'Captured request',
            description: 'A captured request and its response as text',
            mimeType: 'text/plain'
        },
        async (uri, { id }) => {
            return {
                contents: [
                    {
                        uri: uri.href,
                        mimeType: 'text/plain',
                        text: scope.run(
                            select(uri.searchParams.get('sessionId') ?? undefined),
                            () => renderTransaction(find(String(id)))
                        )
                    }
                ]
            }
        }
    )

    if ('sessions' in source)
        server.registerResource(
            'session-request',
            new ResourceTemplate('tapline://sessions/{sessionId}/requests/{id}', {
                list: undefined
            }),
            { title: 'Window captured request', mimeType: 'text/plain' },
            async (uri, { sessionId, id }) => ({
                contents: [
                    {
                        uri: uri.href,
                        mimeType: 'text/plain',
                        text: scope.run(select(String(sessionId)), () =>
                            renderTransaction(find(String(id)))
                        )
                    }
                ]
            })
        )

    return server
}
