import { describe, expect, it } from 'vitest'
import type { Transaction } from '../shared/model'
import {
    defaultFilters,
    defaultSort,
    matches,
    sortRows,
    toggleSort,
    type Filters
} from '../webview/lib/filter'
import { tokenize } from '../webview/lib/jsonHighlight'
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
