import type { Transaction } from '../shared/model'
import { HostView } from './components/HostView'
import { TransactionView } from './components/TransactionView'
import { useHostMessages } from './hooks/useHostMessages'
import { t } from './lib/i18n'

export function App() {
    const view = useHostMessages()
    if (!view) return <div className="empty">…</div>
    if (view.type === 'gone') return <div className="empty">{t('gone')}</div>
    if (view.type === 'host') return <HostView summary={view.summary} />
    return <TransactionView transaction={view.transaction as Transaction} />
}
