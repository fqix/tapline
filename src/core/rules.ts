// Pure helpers behind interception rules: header edits, URL mapping, body decoding.
import zlib from 'node:zlib'
import { extname } from 'node:path'
import type { Headers } from '../shared/model'
import type { WireHeaders } from './inspector'

export function getHeader(headers: WireHeaders, name: string): string | undefined {
    const key = name.toLowerCase()
    for (const [k, v] of Object.entries(headers))
        if (k.toLowerCase() === key) return Array.isArray(v) ? v.join(', ') : v
    return undefined
}

/** Case-insensitive set (or delete with `null`), keeping the first spelling seen. */
export function setHeader(headers: WireHeaders, name: string, value: string | null) {
    const key = name.toLowerCase()
    for (const k of Object.keys(headers)) {
        if (k.toLowerCase() !== key) continue
        if (value === null) delete headers[k]
        else headers[k] = value
        return
    }
    if (value !== null) headers[name] = value
}

export function applyHeaderEdits(headers: WireHeaders, edits: Record<string, string | null>) {
    for (const [name, value] of Object.entries(edits)) setHeader(headers, name, value)
}

export const toWire = (headers: Headers): WireHeaders => ({ ...headers })

/** `to` is an origin, optionally with a path prefix, that replaces the URL's origin. */
export function remapUrl(url: string, to: string): string {
    const source = new URL(url)
    const target = new URL(to.includes('://') ? to : `http://${to}`)
    const prefix = target.pathname.replace(/\/$/, '')
    return `${target.protocol}//${target.host}${prefix}${source.pathname}${source.search}`
}

/** Compile a user-supplied pattern; an invalid one matches nothing rather than throwing. */
export function regex(pattern: string, flags = ''): RegExp | undefined {
    try {
        return new RegExp(pattern, flags)
    } catch {
        return undefined
    }
}

const mimes: Record<string, string> = {
    '.json': 'application/json',
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.wasm': 'application/wasm'
}

export function mimeFor(path: string): string {
    return mimes[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/** Best-effort media type for an inline body: JSON when it parses, text otherwise. */
export function mimeForBody(body: string): string {
    try {
        JSON.parse(body)
        return 'application/json'
    } catch {
        return /^\s*</.test(body) ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8'
    }
}

const decoders: Record<string, (bytes: Buffer) => Buffer> = {
    gzip: (b) => zlib.gunzipSync(b, { finishFlush: zlib.constants.Z_SYNC_FLUSH }),
    'x-gzip': (b) => zlib.gunzipSync(b, { finishFlush: zlib.constants.Z_SYNC_FLUSH }),
    deflate: (b) => {
        try {
            return zlib.inflateSync(b, { finishFlush: zlib.constants.Z_SYNC_FLUSH })
        } catch {
            return zlib.inflateRawSync(b, { finishFlush: zlib.constants.Z_SYNC_FLUSH })
        }
    },
    br: (b) => zlib.brotliDecompressSync(b, { finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH }),
    ...('zstdDecompressSync' in zlib
        ? {
              zstd: (b: Buffer) =>
                  (zlib as unknown as { zstdDecompressSync(b: Buffer): Buffer }).zstdDecompressSync(
                      b
                  )
          }
        : {})
}

/**
 * Decode a `Content-Encoding`d body. Truncated input decodes as far as it goes; anything
 * that fails (unknown scheme, corrupt data) comes back untouched with no `encoding`.
 */
export function decodeBody(
    bytes: Buffer,
    contentEncoding: string | undefined
): { bytes: Buffer; encoding?: string } {
    const encoding = contentEncoding?.split(',')[0].trim().toLowerCase()
    if (!encoding || encoding === 'identity') return { bytes }
    const decoder = decoders[encoding]
    if (!decoder || !bytes.length) return { bytes }
    try {
        return { bytes: decoder(bytes), encoding }
    } catch {
        return { bytes }
    }
}
