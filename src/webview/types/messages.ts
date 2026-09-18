import type { Transaction } from '../../shared/model'

/** Lightweight row for the sequence table: no headers, bodies or frames. */
export type Row = Pick<
    Transaction,
    | 'id'
    | 'sequence'
    | 'timestamp'
    | 'method'
    | 'host'
    | 'path'
    | 'url'
    | 'scheme'
    | 'httpVersion'
    | 'state'
    | 'status'
    | 'duration'
    | 'requestBytes'
    | 'responseBytes'
    | 'tls'
    | 'error'
    | 'replayOf'
> & {
    /** Response media type without parameters, for the host overview tally. */
    contentType: string
    websocket: boolean
    events: number | undefined
    grpc: boolean
    grpcStatus: number | undefined
}

/** Row projection shared by the extension host and tests. */
export function toRow(t: Transaction): Row {
    const type = Object.entries(t.responseHeaders).find(
        ([k]) => k.toLowerCase() === 'content-type'
    )?.[1]
    return {
        id: t.id,
        sequence: t.sequence,
        timestamp: t.timestamp,
        method: t.method,
        host: t.host,
        path: t.path,
        url: t.url,
        scheme: t.scheme,
        httpVersion: t.httpVersion,
        state: t.state,
        status: t.status,
        duration: t.duration,
        requestBytes: t.requestBytes,
        responseBytes: t.responseBytes,
        tls: t.tls,
        error: t.error,
        replayOf: t.replayOf,
        contentType: (type ?? '').split(';')[0].trim().toLowerCase(),
        websocket: t.frames.length > 0 || t.status === 101 || t.scheme.startsWith('ws'),
        events: t.events?.length,
        grpc: t.grpc !== undefined,
        grpcStatus: t.grpc?.status
    }
}

/** Messages from the extension host to the panel. */
export type HostMessage =
    /** `reset` replaces the whole table; otherwise the rows are upserts. */
    | { type: 'rows'; rows: Row[]; reset: boolean }
    /** Full record for the selected row, pushed on selection and on every change to it. */
    | { type: 'detail'; transaction: Transaction }
    /** Select a row and scroll it into view (tree click, replay). */
    | { type: 'focus'; id: string }
    /** Filter the table to one host and show its overview. */
    | { type: 'host'; host: string }

/** Messages from the panel to the extension host. */
export type PanelMessage =
    | { type: 'ready' }
    | { type: 'copy'; text: string }
    | { type: 'copyCurl'; id: string }
    | { type: 'replay'; id: string }
    | { type: 'openText'; id: string }
    | { type: 'openBody'; id: string; side: 'request' | 'response' }
    | { type: 'select'; id: string | undefined }
    | { type: 'delete'; ids: string[] }

export type Layout = 'stacked' | 'side'

export interface PanelState {
    selected?: string
    tab?: string
    layout?: Layout
    filter?: string
    host?: string
    ratio?: number
    collapsed?: string[]
    bodyView?: Record<string, string>
}
