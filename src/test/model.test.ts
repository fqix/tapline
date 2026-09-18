import { describe, expect, it } from 'vitest'
import { matchHost, toCurl, toHAR, type Transaction } from '../shared/model'
import { bodyExtension, renderTransaction } from '../utils/format'
import { captureEnvironment, defaultDebugRuntimes, PROFILES } from '../utils/environment'

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
    it('builds the capture environment per runtime profile', () => {
        const target = {
            port: 3606,
            certificatePath: '/tmp/ca.pem',
            truststorePath: '/Users/me/Application Support/ca.p12'
        }
        const generic = captureEnvironment(target, ['openssl', 'git'])
        expect(generic.HTTPS_PROXY).toBe('http://127.0.0.1:3606')
        expect(generic.NO_PROXY).toContain('localhost')
        expect(generic.SSL_CERT_FILE).toBe('/tmp/ca.pem')
        expect(generic.GIT_SSL_CAINFO).toBe('/tmp/ca.pem')
        expect(generic.NODE_EXTRA_CA_CERTS).toBeUndefined()
        expect(generic.JAVA_TOOL_OPTIONS).toBeUndefined()
        const node = captureEnvironment(target, defaultDebugRuntimes.node)
        expect(node.NODE_EXTRA_CA_CERTS).toBe('/tmp/ca.pem')
        expect(node.NODE_USE_ENV_PROXY).toBe('1')
        expect(node.PIP_CERT).toBeUndefined()
        expect(node.JAVA_TOOL_OPTIONS).toBeUndefined()
        const java = captureEnvironment(target, ['java']).JAVA_TOOL_OPTIONS
        expect(java).toContain('-Dhttps.proxyPort=3606')
        expect(java).toContain('-Djavax.net.ssl.trustStore="/Users/me/Application Support/ca.p12"')
        expect(java).toContain('-Djavax.net.ssl.trustStoreType=PKCS12')
        expect(
            captureEnvironment({ ...target, truststorePath: undefined }, ['java']).JAVA_TOOL_OPTIONS
        ).toBeUndefined()
        expect(Object.keys(captureEnvironment(target, [])).sort()).toEqual([
            'HTTPS_PROXY',
            'HTTP_PROXY',
            'NO_PROXY',
            'http_proxy',
            'https_proxy',
            'no_proxy'
        ])
        for (const profiles of Object.values(defaultDebugRuntimes))
            for (const p of profiles) expect(PROFILES).toContain(p)
    })
})
