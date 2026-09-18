import type { Transaction } from '../../shared/model'

/** Summary rows for the host overview. */
export interface HostSummary {
    host: string
    transactions: Transaction[]
}

/** Messages from the extension host to the panel. */
export type HostMessage =
    | { type: 'transaction'; transaction: Transaction }
    | { type: 'host'; summary: HostSummary }
    | { type: 'gone' }

/** Messages from the panel to the extension host. */
export type PanelMessage =
    | { type: 'ready' }
    | { type: 'copyCurl'; id: string }
    | { type: 'copy'; text: string }
    | { type: 'replay'; id: string }
    | { type: 'openText'; id: string }
    | { type: 'openBody'; id: string; side: 'request' | 'response' }
    | { type: 'open'; id: string }

export type PanelState = { view?: HostMessage; tab?: string }
