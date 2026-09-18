import { useState } from 'react'
import { toCurl, type Transaction } from '../../shared/model'
import { t } from '../lib/i18n'
import { saveState, vscode } from '../lib/vscode'
import { Frames } from './Frames'
import { Overview } from './Overview'
import { ContentsView } from './ContentsView'
import { StatusBadge } from './StatusBadge'

type Tab = 'overview' | 'contents' | 'frames'

export function TransactionView({
    transaction: x,
    compact = false
}: {
    transaction: Transaction
    compact?: boolean
}) {
    const [tab, setTab] = useState<Tab>(() => (vscode.getState()?.tab as Tab) ?? 'overview')
    const select = (next: Tab) => {
        setTab(next)
        saveState({ tab: next })
    }
    const isWS = x.frames.length > 0 || x.status === 101 || x.scheme.startsWith('ws')
    const tabs: Tab[] = ['overview', 'contents', ...(isWS ? (['frames'] as Tab[]) : [])]
    return (
        <div className={compact ? 'page compact' : 'page'}>
            <header className="summary">
                <span className={`badge status s${Math.floor((x.status ?? 0) / 100)} ${x.state}`}>
                    {x.state === 'pending'
                        ? '…'
                        : x.state === 'error' && !x.status
                          ? 'ERR'
                          : x.status}
                </span>
                <span className="method">{x.method}</span>
                <span className="url" title={x.url}>
                    {x.url}
                </span>
                <span className="actions">
                    <button onClick={() => vscode.postMessage({ type: 'copy', text: x.url })}>
                        {t('copy')} URL
                    </button>
                    <button onClick={() => vscode.postMessage({ type: 'copy', text: toCurl(x) })}>
                        {t('copyCurl')}
                    </button>
                    {x.scheme !== 'connect' && !isWS && !x.requestBinary && (
                        <button onClick={() => vscode.postMessage({ type: 'replay', id: x.id })}>
                            {t('replay')}
                        </button>
                    )}
                    <button onClick={() => vscode.postMessage({ type: 'openText', id: x.id })}>
                        {t('openText')}
                    </button>
                </span>
            </header>
            <nav className="tabs">
                {tabs.map((name) => (
                    <button
                        key={name}
                        className={tab === name ? 'active' : ''}
                        onClick={() => select(name)}
                    >
                        {t(name)}
                    </button>
                ))}
            </nav>
            {tab === 'overview' && <Overview x={x} />}
            {tab === 'contents' && <ContentsView x={x} />}
            {tab === 'frames' && <Frames x={x} />}
        </div>
    )
}
