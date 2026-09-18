// Pure helpers shared by the tree view and virtual documents; no vscode imports so
// the root vitest suite can cover them.
import { bytes, duration, pretty, type Headers, type Transaction } from '../shared/model'
export { bytes, duration }

export function statusLabel(t: Transaction): string {
    if (t.state === 'pending') return '…'
    if (t.state === 'error') return t.status ? String(t.status) : 'ERR'
    return t.status ? String(t.status) : '—'
}

export function shortPath(t: Transaction, max = 80): string {
    const value = t.path || '/'
    return value.length > max ? value.slice(0, max - 1) + '…' : value
}

export function contentType(headers: Headers): string {
    return (
        Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
    ).toLowerCase()
}

/** File extension for a body document so VS Code picks a syntax highlighter. */
export function bodyExtension(headers: Headers, body: string, binary: boolean): string {
    if (binary) return 'txt'
    const type = contentType(headers)
    if (type.includes('json') || /^\s*[[{]/.test(body)) return 'json'
    if (type.includes('html')) return 'html'
    if (type.includes('xml')) return 'xml'
    if (type.includes('javascript')) return 'js'
    if (type.includes('css')) return 'css'
    if (type.includes('yaml')) return 'yaml'
    if (type.includes('markdown')) return 'md'
    return 'txt'
}

function block(headers: Headers, body: string, binary: boolean, size: number) {
    const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`)
    const text = binary
        ? size
            ? `(binary body, ${bytes(size)})`
            : ''
        : contentType(headers).includes('json')
          ? pretty(body)
          : body
    return lines.join('\n') + (text ? '\n\n' + text : '')
}

/** One combined request/response document, highlighted by the tapline-http grammar. */
export function renderTransaction(t: Transaction): string {
    const version = t.httpVersion ? `HTTP/${t.httpVersion}` : 'HTTP/1.1'
    const parts = [
        `### Request · ${t.client} · ${new Date(t.timestamp).toISOString()}${t.replayOf ? ' · replay' : ''}`,
        `${t.method} ${t.url} ${version}`,
        block(t.requestHeaders, t.requestBody, t.requestBinary, t.requestBytes)
    ]
    if (t.scheme === 'connect') {
        parts.push(
            '',
            '### Tunnel',
            `${bytes(t.requestBytes)} sent · ${bytes(t.responseBytes)} received · ${duration(t.duration)}`,
            'TLS was not decrypted for this host (see tapline.ssl.hosts).'
        )
    } else if (t.state === 'pending' && t.status === undefined)
        parts.push('', '### Response', '(pending)')
    else if (t.state === 'error' && t.status === undefined)
        parts.push('', '### Response', `(error) ${t.error ?? ''}`)
    else {
        parts.push(
            '',
            `### Response · ${duration(t.duration)} · ${bytes(t.responseBytes)}${t.truncated ? ' · body truncated' : ''}`,
            `${version} ${t.status ?? ''} ${t.statusMessage ?? ''}`.trimEnd(),
            block(t.responseHeaders, t.responseBody, t.responseBinary, t.responseBytes)
        )
        if (t.responseTrailers && Object.keys(t.responseTrailers).length)
            parts.push('', '### Trailers', block(t.responseTrailers, '', false, 0))
    }
    if (t.frames.length) {
        parts.push('', `### Frames (${t.frames.length})`)
        for (const f of t.frames.slice(-200))
            parts.push(
                `${f.direction === 'send' ? '→' : '←'} ${new Date(f.time).toISOString().slice(11, 23)} ${
                    f.binary ? `(binary, ${bytes(Buffer.byteLength(f.data, 'base64'))})` : f.data
                }`
            )
    }
    if (t.error && t.status !== undefined) parts.push('', '### Error', t.error)
    return parts.join('\n') + '\n'
}

/**
 * Environment applied to terminals and debug sessions while capture runs. Every
 * variable is one a common runtime or tool reads on its own; nothing else changes.
 */
export function captureEnvironment(
    port: number,
    certificatePath: string,
    truststorePath?: string
): Record<string, string> {
    const proxy = `http://127.0.0.1:${port}`
    const env: Record<string, string> = {
        // Proxy: curl, git, pip, npm, Go, Python, Ruby, Rust reqwest, .NET, Deno, Bun…
        http_proxy: proxy,
        https_proxy: proxy,
        HTTP_PROXY: proxy,
        HTTPS_PROXY: proxy,
        NO_PROXY: 'localhost,127.0.0.1,::1',
        no_proxy: 'localhost,127.0.0.1,::1',
        // Trust the Tapline root CA
        SSL_CERT_FILE: certificatePath, // OpenSSL-based tools, Go, Ruby, Python ssl
        CURL_CA_BUNDLE: certificatePath,
        REQUESTS_CA_BUNDLE: certificatePath, // Python requests
        PIP_CERT: certificatePath,
        AWS_CA_BUNDLE: certificatePath, // aws cli, boto3
        GIT_SSL_CAINFO: certificatePath,
        NODE_EXTRA_CA_CERTS: certificatePath, // Node and Bun
        NODE_USE_ENV_PROXY: '1', // Node 22.21+/24+: fetch/undici honour HTTP(S)_PROXY
        npm_config_cafile: certificatePath,
        CARGO_HTTP_CAINFO: certificatePath,
        DENO_CERT: certificatePath,
        GRPC_DEFAULT_SSL_ROOTS_FILE_PATH: certificatePath
    }
    if (truststorePath)
        // JVMs ignore the variables above; JAVA_TOOL_OPTIONS is read by every JVM at start.
        env.JAVA_TOOL_OPTIONS = [
            `-Dhttp.proxyHost=127.0.0.1`,
            `-Dhttp.proxyPort=${port}`,
            `-Dhttps.proxyHost=127.0.0.1`,
            `-Dhttps.proxyPort=${port}`,
            `-Dhttp.nonProxyHosts=localhost|127.0.0.1`,
            `-Djavax.net.ssl.trustStore=${quoteJavaOption(truststorePath)}`,
            `-Djavax.net.ssl.trustStorePassword=changeit`,
            `-Djavax.net.ssl.trustStoreType=PKCS12`
        ].join(' ')
    return env
}

/** JAVA_TOOL_OPTIONS splits on whitespace unless the value is double-quoted. */
function quoteJavaOption(value: string) {
    return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}
