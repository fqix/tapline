// Newline-delimited JSON between VS Code windows (clients) and the shared agent.
import type {
    AgentState,
    BreakpointEdit,
    ComposeRequest,
    Event,
    LogEntry,
    Settings,
    Transaction
} from '../shared/model'

export type Request =
    | { method: 'hello'; settings: Settings; sessionId?: string; workspaceName?: string }
    | { method: 'settings'; settings: Settings }
    | { method: 'state' }
    | { method: 'snapshot' }
    | { method: 'start' }
    | { method: 'stop' }
    | { method: 'record'; value: boolean }
    | { method: 'clear' }
    | { method: 'delete'; ids: string[] }
    | { method: 'annotate'; transaction: string; note?: string; marked?: boolean }
    | { method: 'compose'; request: ComposeRequest }
    | { method: 'resendFrame'; transaction: string; frame: string }
    /** Continue a transaction held at a breakpoint, with edits. */
    | { method: 'resume'; transaction: string; edit?: BreakpointEdit }
    /** Fail a transaction held at a breakpoint. */
    | { method: 'abort'; transaction: string }
    | { method: 'logs' }
    /** Stop capture and exit so a newer build can take over; clients respawn it. */
    | { method: 'shutdown' }
    /** Promote a healthy staged agent to the shared endpoint after upgrade. */
    | { method: 'promote' }

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
    annotate: AgentState
    compose: Transaction
    resendFrame: AgentState
    resume: AgentState
    abort: AgentState
    logs: LogEntry[]
    shutdown: AgentState
    promote: AgentState
}

export type Message =
    { id: number; result: unknown } | { id: number; error: string } | { event: Event }

/** Bumped whenever the wire format changes so stale agents are never reused. */
export const PROTOCOL = 'tapline-agent-5'
