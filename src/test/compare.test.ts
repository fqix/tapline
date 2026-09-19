import { describe, expect, it } from 'vitest'
import type { Transaction } from '../shared/model'
import { renderComparison } from '../utils/compare'

const base: Transaction = {
    id: 'a',
    sequence: 1,
    timestamp: 0,
    method: 'POST',
    url: 'https://example.com/api',
    host: 'example.com',
    path: '/api',
    scheme: 'https',
    client: 'test',
    state: 'completed',
    status: 200,
    statusMessage: 'OK',
    requestHeaders: {},
    responseHeaders: {},
    requestBody: '',
    responseBody: '',
    requestBinary: false,
    responseBinary: false,
    requestBytes: 0,
    responseBytes: 0,
    truncated: false,
    duration: 1,
    tls: true,
    frames: []
}

describe('request comparison snapshots', () => {
    it('ignores capture metadata and header order/casing, while retaining header values', () => {
        const left = renderComparison({ ...base, requestHeaders: { 'X-B': '2', 'X-A': '1' } })
        const right = renderComparison({
            ...base,
            id: 'b',
            sequence: 2,
            timestamp: 100,
            duration: 500,
            client: 'other',
            replayOf: 'a',
            requestHeaders: { 'x-a': '1', 'x-b': '2' }
        })
        expect(left).toBe(right)
        expect(left).toContain('x-a: 1\nx-b: 2')
        expect(renderComparison({ ...base, requestHeaders: { 'X-A': 'changed' } })).not.toBe(left)
    })
    it('formats JSON while preserving plain text, status, URLs and trailers', () => {
        const rendered = renderComparison({
            ...base,
            requestBody: 'hello\nworld',
            responseBody: '{"ok":true}',
            responseTrailers: { 'Grpc-Status': '0' }
        })
        expect(rendered).toContain('POST https://example.com/api HTTP/1.1')
        expect(rendered).toContain('hello\nworld')
        expect(rendered).toContain('HTTP/1.1 200 OK')
        expect(rendered).toContain('{\n  "ok": true\n}')
        expect(rendered).toContain('### Trailers\ngrpc-status: 0')
    })
    it('preserves large JSON numbers, escaped strings and empty containers', () => {
        const body =
            '{"id":9007199254740993,"precise":0.1234567890123456789,"empty":[],"nested":[{},true,null]}'
        const rendered = renderComparison({ ...base, responseBody: body })
        expect(rendered).toContain('9007199254740993')
        expect(rendered).toContain('0.1234567890123456789')
        expect(rendered).toContain('"empty": []')
        const other = renderComparison({
            ...base,
            responseBody: body.replace('9007199254740993', '9007199254740992')
        })
        expect(rendered).not.toBe(other)
        const escaped = JSON.stringify({ text: 'quote " and slash \\ and newline\n' })
        expect(renderComparison({ ...base, responseBody: escaped })).toContain(
            JSON.stringify(JSON.parse(escaped), null, 2)
        )
    })
    it('compares actual binary payloads, not just their identical lengths', () => {
        const a = renderComparison({ ...base, responseBinary: true, responseBody: 'AAE=' })
        const b = renderComparison({ ...base, responseBinary: true, responseBody: 'AAI=' })
        expect(a).toContain('(Base64)\nAAE=')
        expect(a).not.toBe(b)
    })
    it('labels incomplete captures and errors instead of implying complete equality', () => {
        const rendered = renderComparison({
            ...base,
            state: 'pending',
            status: undefined,
            truncated: true,
            error: 'connection reset'
        })
        expect(rendered).toContain('(no response)')
        expect(rendered).toContain('Capture incomplete')
        expect(rendered).toContain('Body truncated')
        expect(rendered).toContain('connection reset')
    })
})
