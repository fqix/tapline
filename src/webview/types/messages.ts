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
    | 'state'
    | 'status'
    | 'duration'
    | 'requestBytes'
    | 'responseBytes'
    | 'tls'
    | 'error'
    | 'replayOf'
>

export const rowKeys: (keyof Row)[] = [
    'id',
    'sequence',
    'timestamp',
    'method',
    'host',
    'path',
    'url',
    'scheme',
    'state',
    'status',
    'duration',
    'requestBytes',
    'responseBytes',
    'tls',
    'error',
    'replayOf'
]

export interface HostSummary {
    host: string
    transactions: Transaction[]
}

/** Messages from the extension host to a panel. */
export type HostMessage =
    | { type: 'transaction'; transaction: Transaction }
    | { type: 'host'; summary: HostSummary }
    | { type: 'sequence'; rows: Row[] }
    /** Full record for the row selected in the sequence view; `select` moves the selection. */
    | { type: 'detail'; transaction: Transaction; select?: boolean }
    | { type: 'gone' }

/** Messages from a panel to the extension host. */
export type PanelMessage =
    | { type: 'ready' }
    | { type: 'copy'; text: string }
    | { type: 'copyCurl'; id: string }
    | { type: 'replay'; id: string }
    | { type: 'openText'; id: string }
    | { type: 'openBody'; id: string; side: 'request' | 'response' }
    | { type: 'open'; id: string }
    | { type: 'select'; id: string }
    | { type: 'delete'; ids: string[] }

export type PanelState = { view?: HostMessage; tab?: string; selected?: string }
