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
    const type = contentType(headers)
    // Boundaries are case-sensitive: parse them from the header as sent.
    if (type.includes('multipart/form-data'))
        return multipartFields(header(headers, 'content-type') ?? '', body, binary)
    if (binary || !type.includes('x-www-form-urlencoded')) return []
    return [...new URLSearchParams(body)].map(([name, value]) => ({ name, value }))
}

const utf8 = new TextDecoder('utf-8', { fatal: true })

/** Parts of a multipart/form-data body; file parts are summarised, text parts shown. */
export function multipartFields(type: string, body: string, binary: boolean): Pair[] {
    const boundary = /boundary=("?)([^";]+)\1/i.exec(type)?.[2]
    if (!boundary) return []
    // Work on latin1 so byte offsets survive; decode each text part as UTF-8 afterwards.
    const raw = binary ? atob(body) : body
    const fields: Pair[] = []
    for (const part of raw.split(`--${boundary}`).slice(1)) {
        if (part.startsWith('--')) break
        const split = part.indexOf('\r\n\r\n')
        if (split < 0) continue
        const head = part.slice(0, split)
        const content = part.slice(split + 4).replace(/\r\n$/, '')
        const disposition = /content-disposition:([^\r\n]*)/i.exec(head)?.[1] ?? ''
        const name = /name="([^"]*)"/i.exec(disposition)?.[1] ?? ''
        const filename = /filename="([^"]*)"/i.exec(disposition)?.[1]
        const partType = /content-type:\s*([^\r\n]*)/i.exec(head)?.[1]
        if (filename !== undefined) {
            fields.push({
                name,
                value: `${filename} (${partType ?? 'application/octet-stream'}, ${content.length} bytes)`
            })
            continue
        }
        let value: string
        try {
            value = binary ? utf8.decode(Uint8Array.from(content, (c) => c.charCodeAt(0))) : content
        } catch {
            value = `(${content.length} bytes of binary data)`
        }
        fields.push({ name, value })
    }
    return fields
}

export interface Jwt {
    /** Header the token was found in. */
    source: string
    header: unknown
    payload: unknown
    /** `exp` claim, when present. */
    expires?: number
    /** `iat` and `nbf` claims, when present. */
    issuedAt?: number
    notBefore?: number
    /** The token as it appeared, for copying. */
    token: string
}

/** A registered claim rendered for people: `value` is already humanised. */
export interface JwtClaim {
    name: string
    label: string
    value: string
}

const seconds = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(new Date(value * 1000).getTime())
        ? value
        : undefined

/**
 * The registered claims worth a summary line, in the order RFC 7519 lists them.
 * Times become local timestamps; everything else is shown as written.
 */
export function jwtClaims(payload: unknown, labels: Record<string, string>): JwtClaim[] {
    if (typeof payload !== 'object' || payload === null) return []
    const claims = payload as Record<string, unknown>
    const time = (value: unknown) => {
        const at = seconds(value)
        return at === undefined ? undefined : new Date(at * 1000).toLocaleString()
    }
    const text = (value: unknown) =>
        Array.isArray(value)
            ? value.filter((v) => typeof v === 'string' || typeof v === 'number').join(', ')
            : typeof value === 'string' || typeof value === 'number'
              ? String(value)
              : undefined
    const rows: [string, string | undefined][] = [
        ['iss', text(claims.iss)],
        ['sub', text(claims.sub)],
        ['aud', text(claims.aud)],
        ['iat', time(claims.iat)],
        ['nbf', time(claims.nbf)],
        ['exp', time(claims.exp)]
    ]
    return rows
        .filter(([, value]) => value)
        .map(([name, value]) => ({ name, label: labels[name] ?? name, value: value! }))
}

/** "in 59 minutes" / "2 hours ago" for a claim's epoch seconds. */
export function relativeTime(at: number, now = Date.now()): string {
    const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    const delta = at * 1000 - now
    if (!Number.isFinite(delta)) return ''
    const units: [Intl.RelativeTimeFormatUnit, number][] = [
        ['year', 31536000000],
        ['month', 2592000000],
        ['day', 86400000],
        ['hour', 3600000],
        ['minute', 60000]
    ]
    for (const [unit, size] of units)
        if (Math.abs(delta) >= size) return format.format(Math.round(delta / size), unit)
    return format.format(Math.round(delta / 1000), 'second')
}

const base64url = (s: string) => {
    const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
}

/** JSON Web Tokens found in header values (Authorization: Bearer …, cookies, custom). */
export function findJwts(headers: Headers): Jwt[] {
    const found: Jwt[] = []
    const pattern = /\b(eyJ[\w-]+)\.(eyJ[\w-]+)\.([\w-]*)/g
    for (const [name, value] of Object.entries(headers)) {
        for (const m of value.matchAll(pattern)) {
            try {
                const header = JSON.parse(base64url(m[1]))
                const payload = JSON.parse(base64url(m[2]))
                if (typeof header !== 'object' || typeof payload !== 'object') continue
                found.push({
                    source: name,
                    header,
                    payload,
                    expires: seconds(payload?.exp),
                    issuedAt: seconds(payload?.iat),
                    notBefore: seconds(payload?.nbf),
                    token: m[0]
                })
            } catch {
                // Not a JWT after all.
            }
        }
    }
    return found
}

/** Whether the body is an image the panel can preview inline. */
export function imageType(headers: Headers): string | undefined {
    const type = contentType(headers).split(';')[0].trim()
    return /^image\/(png|jpeg|gif|webp|svg\+xml|bmp|x-icon|avif)$/.test(type) ? type : undefined
}

export function isMarkup(headers: Headers, body: string): boolean {
    const type = contentType(headers)
    return (
        type.includes('xml') ||
        type.includes('html') ||
        type.includes('svg') ||
        (!type && /^\s*<[?!a-z]/i.test(body))
    )
}

/** Indent XML / HTML one element per line; short `<x>text</x>` pairs stay on one line. */
export function prettyMarkup(text: string): string {
    const lines: string[] = []
    let depth = 0
    const inline = /^<(br|hr|img|input|meta|link|area|base|col|embed|source|track|wbr)\b/i
    const pieces = text
        .replace(/>\s*</g, '><')
        .split(/(?=<)|(?<=>)/)
        .map((p) => p.trim())
        .filter(Boolean)
    for (let i = 0; i < pieces.length; i++) {
        const token = pieces[i]
        const closing = /^<\//.test(token)
        const selfClosing = /\/>$/.test(token) || /^<[?!]/.test(token) || inline.test(token)
        const opening = token.startsWith('<') && !closing && !selfClosing
        const next = pieces[i + 1]
        const after = pieces[i + 2]
        if (opening && next && !next.startsWith('<') && after && /^<\//.test(after)) {
            lines.push('  '.repeat(depth) + token + next + after)
            i += 2
            continue
        }
        if (closing) depth = Math.max(0, depth - 1)
        lines.push('  '.repeat(depth) + token)
        if (opening) depth++
    }
    return lines.join('\n')
}

/** Count and positions of `needle` in `text`, case-insensitive. */
export function findAll(text: string, needle: string): number[] {
    if (!needle) return []
    const hay = text.toLowerCase()
    const n = needle.toLowerCase()
    const hits: number[] = []
    let i = hay.indexOf(n)
    while (i >= 0 && hits.length < 5000) {
        hits.push(i)
        i = hay.indexOf(n, i + n.length)
    }
    return hits
}
