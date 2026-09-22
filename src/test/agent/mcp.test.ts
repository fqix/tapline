import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer, type TrafficSource } from '../../agent/mcp/server'
import type { AgentState, Transaction } from '../../shared/model'

const make = (sequence: number, url: string, extra: Partial<Transaction> = {}): Transaction => {
    const u = new URL(url)
    return {
        id: `t${sequence}`,
        sequence,
        timestamp: 1_700_000_000_000 + sequence * 1000,
        method: 'GET',
        url,
        host: u.hostname,
        path: u.pathname + u.search,
        scheme: u.protocol.replace(':', ''),
        client: '127.0.0.1:1',
        state: 'completed',
        status: 200,
        requestHeaders: { Accept: '*/*' },
        responseHeaders: { 'Content-Type': 'application/json' },
        requestBody: '',
        responseBody: '{"ok":true}',
        requestBinary: false,
        responseBinary: false,
        requestBytes: 100,
        responseBytes: 11,
        truncated: false,
        duration: 12,
        tls: u.protocol === 'https:',
        frames: [],
        ...extra
    }
}

/** Stand-in for the socket-backed connection: a fixed mirror plus recorded calls. */
function fakeAgent(items: Transaction[]) {
    const calls: unknown[] = []
    const state: AgentState = {
        running: true,
        recording: true,
        port: 3606,
        certificatePath: '/ca.pem',
        truststorePath: '',
        clients: 1,
        pid: 1
    }
    const agent = {
        transactions: new Map(items.map((t) => [t.id, t])),
        state: () => state,
        call: async (method: string, args: Record<string, unknown>) => {
            calls.push({ method, ...args })
            if (method === 'compose') {
                const request = args.request as { url: string; method: string; replayOf?: string }
                return make(99, request.url, {
                    method: request.method,
                    replayOf: request.replayOf,
                    responseBody: 'replayed'
                })
            }
            if (method === 'stop') return { ...state, running: false }
            return state
        }
    }
    return { agent: agent as unknown as TrafficSource, calls }
}

async function connect(agent: TrafficSource) {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    const server = createServer(agent)
    await server.connect(serverSide)
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(clientSide)
    const tool = async (name: string, args: Record<string, unknown> = {}) => {
        const result = (await client.callTool({ name, arguments: args })) as {
            content: { type: string; text: string }[]
            isError?: boolean
        }
        const text = result.content[0].text
        try {
            return { ...result, data: JSON.parse(text) }
        } catch {
            return { ...result, data: text }
        }
    }
    return { client, tool }
}

const items = [
    make(1, 'https://api.example.com/v1/users?page=1'),
    make(2, 'https://api.example.com/v1/users/42', {
        method: 'POST',
        status: 404,
        requestBody: '{"name":"x"}',
        responseBody: '{"error":"missing user 42"}'
    }),
    make(3, 'https://cdn.example.com/app.js', { state: 'pending', status: undefined }),
    make(4, 'https://api.example.com/big', {
        responseBody: 'a'.repeat(50_000),
        responseBytes: 50_000
    }),
    make(5, 'wss://ws.example.com/socket', {
        status: 101,
        frames: [{ id: 'f', time: 0, direction: 'send', binary: false, data: 'hi' }]
    })
]

