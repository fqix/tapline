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
