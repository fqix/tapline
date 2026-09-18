import { describe, expect, it } from 'vitest'
import { matchHost, toCurl, toHAR, type Transaction } from '../shared/model'
import { bodyExtension, captureEnvironment, renderTransaction } from '../utils/format'

const base: Transaction = {
    id: 'a',
    sequence: 1,
    timestamp: Date.UTC(2026, 0, 1),
    method: 'POST',
    url: 'https://api.example.com/v1/items?x=1',
    host: 'api.example.com',
    path: '/v1/items?x=1',
    scheme: 'https',
    httpVersion: '2.0',
    client: '127.0.0.1:5000',
    state: 'completed',
    status: 201,
    statusMessage: 'Created',
    requestHeaders: {
        'content-type': 'application/json',
        host: 'api.example.com',
        authorization: "Bearer it's"
    },
    responseHeaders: { 'content-type': 'application/json; charset=utf-8' },
    requestBody: '{"a":1}',
    responseBody: '{"ok":true}',
    requestBinary: false,
    responseBinary: false,
    requestBytes: 7,
    responseBytes: 11,
    truncated: false,
    duration: 12.5,
    tls: true,
    frames: []
}

describe('matchHost', () => {
    it('matches wildcards and exact hosts', () => {
        expect(matchHost('*', 'a.b')).toBe(true)
        expect(matchHost('*.example.com', 'api.example.com')).toBe(true)
        expect(matchHost('*.example.com', 'example.com')).toBe(true)
        expect(matchHost('*.example.com', 'example.org')).toBe(false)
        expect(matchHost('api-*.example.com', 'api-1.example.com')).toBe(true)
        expect(matchHost('Example.com', 'example.com')).toBe(true)
        expect(matchHost('', 'example.com')).toBe(false)
    })
})

describe('toCurl', () => {
    it('quotes values and drops hop headers', () => {
        const curl = toCurl(base)
        expect(curl).toContain("curl -X POST 'https://api.example.com/v1/items?x=1'")
        expect(curl).toContain(`-H 'authorization: Bearer it'\\''s'`)
        expect(curl).not.toContain('host:')
        expect(curl).toContain(`--data-raw '{"a":1}'`)
    })
    it('omits binary bodies', () => {
        expect(toCurl({ ...base, requestBinary: true, requestBody: 'AAAA' })).not.toContain(
            '--data-raw'
        )
    })
})

describe('toHAR', () => {
    it('produces HAR 1.2 entries with base64 flags for binary bodies', () => {
        const har = toHAR([base, { ...base, id: 'b', responseBinary: true, responseBody: 'AAEC' }])
        expect(har.log.version).toBe('1.2')
        expect(har.log.entries).toHaveLength(2)
        expect(har.log.entries[0].request.queryString).toEqual([{ name: 'x', value: '1' }])
        expect(har.log.entries[0].response.content.encoding).toBeUndefined()
        expect(har.log.entries[1].response.content.encoding).toBe('base64')
        expect(har.log.entries[0].request.httpVersion).toBe('HTTP/2.0')
    })
})

describe('format', () => {
    it('picks body extensions from content types', () => {
        expect(bodyExtension({ 'content-type': 'application/json' }, '', false)).toBe('json')
        expect(bodyExtension({}, '[1]', false)).toBe('json')
        expect(bodyExtension({ 'Content-Type': 'text/html' }, '', false)).toBe('html')
        expect(bodyExtension({ 'content-type': 'application/json' }, '', true)).toBe('txt')
    })
    it('renders a combined request/response document', () => {
        const text = renderTransaction(base)
        expect(text).toContain('POST https://api.example.com/v1/items?x=1 HTTP/2.0')
        expect(text).toContain('HTTP/2.0 201 Created')
        expect(text).toContain('{\n  "ok": true\n}')
        expect(renderTransaction({ ...base, scheme: 'connect', method: 'CONNECT' })).toContain(
            '### Tunnel'
        )
        expect(renderTransaction({ ...base, state: 'pending', status: undefined })).toContain(
            '(pending)'
        )
    })
    it('builds the capture environment', () => {
        const env = captureEnvironment(6070, '/tmp/ca.pem')
        expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:6070')
        expect(env.NODE_EXTRA_CA_CERTS).toBe('/tmp/ca.pem')
        expect(env.NO_PROXY).toContain('localhost')
    })
})
