import { describe, expect, it } from 'vitest'
import type { Transaction } from '../shared/model'
import { searchTransactions } from '../utils/search'
import {
    defaultFilters,
    defaultSort,
    matches,
    parseQuery,
    remoteQuery,
    sortRows,
    toggleSort,
    type Filters
} from '../webview/lib/filter'
import { findJwts, formFields, imageType, isMarkup, prettyMarkup } from '../webview/lib/http'
import { tokenize } from '../webview/lib/jsonHighlight'
import { aggregate } from '../webview/lib/stats'
import { scrollIntoView, visibleRange } from '../webview/lib/virtual'
import { toRow, type Row } from '../webview/types/messages'

const make = (sequence: number, url: string, extra: Partial<Transaction> = {}): Transaction => {
    const u = new URL(url)
    return {
        id: `t${sequence}`,
        sequence,
        timestamp: sequence * 1000,
        method: 'GET',
        url,
        host: u.hostname,
        path: u.pathname + u.search,
        scheme: u.protocol.replace(':', ''),
        client: '127.0.0.1:1',
        state: 'completed',
        status: 200,
        requestHeaders: {},
        responseHeaders: {},
        requestBody: '',
        responseBody: '',
        requestBinary: false,
        responseBinary: false,
        requestBytes: 0,
        responseBytes: 10,
        truncated: false,
        duration: 5,
        tls: u.protocol === 'https:',
        frames: [],
        ...extra
    }
}
const row = (sequence: number, url: string, extra: Partial<Transaction> = {}): Row =>
    toRow(make(sequence, url, extra))
const filters = (patch: Partial<Filters>): Filters => ({ ...defaultFilters, ...patch })

describe('toRow', () => {
    it('projects the table columns and derives media type and protocol flags', () => {
        const r = toRow(
            make(1, 'https://api.example.com/v1/users', {
                responseHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
                responseBody: '{"big":"body"}',
                status: 101,
                events: [{ id: 'e', time: 0, event: 'message', data: '', lastEventId: '' }]
            })
        )
        expect(r.contentType).toBe('application/json')
        expect(r.websocket).toBe(true)
        expect(r.events).toBe(1)
        expect(r).not.toHaveProperty('responseBody')
        expect(r).not.toHaveProperty('responseHeaders')
    })
})

describe('matches', () => {
    const ok = row(1, 'https://api.example.com/v1/users?page=1')
    const notFound = row(2, 'https://api.example.com/missing', { status: 404 })
    const pending = row(3, 'https://api.example.com/slow', { state: 'pending', status: undefined })
    const failed = row(4, 'https://api.example.com/down', {
        state: 'error',
        status: undefined,
        error: 'ECONNRESET'
    })
    const tunnel = row(5, 'https://cdn.example.com', { scheme: 'connect', method: 'CONNECT' })

    it('searches url, method, status prefix and error text', () => {
        expect(matches(ok, filters({ text: 'users' }))).toBe(true)
        expect(matches(ok, filters({ text: 'get' }))).toBe(true)
        expect(matches(notFound, filters({ text: '40' }))).toBe(true)
        expect(matches(failed, filters({ text: 'econn' }))).toBe(true)
        expect(matches(ok, filters({ text: 'nope' }))).toBe(false)
    })
    it('applies quick status classes', () => {
        expect(matches(ok, filters({ quick: '2xx' }))).toBe(true)
        expect(matches(notFound, filters({ quick: '2xx' }))).toBe(false)
        expect(matches(notFound, filters({ quick: '4xx' }))).toBe(true)
        expect(matches(pending, filters({ quick: 'pending' }))).toBe(true)
        expect(matches(failed, filters({ quick: 'error' }))).toBe(true)
        expect(matches(notFound, filters({ quick: 'error' }))).toBe(true)
        expect(matches(ok, filters({ quick: 'error' }))).toBe(false)
    })
    it('restricts to a host and hides tunnels', () => {
        expect(matches(ok, filters({ host: 'api.example.com' }))).toBe(true)
        expect(matches(tunnel, filters({ host: 'api.example.com' }))).toBe(false)
        expect(matches(tunnel, filters({}))).toBe(true)
        expect(matches(tunnel, filters({ hideTunnels: true }))).toBe(false)
    })
})

