import { useState } from 'react'
import { toCurl, type Transaction } from '../../shared/model'
import { t } from '../lib/i18n'
import { saveState, state, vscode } from '../lib/vscode'
import { Frames, ServerEvents } from './Frames'
import { IconButton } from './IconButton'
import { MessageView } from './MessageView'
import { Overview } from './Overview'
import { methodClass, methodLabel, StatusBadge } from './StatusBadge'

type Tab = 'overview' | 'request' | 'response' | 'frames' | 'events'

/** Detail of the selected request: summary strip, tabs and one scrolling page per tab. */
export function Inspector({ x, onFocus }: { x: Transaction; onFocus(id: string): void }) {
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
                {active === 'overview' && <Overview x={x} onFocus={onFocus} />}
                {active === 'request' && <MessageView key={x.id} x={x} side="request" />}
                {active === 'response' && <MessageView key={x.id} x={x} side="response" />}
                {active === 'frames' && <Frames x={x} />}
                {active === 'events' && <ServerEvents x={x} />}
            </div>
        </div>
    )
}
