import { afterEach, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import type { AgentClient } from '../../extension/client'
import { TrafficPanel, type PanelActions } from '../../extension/panels/trafficPanel'
import type { Event, Transaction } from '../../shared/model'
import { toRow, type PanelMessage } from '../../webview/types/messages'

const ui = vi.hoisted(() => ({
    receive: undefined as undefined | ((message: PanelMessage) => void),
    post: vi.fn()
}))
vi.mock('../../extension/preferences', () => ({
    preferences: { onDidChange: () => ({ dispose() {} }) }
}))
vi.mock('vscode', () => ({
    ViewColumn: { Active: 1 },
    env: { language: 'en' },
    Uri: { joinPath: () => 'asset' },
    l10n: { t: (text: string) => text },
    window: {
        createWebviewPanel: () => ({
            webview: {
                onDidReceiveMessage: (listener: typeof ui.receive) => {
                    ui.receive = listener
                },
                postMessage: ui.post,
                asWebviewUri: () => 'asset'
            },
            onDidDispose() {},
            dispose() {}
        })
    }
}))

afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
})

it('batches evictions with updates, including requests evicted before their first flush', () => {
    vi.useFakeTimers()
    let emit!: (event: Event) => void
    const make = (id: string) =>
        ({ id, scheme: 'http', responseHeaders: {}, frames: [] }) as unknown as Transaction
    const old = make('old')
    const keep = make('keep')
    const transactions = new Map([
        ['old', old],
        ['keep', keep]
    ])
    const client = {
        transactions,
        rules: () => [],
        onEvent: (listener: typeof emit) => {
            emit = listener
            return { dispose() {} }
        }
    }
    const panel = new TrafficPanel(
        {} as vscode.ExtensionContext,
        client as unknown as AgentClient,
        {} as PanelActions
    )
    try {
        panel.show()
        ui.receive!({ type: 'ready' })
        ui.post.mockClear()
        const transient = make('transient')
        transactions.set(transient.id, transient)
        emit({ type: 'transaction', transaction: transient })
        transactions.delete('old')
        transactions.delete('transient')
        emit({ type: 'removed', ids: ['old', 'transient'] })
        const latest = make('latest')
        transactions.set(latest.id, latest)
        emit({ type: 'transaction', transaction: latest })
        expect(ui.post).not.toHaveBeenCalled()
        vi.advanceTimersByTime(150)
        expect(ui.post).toHaveBeenCalledExactlyOnceWith({
            type: 'rows',
            reset: false,
            rows: [toRow(latest)],
            removed: ['transient', 'old']
        })
        ui.post.mockClear()
        transactions.delete('keep')
        emit({ type: 'removed', ids: ['keep'] })
        vi.advanceTimersByTime(150)
        expect(ui.post).toHaveBeenCalledExactlyOnceWith({
            type: 'rows',
            reset: false,
            rows: [],
            removed: ['keep']
        })
    } finally {
        panel.dispose()
    }
})
