import { useEffect, useState } from 'react'
import type { Transaction } from '../shared/model'
import { HostView } from './HostView'
import { TransactionView } from './TransactionView'
import { t } from './strings'
import { vscode, type HostMessage } from './vscode'

export function App() {
    const [view, setView] = useState<HostMessage | undefined>(() => vscode.getState()?.view)
    useEffect(() => {
        const listener = (event: MessageEvent<HostMessage>) => {
            setView(event.data)
            vscode.setState({ ...vscode.getState(), view: event.data })
        }
        window.addEventListener('message', listener)
        vscode.postMessage({ type: 'ready' })
        return () => window.removeEventListener('message', listener)
    }, [])
    if (!view) return <div className="empty">…</div>
    if (view.type === 'gone') return <div className="empty">{t('gone')}</div>
    if (view.type === 'host') return <HostView summary={view.summary} />
    return <TransactionView transaction={view.transaction as Transaction} />
}