describe('sortRows', () => {
    const rows = [
        row(1, 'https://b.example.com/x', { responseBytes: 30 }),
        row(2, 'https://a.example.com/y', { responseBytes: 10 }),
        row(3, 'https://a.example.com/z', { responseBytes: 10 })
    ]
    it('defaults to capture order and keeps it for ties', () => {
        expect(sortRows(rows, defaultSort).map((r) => r.id)).toEqual(['t1', 't2', 't3'])
        expect(
            sortRows(rows, { column: 'responseBytes', ascending: false }).map((r) => r.id)
        ).toEqual(['t1', 't2', 't3'])
        expect(sortRows(rows, { column: 'host', ascending: true }).map((r) => r.id)).toEqual([
            't2',
            't3',
            't1'
        ])
    })
    it('toggles direction on the same column and starts sizes descending', () => {
        expect(toggleSort(defaultSort, 'timestamp')).toEqual({
            column: 'timestamp',
            ascending: false
        })
        expect(toggleSort(defaultSort, 'responseBytes')).toEqual({
            column: 'responseBytes',
            ascending: false
        })
        expect(toggleSort(defaultSort, 'host')).toEqual({ column: 'host', ascending: true })
    })
})

describe('virtual', () => {
    it('windows rows around the viewport with overscan', () => {
        expect(visibleRange(0, 220, 1000, 22, 2)).toEqual({
            start: 0,
            end: 12,
            top: 0,
            bottom: 21736
        })
        const mid = visibleRange(2200, 220, 1000, 22, 2)
        expect(mid.start).toBe(98)
        expect(mid.end).toBe(112)
        expect(mid.top).toBe(98 * 22)
        expect(mid.bottom).toBe((1000 - 112) * 22)
        expect(visibleRange(0, 220, 0, 22)).toEqual({ start: 0, end: 0, top: 0, bottom: 0 })
        expect(visibleRange(99999, 220, 10, 22, 0).end).toBe(10)
    })
    it('scrolls the least distance to reveal a row', () => {
        expect(scrollIntoView(0, 220, 5, 22)).toBe(0)
        expect(scrollIntoView(0, 220, 20, 22)).toBe(21 * 22 - 220)
        expect(scrollIntoView(1000, 220, 3, 22)).toBe(66)
    })
})

describe('tokenize', () => {
    it('labels keys, strings, numbers, literals and punctuation', () => {
        const kinds = tokenize('{\n  "a": "x\\"y",\n  "n": -1.5e3,\n  "t": true,\n  "z": null\n}')
            .filter((t) => t.kind !== 'space' && t.kind !== 'punct')
            .map((t) => `${t.kind}:${t.text}`)
        expect(kinds).toEqual([
            'key:"a"',
            'string:"x\\"y"',
            'key:"n"',
            'number:-1.5e3',
            'key:"t"',
            'boolean:true',
            'key:"z"',
            'null:null'
        ])
    })
    it('round-trips the input text', () => {
        const text = '[{"k": [1, 2, {"deep": false}]}, "s"]'
        expect(
            tokenize(text)
                .map((t) => t.text)
                .join('')
        ).toBe(text)
    })
})

describe('query language', () => {
    const rows = [
        row(1, 'https://api.example.com/v1/users', { status: 200, duration: 20 }),
        row(2, 'https://api.example.com/v1/users', {
            method: 'POST',
            status: 500,
            duration: 800,
            responseBytes: 20480,
            rules: ['tweak']
        }),
        row(3, 'https://cdn.example.com/logo.png', {
            responseHeaders: { 'content-type': 'image/png' },
            httpVersion: '2.0'
        }),
        row(4, 'https://api.example.com/v1/held', {
            state: 'pending',
            status: undefined,
            paused: 'request'
        })
    ]
    const run = (text: string, remote?: Set<string>) => {
        const terms = parseQuery(text)
        return rows
            .filter((r) => matches(r, filters({ text }), terms, remote))
            .map((r) => r.sequence)
    }
    it('parses keys, operators, quotes and negation', () => {
        expect(parseQuery('status:5xx -method:post body:"not found" size>10k')).toEqual([
            { key: 'status', op: '=', value: '5xx', negate: false },
            { key: 'method', op: '=', value: 'post', negate: true },
            { key: 'body', op: '=', value: 'not found', negate: false },
            { key: 'size', op: '>', value: '10k', negate: false }
        ])
        expect(parseQuery('foo:bar -baz "a b"')).toEqual([
            { key: 'text', op: '=', value: 'foo:bar', negate: false },
            { key: 'text', op: '=', value: 'baz', negate: true },
            { key: 'text', op: '=', value: 'a b', negate: false }
        ])
    })
    it('filters by status, method, host, type, proto, size and duration', () => {
        expect(run('status:5xx')).toEqual([2])
        expect(run('-status:2xx')).toEqual([2, 4])
        expect(run('status:paused')).toEqual([4])
        expect(run('method:post,put')).toEqual([2])
        expect(run('host:cdn')).toEqual([3])
        expect(run('host:*.example.com path:/v1/*')).toEqual([1, 2, 4])
        expect(run('type:image')).toEqual([3])
        expect(run('proto:h2')).toEqual([3])
        expect(run('size>10k')).toEqual([2])
        expect(run('dur>500')).toEqual([2])
        expect(run('dur<100')).toEqual([1, 3])
        expect(run('rule:any')).toEqual([2])
        expect(run('users -method:post')).toEqual([1])
    })
    it('joins host-evaluated terms by id', () => {
        expect(run('body:x')).toEqual([1, 2, 3, 4])
        expect(run('body:x', new Set(['t2', 't3']))).toEqual([2, 3])
        expect(run('body:x status:5xx', new Set(['t2', 't3']))).toEqual([2])
        expect(remoteQuery(parseQuery('status:5xx -body:"a b" header:x=1'))).toBe(
            '-body="a b" header="x=1"'
        )
    })
})

