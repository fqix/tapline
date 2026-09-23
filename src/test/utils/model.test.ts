import { describe, expect, it, vi } from 'vitest'
import { matchHost, toCurl, toHAR, type Transaction } from '../../shared/model'
import { bodyExtension, renderTransaction } from '../../utils/format'
import { captureEnvironment, defaultDebugRuntimes, PROFILES } from '../../utils/environment'

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
    it('preserves native CA trust in passthrough mode while routing Node and Java', () => {
        for (const policy of [
            { sslHosts: [] },
            { sslHosts: ['!private.test'] },
            { sslHosts: ['*', '!*'] },
            { sslHosts: ['*', ' ! * '] },
            { sslHosts: ['*'], sslNoHosts: [' * '] },
            { sslNoHosts: ['*'] }
        ]) {
            const env = captureEnvironment(
                {
                    port: 3606,
                    certificatePath: '/tapline.pem',
                    truststorePath: '/tapline.p12',
                    ...policy
                },
                PROFILES
            )
            expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:3606')
            expect(env.NODE_USE_ENV_PROXY).toBe('1')
            expect(env.JAVA_TOOL_OPTIONS).toContain('-Dhttps.proxyPort=3606')
            expect(env.JAVA_TOOL_OPTIONS).not.toContain('trustStore')
            expect(Object.keys(env).sort()).toEqual(
                [
                    'http_proxy',
                    'https_proxy',
                    'HTTP_PROXY',
                    'HTTPS_PROXY',
                    'NO_PROXY',
                    'no_proxy',
                    'NODE_USE_ENV_PROXY',
                    'JAVA_TOOL_OPTIONS'
                ].sort()
            )
        }
    })
    it('keeps CA injection for partially excluded interception policies', () => {
        for (const policy of [
            {},
            { sslHosts: ['*', '!private.test'] },
            { sslHosts: ['*'], sslNoHosts: ['private.test'] }
        ]) {
            const env = captureEnvironment(
                {
                    port: 3606,
                    certificatePath: '/tapline.pem',
                    truststorePath: '/tapline.p12',
                    ...policy
                },
                PROFILES
            )
            expect(env.REQUESTS_CA_BUNDLE).toBe('/tapline.pem')
            expect(env.JAVA_TOOL_OPTIONS).toContain('-Djavax.net.ssl.trustStore=/tapline.p12')
        }
    })
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
        for (const type of ['extensionHost', 'pwa-extensionHost']) {
            const extension = captureEnvironment(target, defaultDebugRuntimes[type])
            expect(extension.HTTPS_PROXY).toBe('http://127.0.0.1:3606')
            expect(extension.NODE_EXTRA_CA_CERTS).toBe('/tmp/ca.pem')
            expect(extension.NODE_USE_ENV_PROXY).toBe('1')
            expect(extension.GRPC_DEFAULT_SSL_ROOTS_FILE_PATH).toBe('/tmp/ca.pem')
        }
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
        const customNoProxy = captureEnvironment(
            target,
            [],
            ['vcluster.hd-04.alayanew.com', 'internal.net']
        )
        expect(customNoProxy.NO_PROXY).toContain('vcluster.hd-04.alayanew.com')
        expect(customNoProxy.NO_PROXY).toContain('internal.net')
        expect(customNoProxy.no_proxy).toBe(customNoProxy.NO_PROXY)
    })

    it('uses public-root bundles for partial decryption but only the Tapline CA for Node additive trust', () => {
        const env = captureEnvironment(
            {
                port: 3606,
                certificatePath: '/tmp/ca.pem',
                caBundlePath: '/tmp/ca-bundle.pem',
                sslHosts: ['*', '!github.com']
            },
            PROFILES
        )
        expect(env.NODE_EXTRA_CA_CERTS).toBe('/tmp/ca.pem')
        expect(env.NODE_USE_ENV_PROXY).toBe('1')
        for (const name of [
            'SSL_CERT_FILE',
            'CURL_CA_BUNDLE',
            'GIT_SSL_CAINFO',
            'npm_config_cafile',
            'REQUESTS_CA_BUNDLE',
            'PIP_CERT',
            'AWS_CA_BUNDLE',
            'CARGO_HTTP_CAINFO',
            'DENO_CERT',
            'GRPC_DEFAULT_SSL_ROOTS_FILE_PATH'
        ])
            expect(env[name]).toBe('/tmp/ca-bundle.pem')
    })

    it('maps inherited and configured proxy exclusions to JVM host patterns', () => {
        vi.stubEnv('NO_PROXY', 'inherited.test,.corp.test')
        try {
            const env = captureEnvironment(
                { port: 3606, certificatePath: '/tmp/ca.pem', truststorePath: '/tmp/ca.p12' },
                ['java'],
                ['api.internal', '*.dev.test', '10.0.0.1', 'port.test:8443', '10.0.0.0/8']
            )
            const patterns = env.JAVA_TOOL_OPTIONS.match(/-Dhttp.nonProxyHosts=([^ ]+)/)![1].split(
                '|'
            )
            expect(patterns).toEqual([
                'localhost',
                '*.localhost',
                '127.0.0.1',
                '[::1]',
                'inherited.test',
                '*.inherited.test',
                'corp.test',
                '*.corp.test',
                'api.internal',
                '*.api.internal',
                '*.dev.test',
                '10.0.0.1'
            ])
            expect(env.NO_PROXY).toContain('api.internal')
            expect(env.no_proxy).toBe(env.NO_PROXY)
        } finally {
            vi.unstubAllEnvs()
        }
    })
})