describe('MCP server', () => {
    it('lists tools and reports status', async () => {
        const { agent } = fakeAgent(items)
        const { client, tool } = await connect(agent)
        const names = (await client.listTools()).tools.map((t) => t.name).sort()
        expect(names).toEqual([
            'clear',
            'delete',
            'export_har',
            'get_body',
            'get_request',
            'list_requests',
            'replay',
            'search',
            'send',
            'set_recording',
            'start_capture',
            'status',
            'stop_capture'
        ])
        const status = await tool('status')
        expect(status.data).toMatchObject({
            running: true,
            proxy: 'http://127.0.0.1:3606',
            requests: 5,
            pending: 1,
            hosts: ['api.example.com', 'cdn.example.com', 'ws.example.com']
        })
    })

    it('filters and pages listings', async () => {
        const { tool } = await connect(fakeAgent(items).agent)
        expect(
            (await tool('list_requests', { status: '4xx' })).data.requests.map((r: any) => r.id)
        ).toEqual(['t2'])
        expect(
            (await tool('list_requests', { status: 'pending' })).data.requests.map((r: any) => r.id)
        ).toEqual(['t3'])
        expect(
            (await tool('list_requests', { host: 'api.example.com', url: 'users' })).data.total
        ).toBe(2)
        const page = await tool('list_requests', { limit: 2, offset: 1 })
        expect(page.data.requests.map((r: any) => r.id)).toEqual(['t3', 't4'])
        expect(page.data.requests[0]).not.toHaveProperty('request')
    })

    it('returns full requests with truncated bodies and pages bodies', async () => {
        const { tool } = await connect(fakeAgent(items).agent)
        const full = await tool('get_request', { id: 't2' })
        expect(full.data.request.headers).toEqual({ Accept: '*/*' })
        expect(full.data.response.body).toEqual({ text: '{"error":"missing user 42"}' })
        expect(full.data.curl).toContain('--data-raw \'{"name":"x"}\'')
        const big = await tool('get_request', { id: 't4', maxBodyChars: 100 })
        expect(big.data.response.body).toMatchObject({ truncated: true, totalChars: 50_000 })
        expect(big.data.response.body.text).toHaveLength(100)
        const window = await tool('get_body', {
            id: 't4',
            side: 'response',
            offset: 49_990,
            length: 100
        })
        expect(window.data.text).toHaveLength(10)
        const missing = await tool('get_request', { id: 'nope' })
        expect(missing.isError).toBe(true)
    })

    it('searches urls, headers and bodies', async () => {
        const { tool } = await connect(fakeAgent(items).agent)
        const hits = await tool('search', { pattern: 'missing user \\d+', scope: 'body' })
        expect(hits.data.matches).toHaveLength(1)
        expect(hits.data.matches[0]).toMatchObject({ id: 't2', matchedIn: 'responseBody' })
        expect(
            (await tool('search', { pattern: 'app\\.js', scope: 'headers' })).data.returned
        ).toBe(0)
        expect((await tool('search', { pattern: 'app\\.js' })).data.returned).toBe(1)
    })

    it('replays, sends and controls capture through the agent', async () => {
        const { agent, calls } = fakeAgent(items)
        const { tool } = await connect(agent)
        const replayed = await tool('replay', { id: 't2' })
        expect(replayed.data).toMatchObject({ id: 't99', method: 'POST', replayOf: 't2' })
        expect(calls[0]).toMatchObject({
            method: 'compose',
            request: { replayOf: 't2', body: '{"name":"x"}' }
        })
        expect((await tool('replay', { id: 't5' })).isError).toBe(true)
        const sent = await tool('send', { url: 'https://api.example.com/ping', method: 'post' })
        expect(sent.data.response.body).toEqual({ text: 'replayed' })
        expect(calls.at(-1)).toMatchObject({ method: 'compose', request: { method: 'POST' } })
        expect((await tool('stop_capture')).data).toEqual({ running: false })
        await tool('set_recording', { recording: false })
        await tool('delete', { ids: ['t1'] })
        await tool('clear')
        expect(calls.slice(-4).map((c: any) => c.method)).toEqual([
            'stop',
            'record',
            'delete',
            'clear'
        ])
    })

    it('exports HAR for completed HTTP requests', async () => {
        const { tool } = await connect(fakeAgent(items).agent)
        const har = await tool('export_har', { host: 'api.example.com' })
        expect(har.data.log.entries.map((e: any) => e.request.url)).toEqual([
            'https://api.example.com/v1/users?page=1',
            'https://api.example.com/v1/users/42',
            'https://api.example.com/big'
        ])
        expect((await tool('export_har', { host: 'cdn.example.com' })).isError).toBe(true)
    })

    it('serves a request as a text resource', async () => {
        const { client } = await connect(fakeAgent(items).agent)
        const result = await client.readResource({ uri: 'tapline://requests/t2' })
        expect((result.contents[0] as { text: string }).text).toContain(
            'POST https://api.example.com/v1/users/42'
        )
    })
})
