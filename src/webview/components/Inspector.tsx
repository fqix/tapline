import { useEffect, useState } from 'react'
import { toCurl, type Transaction } from '../../shared/model'
import { t } from '../lib/i18n'
import { saveState, state, vscode } from '../lib/vscode'
import type { ComposeDraft } from '../types/messages'
import { Editor, headersToText, textToHeaders, type EditorValue } from './Editor'
import { Frames, ServerEvents } from './Frames'
import { IconButton } from './IconButton'
import { MessageView } from './MessageView'
import { Overview } from './Overview'
import { methodClass, methodLabel, StatusBadge } from './StatusBadge'

type Tab = 'overview' | 'request' | 'response' | 'frames' | 'events'

/** Editor for a transaction held at a breakpoint, with Continue / Abort. */
function BreakpointBar({ x }: { x: Transaction }) {
    const phase = x.paused!
    const initial = (): EditorValue => ({
        method: x.method,
        url: x.upstreamUrl ?? x.url,
        status: String(x.status ?? 200),
        headers: headersToText(phase === 'request' ? x.requestHeaders : x.responseHeaders),
        body: phase === 'request' ? x.requestBody : x.responseBody
    })
    const [value, setValue] = useState<EditorValue>(initial)
    const [busy, setBusy] = useState(false)
    // A new hold on the same transaction (response after request) resets the form.
    useEffect(() => {
        setValue(initial())
        setBusy(false)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [x.id, phase])
    const binary = phase === 'request' ? x.requestBinary : x.responseBinary
    const resume = () => {
        setBusy(true)
        vscode.postMessage({
            type: 'resume',
            id: x.id,
            edit: {
                ...(phase === 'request' ? { method: value.method, url: value.url } : {}),
                ...(phase === 'response' ? { status: Number(value.status) || x.status } : {}),
                headers: textToHeaders(value.headers),
                ...(binary ? {} : { body: value.body })
            }
        })
    }
    return (
        <div className="breakpoint">
            <div className="breakpoint-head">
                <span className="codicon codicon-debug-pause" aria-hidden="true" />
                <strong>{t(phase === 'request' ? 'pausedRequest' : 'pausedResponse')}</strong>
                <span className="spacer" />
                <button type="button" className="button" disabled={busy} onClick={resume}>
                    <span className="codicon codicon-debug-continue" aria-hidden="true" />
                    {t('continue')}
                </button>
                <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                        setBusy(true)
                        vscode.postMessage({ type: 'abort', id: x.id })
                    }}
                >
                    <span className="codicon codicon-debug-stop" aria-hidden="true" />
                    {t('abort')}
                </button>
            </div>
            <Editor phase={phase} value={value} onChange={setValue} bodyDisabled={binary} />
        </div>
    )
}

/** Detail of the selected request: summary strip, tabs and one scrolling page per tab. */
export function Inspector({
    x,
    onFocus,
    onCompose
}: {
    x: Transaction
    onFocus(id: string): void
    onCompose(draft: ComposeDraft): void
}) {
    const [tab, setTab] = useState<Tab>(() => (state().tab as Tab) ?? 'overview')
    const choose = (next: Tab) => {
        setTab(next)
        saveState({ tab: next })
    }
    const websocket = x.frames.length > 0 || x.status === 101 || x.scheme.startsWith('ws')
    const tabs: Tab[] = [
        'overview',
        'request',
        'response',
        ...(websocket ? (['frames'] as Tab[]) : []),
        ...(x.events ? (['events'] as Tab[]) : [])
    ]
    const active = tabs.includes(tab) ? tab : 'overview'
    const replayable = x.scheme !== 'connect' && !websocket && !x.requestBinary
    return (
        <div className="inspector">
            <header className="inspector-head">
                <StatusBadge x={{ ...x, grpcStatus: x.grpc?.status }} />
                <span className={methodClass(methodLabel({ method: x.method, grpc: !!x.grpc }))}>
                    {methodLabel({ method: x.method, grpc: !!x.grpc })}
                </span>
                <button
                    type="button"
                    className="title url mono ellipsis"
                    title={x.url}
                    onClick={() => vscode.postMessage({ type: 'copy', text: x.url })}
                >
                    {x.url}
                </button>
                <span className="actions">
                    <IconButton
                        icon={x.marked ? 'star-full' : 'star-empty'}
                        title={t(x.marked ? 'unmark' : 'mark')}
                        active={!!x.marked}
                        onClick={() => vscode.postMessage({ type: 'toggleMark', id: x.id })}
                    />
                    <IconButton
                        icon="comment"
                        title={t('editNote')}
                        active={!!x.note}
                        onClick={() => vscode.postMessage({ type: 'editNote', id: x.id })}
                    />
                    {x.replayOf && (
                        <IconButton
                            icon="diff"
                            title={t('compareOriginal')}
                            onClick={() =>
                                vscode.postMessage({ type: 'compareOriginal', id: x.id })
                            }
                        />
                    )}
                    <IconButton
                        icon="copy"
                        title={t('copyUrl')}
                        onClick={() => vscode.postMessage({ type: 'copy', text: x.url })}
                    />
                    <IconButton
                        icon="terminal"
                        title={t('copyCurl')}
                        onClick={() => vscode.postMessage({ type: 'copy', text: toCurl(x) })}
                    />
                    {replayable && (
                        <IconButton
                            icon="debug-restart"
                            title={t('replay')}
                            onClick={() => vscode.postMessage({ type: 'replay', id: x.id })}
                        />
                    )}
                    {replayable && (
                        <IconButton
                            icon="edit"
                            title={t('editResend')}
                            onClick={() =>
                                onCompose({
                                    method: x.method,
                                    url: x.url,
                                    headers: headersToText(x.requestHeaders),
                                    body: x.requestBody,
                                    replayOf: x.id
                                })
                            }
                        />
                    )}
                    <IconButton
                        icon="file-text"
                        title={t('openText')}
                        onClick={() => vscode.postMessage({ type: 'openText', id: x.id })}
                    />
                    <IconButton
                        icon="trash"
                        title={t('delete')}
                        onClick={() => vscode.postMessage({ type: 'delete', ids: [x.id] })}
                    />
                </span>
            </header>
            <nav className="tabs" role="tablist">
                {tabs.map((name) => (
                    <button
                        key={name}
                        type="button"
                        role="tab"
                        aria-selected={active === name}
                        className={active === name ? 'active' : ''}
                        onClick={() => choose(name)}
                    >
                        {t(name)}
                        {name === 'frames' && <span className="tab-count">{x.frames.length}</span>}
                        {name === 'events' && x.events && (
                            <span className="tab-count">{x.events.length}</span>
                        )}
                    </button>
                ))}
            </nav>
            <div className="inspector-body">
                {x.paused && <BreakpointBar x={x} />}
                {active === 'overview' && <Overview x={x} onFocus={onFocus} />}
                {active === 'request' && <MessageView key={x.id} x={x} side="request" />}
                {active === 'response' && <MessageView key={x.id} x={x} side="response" />}
                {active === 'frames' && <Frames key={x.id} x={x} />}
                {active === 'events' && <ServerEvents key={x.id} x={x} />}
            </div>
        </div>
    )
}
