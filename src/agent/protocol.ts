// Newline-delimited JSON between VS Code windows (clients) and the shared agent.
import type {
    AgentState,
    ComposeRequest,
    Event,
    LogEntry,
    Settings,
    Transaction
} from '../shared/model'

export type Request =
    | { method: 'hello'; settings: Settings }
    | { method: 'settings'; settings: Settings }
    | { method: 'state' }
    | { method: 'snapshot' }
    | { method: 'start' }
    | { method: 'stop' }
    | { method: 'record'; value: boolean }
    | { method: 'clear' }
    | { method: 'delete'; ids: string[] }
    | { method: 'compose'; request: ComposeRequest }
    | { method: 'logs' }
    /** Stop capture and exit so a newer build can take over; clients respawn it. */
    | { method: 'shutdown' }

export interface Responses {
    hello: AgentState
    settings: AgentState
    state: AgentState
    snapshot: { state: AgentState; transactions: Transaction[] }
    start: AgentState
    stop: AgentState
    record: AgentState
    clear: AgentState
    delete: AgentState
    compose: Transaction
    logs: LogEntry[]
    shutdown: AgentState
}

export type Message =
    { id: number; result: unknown } | { id: number; error: string } | { event: Event }

/** Bumped whenever the wire format changes so stale agents are never reused. */
export const PROTOCOL = 'tapline-agent-1'
