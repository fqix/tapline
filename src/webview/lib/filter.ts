// Pure filtering and sorting for the sequence table; covered by src/test/webview/webview.test.ts.
import { matchWildcard } from '../../shared/model'
import type { Row } from '../types/messages'

export type Quick = 'all' | '2xx' | '3xx' | '4xx' | '5xx' | 'pending' | 'error'
export const quickFilters: Quick[] = ['all', '2xx', '3xx', '4xx', '5xx', 'pending', 'error']

export interface Filters {
    text: string
    quick: Quick
    host?: string
    hideTunnels: boolean
}

export const defaultFilters: Filters = { text: '', quick: 'all', hideTunnels: false }

export type Column =
    | 'sequence'
    | 'status'
    | 'method'
    | 'url'
    | 'serverAddress'
    | 'timestamp'
    | 'duration'
    | 'responseBytes'
export const columns: Column[] = [
    'sequence',
    'status',
    'method',
    'url',
    'serverAddress',
    'timestamp',
    'duration',
    'responseBytes'
]

export interface Sort {
    column: Column
    ascending: boolean
}

export const defaultSort: Sort = { column: 'timestamp', ascending: true }

// ---- query language --------------------------------------------------------
//
//   status:5xx method:post host:*.example.com path:/v1 type:json proto:grpc
//   size>10k dur>500 body:"not found" header:authorization header:x-id=42 -status:2xx
//
// Words without a key match the URL, method, status or error text. `body`, `header`,
// `req` and `res` need headers and bodies, which rows do not carry: those terms are
// evaluated by the extension host (`remote`) and joined by transaction id.

export type Key =
    | 'status'
    | 'method'
    | 'host'
    | 'server'
    | 'path'
    | 'url'
    | 'type'
    | 'proto'
    | 'size'
    | 'dur'
    | 'rule'
    | 'body'
    | 'header'
    | 'req'
    | 'res'
    | 'text'

export interface Term {
    key: Key
    /** `=`, `>` or `<`; only `>`/`<` are meaningful for numeric keys. */
    op: '=' | '>' | '<'
    value: string
    negate: boolean
}

export const remoteKeys: Key[] = ['body', 'header', 'req', 'res']

const aliases: Record<string, Key> = {
    status: 'status',
    code: 'status',
    method: 'method',
    host: 'host',
    domain: 'host',
    server: 'server',
    ip: 'server',
    path: 'path',
    url: 'url',
    type: 'type',
    mime: 'type',
    proto: 'proto',
    protocol: 'proto',
    size: 'size',
    bytes: 'size',
    dur: 'dur',
    duration: 'dur',
    time: 'dur',
    rule: 'rule',
    body: 'body',
    header: 'header',
    req: 'req',
    request: 'req',
    res: 'res',
    response: 'res'
}

/** One token per match: an optional `-key:` prefix, then a quoted or bare value. */
const token = /(?:(-?)([a-z]+)([:=><]))?(?:"([^"]*)"|(\S+))/gi

export function parseQuery(text: string): Term[] {
    const terms: Term[] = []
    for (const m of text.matchAll(token)) {
        const [, minus, name, op, quoted, bare] = m
        const key = name ? aliases[name.toLowerCase()] : undefined
        let value = quoted ?? bare ?? ''
        let negate = minus === '-'
        if (!key) {
            // Not a known key: the whole token is free text (keeps `foo:bar` searchable).
            value = (name ? `${name}${op}` : '') + value
            if (!name && value.startsWith('-') && value.length > 1) {
                negate = true
                value = value.slice(1)
            }
            if (value) terms.push({ key: 'text', op: '=', value: value.toLowerCase(), negate })
            continue
        }
        if (value === '') continue
        terms.push({ key, op: op === '>' || op === '<' ? op : '=', value, negate })
    }
    return terms
}

/** `10k`, `2m`, `500` → bytes/ms. */
export function number(value: string): number {
    const m = /^([\d.]+)\s*([kmg]?)b?$/i.exec(value.trim())
    if (!m) return NaN
    const scale = { '': 1, k: 1024, m: 1048576, g: 1073741824 }[m[2].toLowerCase()] ?? 1
    return parseFloat(m[1]) * scale
}

function compare(actual: number, op: Term['op'], value: string) {
    const wanted = op === '=' ? parseFloat(value) : number(value)
    if (Number.isNaN(wanted)) return true
    return op === '>' ? actual > wanted : op === '<' ? actual < wanted : actual === wanted
}

function statusMatches(row: Row, value: string) {
    const v = value.toLowerCase()
    if (v === 'pending') return row.state === 'pending'
    if (v === 'error' || v === 'err') return row.state === 'error' || (row.status ?? 0) >= 400
    if (v === 'paused') return !!row.paused
    if (/^\dxx$/.test(v)) return Math.floor((row.status ?? 0) / 100) === Number(v[0])
    return String(row.status ?? '').startsWith(v)
}

