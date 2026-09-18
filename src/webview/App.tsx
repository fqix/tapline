import { useEffect, useState } from 'react'
import type { Transaction } from '../shared/model'
import { HostView } from './components/HostView'
import { SequenceView, useSequenceState } from './components/SequenceView'
import { TransactionView } from './components/TransactionView'
import { useHostMessages } from './hooks/useHostMessages'
import { t } from './lib/i18n'
import type { Row } from './types/messages'

export function App() {
    const { view, detail } = useHostMessages()
    const { selected, select, setSelected } = useSequenceState()
    const [rows, setRows] = useState<Row[]>([])
    useEffect(() => {
        if (view?.type === 'sequence') setRows(view.rows)
    }, [view])
    useEffect(() => {
        if (detail?.select) setSelected(detail.transaction.id)
    }, [detail, setSelected])
    if (!view) return <div className="empty">…</div>
    if (view.type === 'gone') return <div className="empty">{t('gone')}</div>
    if (view.type === 'host') return <HostView summary={view.summary} />
    if (view.type === 'sequence')
        return (
            <SequenceView
                rows={rows}
                detail={detail?.transaction}
                selected={selected}
                onSelect={select}
            />
        )
    return <TransactionView transaction={view.transaction as Transaction} />
}
