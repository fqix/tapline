// Pure helpers for the Contents sub-views: raw messages, hex dumps, cookies, forms.
import type { Headers, Transaction } from '../../shared/model'

export function contentType(headers: Headers): string {
    return (
        Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
    ).toLowerCase()
}

export function header(headers: Headers, name: string): string | undefined {
    return Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1]
}

export function isJSON(headers: Headers, body: string): boolean {
    return contentType(headers).includes('json') || /^\s*[[{]/.test(body)
}

export function bodyBytes(body: string, binary: boolean): Uint8Array {
    if (binary) {
        const text = atob(body)
        const bytes = new Uint8Array(text.length)
        for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
        return bytes
    }
    return new TextEncoder().encode(body)
}

/** Classic 16-bytes-per-line hex dump; capped so huge bodies never freeze the panel. */
export function hexDump(bytes: Uint8Array, limit = 64 * 1024): string {
    const lines: string[] = []
    const end = Math.min(bytes.length, limit)
    for (let offset = 0; offset < end; offset += 16) {
        const slice = bytes.subarray(offset, Math.min(offset + 16, end))
        const hex = [...slice].map((b) => b.toString(16).padStart(2, '0'))
        const ascii = [...slice]
            .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'))
            .join('')
        lines.push(
            `${offset.toString(16).padStart(8, '0')}  ${hex.slice(0, 8).join(' ').padEnd(23)}  ${hex.slice(8).join(' ').padEnd(23)}  |${ascii}|`
        )
    }
    if (bytes.length > limit) lines.push(`… ${bytes.length - limit} more bytes`)
    return lines.join('\n')
}

export function requestLine(t: Transaction): string {
    return `${t.method} ${t.scheme === 'connect' ? t.path : t.path || '/'} HTTP/${t.httpVersion ?? '1.1'}`
}

export function statusLine(t: Transaction): string {
    return `HTTP/${t.httpVersion ?? '1.1'} ${t.status ?? ''} ${t.statusMessage ?? ''}`.trimEnd()
}

/** Raw HTTP message as it would appear on the wire (binary bodies summarised). */
export function rawMessage(t: Transaction, side: 'request' | 'response'): string {
    const headers = side === 'request' ? t.requestHeaders : t.responseHeaders
    const body = side === 'request' ? t.requestBody : t.responseBody
    const binary = side === 'request' ? t.requestBinary : t.responseBinary
    const first = side === 'request' ? requestLine(t) : statusLine(t)
    const lines = [first, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), '', '']
    return (
        lines.join('\r\n') +
        (binary ? `<${bodyBytes(body, true).length} bytes of binary data>` : body)
    )
}

export interface Pair {
    name: string
    value: string
}

export function queryParams(t: Transaction): Pair[] {
    try {
        return [...new URL(t.url).searchParams].map(([name, value]) => ({ name, value }))
    } catch {
        return []
    }
}

/** Cookie header (request) or Set-Cookie header(s) (response). */
export function cookies(headers: Headers, side: 'request' | 'response'): Pair[] {
    if (side === 'request') {
        const value = header(headers, 'cookie')
        return value
            ? value.split(';').map((part) => {
                  const [name, ...rest] = part.trim().split('=')
                  return { name, value: rest.join('=') }
              })
            : []
    }
    return Object.entries(headers)
        .filter(([k]) => k.toLowerCase() === 'set-cookie')
        .flatMap(([, v]) => v.split(/,(?=[^;]+=)/))
        .map((raw) => {
            const [pair, ...attrs] = raw.trim().split(';')
            const [name, ...rest] = pair.split('=')
            return {
                name,
                value:
                    rest.join('=') +
                    (attrs.length ? ` (${attrs.map((a) => a.trim()).join('; ')})` : '')
            }
        })
}

export function formFields(headers: Headers, body: string, binary: boolean): Pair[] {
    if (binary || !contentType(headers).includes('x-www-form-urlencoded')) return []
    return [...new URLSearchParams(body)].map(([name, value]) => ({ name, value }))
}