function protoMatches(row: Row, value: string) {
    const v = value.toLowerCase()
    if (v === 'ws' || v === 'websocket') return row.websocket
    if (v === 'sse') return row.events !== undefined
    if (v === 'grpc') return row.grpc
    if (v === 'h2' || v === 'http2') return row.httpVersion === '2.0'
    if (v === 'h3' || v === 'http3') return row.httpVersion === '3.0'
    if (v === 'tls' || v === 'https') return row.tls
    if (v === 'connect' || v === 'tunnel') return row.scheme === 'connect'
    return row.scheme === v || `${row.scheme} http/${row.httpVersion ?? ''}`.includes(v)
}

/** Whether one local term holds for a row. */
export function termMatches(row: Row, term: Term): boolean {
    const v = term.value
    const lower = v.toLowerCase()
    let hit: boolean
    switch (term.key) {
        case 'text':
            hit =
                row.url.toLowerCase().includes(lower) ||
                row.method.toLowerCase().includes(lower) ||
                String(row.status ?? '').startsWith(lower) ||
                (row.error ?? '').toLowerCase().includes(lower)
            break
        case 'status':
            hit = statusMatches(row, v)
            break
        case 'method':
            hit = v
                .split(',')
                .map((m) => m.trim().toLowerCase())
                .includes(row.method.toLowerCase())
            break
        case 'host':
            hit = v.includes('*')
                ? matchWildcard(v, row.host)
                : row.host.toLowerCase().includes(lower)
            break
        case 'server':
            hit = (row.serverAddress ?? '').toLowerCase().includes(lower)
            break
        case 'path':
            hit = v.includes('*')
                ? matchWildcard(v, row.path)
                : row.path.toLowerCase().includes(lower)
            break
        case 'url':
            hit = v.includes('*')
                ? matchWildcard(v, row.url)
                : row.url.toLowerCase().includes(lower)
            break
        case 'type':
            hit = row.contentType.includes(lower)
            break
        case 'proto':
            hit = protoMatches(row, v)
            break
        case 'size':
            hit = compare(row.responseBytes, term.op, v)
            break
        case 'dur':
            hit = row.state !== 'pending' && compare(row.duration, term.op, v)
            break
        case 'rule':
            hit =
                lower === 'none' || lower === 'false' || lower === '0' ? !row.rules : row.rules > 0
            break
        default:
            // Remote terms are evaluated together by the host; see `matches`.
            return true
    }
    return term.negate ? !hit : hit
}

function quickMatches(row: Row, quick: Quick): boolean {
    switch (quick) {
        case 'all':
            return true
        case 'pending':
            return row.state === 'pending'
        case 'error':
            return row.state === 'error' || (row.status ?? 0) >= 400
        default:
            return Math.floor((row.status ?? 0) / 100) === Number(quick[0])
    }
}

/**
 * Whether a row passes the filters. `remote` holds the ids the host found for the
 * query's body/header terms; while it is undefined those terms are treated as true.
 */
export function matches(
    row: Row,
    filters: Filters,
    terms: Term[] = parseQuery(filters.text),
    remote?: Set<string>
): boolean {
    if (filters.hideTunnels && row.scheme === 'connect') return false
    if (filters.host && row.host !== filters.host) return false
    if (!quickMatches(row, filters.quick)) return false
    if (!terms.every((term) => termMatches(row, term))) return false
    // The host answers the body/header terms as one id set (all of them together).
    return !remote || !terms.some((t) => remoteKeys.includes(t.key)) || remote.has(row.id)
}

/** The part of a query the host must evaluate, as text, or '' when there is none. */
export function remoteQuery(terms: Term[]): string {
    return terms
        .filter((t) => remoteKeys.includes(t.key))
        .map((t) => `${t.negate ? '-' : ''}${t.key}${t.op}${JSON.stringify(t.value)}`)
        .join(' ')
}

const key = (row: Row, column: Column): string | number =>
    column === 'timestamp' ? row.sequence : (row[column] ?? '')

/** Stable sort; ties fall back to capture order so live updates never shuffle rows. */
export function sortRows(rows: Row[], sort: Sort): Row[] {
    return [...rows].sort((a, b) => {
        const x = key(a, sort.column)
        const y = key(b, sort.column)
        const order =
            typeof x === 'number' && typeof y === 'number'
                ? x - y
                : String(x).localeCompare(String(y))
        return (sort.ascending ? order : -order) || a.sequence - b.sequence
    })
}

export function toggleSort(sort: Sort, column: Column): Sort {
    return {
        column,
        ascending: sort.column === column ? !sort.ascending : column !== 'responseBytes'
    }
}

export function isFiltered(filters: Filters): boolean {
    return !!filters.text.trim() || filters.quick !== 'all' || !!filters.host || filters.hideTunnels
}