describe('host-side search', () => {
    const items = [
        make(1, 'https://a/x', {
            requestHeaders: { authorization: 'Bearer abc' },
            responseBody: '{"error":"not found"}'
        }),
        make(2, 'https://a/y', { requestBody: 'hello', responseHeaders: { 'x-id': '42' } })
    ]
    it('matches bodies and headers, honouring negation', () => {
        expect(searchTransactions(items, 'body:"not found"')).toEqual(['t1'])
        expect(searchTransactions(items, 'header:authorization')).toEqual(['t1'])
        expect(searchTransactions(items, 'header:x-id=42')).toEqual(['t2'])
        expect(searchTransactions(items, '-body:hello')).toEqual(['t1'])
        expect(searchTransactions(items, 'req:hello')).toEqual(['t2'])
        expect(searchTransactions(items, 'res:error')).toEqual(['t1'])
        expect(searchTransactions(items, 'status:200')).toEqual([])
    })
})

describe('statistics', () => {
    it('aggregates per host and ranks slow and large responses', () => {
        const s = aggregate([
            row(1, 'https://a/1', { duration: 10, responseBytes: 100 }),
            row(2, 'https://a/2', { duration: 30, status: 500, responseBytes: 5000 }),
            row(3, 'https://b/1', { state: 'pending', status: undefined, duration: 0 })
        ])
        expect(s.requests).toBe(3)
        expect(s.errors).toBe(1)
        expect(s.hosts.map((h) => [h.host, h.requests, h.errors, h.max])).toEqual([
            ['a', 2, 1, 30],
            ['b', 1, 0, 0]
        ])
        expect(s.slowest.map((r) => r.sequence)).toEqual([2, 1])
        expect(s.largest[0].sequence).toBe(2)
    })
})

describe('body helpers', () => {
    it('decodes JWTs found in headers', () => {
        const [jwt] = findJwts({
            Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIiwiZXhwIjoxNzAwMDAwMDAwfQ.sig'
        })
        expect(jwt.source).toBe('Authorization')
        expect(jwt.header).toEqual({ alg: 'HS256' })
        expect(jwt.payload).toEqual({ sub: '1', exp: 1700000000 })
        expect(jwt.expires).toBe(1700000000)
        expect(findJwts({ cookie: 'a=b' })).toEqual([])
    })
    it('parses multipart form fields', () => {
        const body =
            '--B\r\nContent-Disposition: form-data; name="a"\r\n\r\nhello\r\n' +
            '--B\r\nContent-Disposition: form-data; name="f"; filename="x.png"\r\nContent-Type: image/png\r\n\r\nPNG\r\n--B--\r\n'
        expect(
            formFields({ 'content-type': 'multipart/form-data; boundary=B' }, body, false)
        ).toEqual([
            { name: 'a', value: 'hello' },
            { name: 'f', value: 'x.png (image/png, 3 bytes)' }
        ])
    })
    it('indents markup and recognises images', () => {
        expect(prettyMarkup('<a><b>1</b><c/></a>')).toBe('<a>\n  <b>1</b>\n  <c/>\n</a>')
        expect(imageType({ 'content-type': 'image/png' })).toBe('image/png')
        expect(imageType({ 'content-type': 'text/html' })).toBeUndefined()
        expect(isMarkup({ 'content-type': 'application/xml' }, '')).toBe(true)
        expect(isMarkup({}, '<html>')).toBe(true)
        expect(isMarkup({}, '{}')).toBe(false)
    })
})
