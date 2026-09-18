import { useEffect, useMemo, useState } from 'react'
import { bytes, duration, type Transaction } from '../../shared/model'
import { t } from '../lib/i18n'
import { saveState, vscode } from '../lib/vscode'
import type { Row } from '../types/messages'
import { SplitPane } from './SplitPane'
import { StatusBadge } from './StatusBadge'
import { TransactionView } from './TransactionView'

type Column = 'status' | 'method' | 'host' | 'path' | 'timestamp' | 'duration' | 'responseBytes'
const columns: Column[] = [
    'status',
    'method',
    'host',
    'path',
    'timestamp',
    'duration',
    'responseBytes'
]

function matches(row: Row, filter: string) {
    const needle = filter.trim().toLowerCase()
    if (!needle) return true
    return (
        row.url.toLowerCase().includes(needle) ||
        row.method.toLowerCase().includes(needle) ||
        String(row.status ?? '').startsWith(needle) ||
        (row.error ?? '').toLowerCase().includes(needle)
    )
}

/** Charles "Sequence": sortable, filterable table with the selected request's detail below. */
export function SequenceView({
    rows,
    detail,
    selected,
    onSelect
}: {
    rows: Row[]
    detail?: Transaction
    selected?: string
    onSelect(id: string): void
}) {
    const [filter, setFilter] = useState('')
    const [sort, setSort] = useState<{ column: Column; ascending: boolean }>({
        column: 'timestamp',
        ascending: false
    })
    const visible = useMemo(() => {
        const list = rows.filter((r) => matches(r, filter))
        const key = (r: Row) => (sort.column === 'timestamp' ? r.sequence : (r[sort.column] ?? ''))
        return list.sort((a, b) => {
            const x = key(a)
            const y = key(b)
            const order =
                typeof x === 'number' && typeof y === 'number'
                    ? x - y
                    : String(x).localeCompare(String(y))
            return sort.ascending ? order : -order
        })
    }, [rows, filter, sort])
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (!['ArrowUp', 'ArrowDown'].includes(event.key) || !visible.length) return
            const index = visible.findIndex((r) => r.id === selected)
            const next =
                visible[
                    Math.min(
                        visible.length - 1,
                        Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1))
                    )
                ]
            if (next && next.id !== selected) onSelect(next.id)
            event.preventDefault()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [visible, selected, onSelect])
    const toggle = (column: Column) =>
        setSort((s) => ({
            column,
            ascending: s.column === column ? !s.ascending : column === 'timestamp' ? false : true
        }))
    const table = (
        <div className="sequence">
            <div className="toolbar">
                <input
                    className="filter"
                    placeholder={t('filterPlaceholder')}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                />
                <span className="muted">{t('rowsCount', visible.length, rows.length)}</span>
            </div>
            <div className="table-scroll">
                <table className="list sequence-table">
                    <thead>
                        <tr>
                            {columns.map((c) => (
                                <th
                                    key={c}
                                    onClick={() => toggle(c)}
                                    className={sort.column === c ? 'sorted' : ''}
                                >
                                    {t(`col.${c}`)}
                                    {sort.column === c ? (sort.ascending ? ' ▲' : ' ▼') : ''}
                                </th>
                            ))}
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {visible.map((r) => (
                            <tr
                                key={r.id}
                                className={r.id === selected ? 'selected' : ''}
                                onClick={() => onSelect(r.id)}
                            >
                                <td>
                                    <StatusBadge x={r} />
                                </td>
                                <td className="mono">{r.method}</td>
                                <td className="mono">{r.host}</td>
                                <td className="mono path" title={r.url}>
                                    {r.replayOf ? '↻ ' : ''}
                                    {r.scheme === 'connect' ? r.path : r.path || '/'}
                                </td>
                                <td className="mono">
                                    {new Date(r.timestamp).toLocaleTimeString()}
                                </td>
                                <td>{r.state === 'pending' ? '…' : duration(r.duration)}</td>
                                <td>{bytes(r.responseBytes)}</td>
                                <td className="row-actions">
                                    {r.scheme !== 'connect' && (
                                        <button
                                            title={t('replay')}
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                vscode.postMessage({ type: 'replay', id: r.id })
                                            }}
                                        >
                                            ↻
                                        </button>
                                    )}
                                    <button
                                        title={t('copyCurl')}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            vscode.postMessage({ type: 'copyCurl', id: r.id })
                                        }}
                                    >
                                        cURL
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
    const bottom =
        detail && detail.id === selected ? (
            <TransactionView transaction={detail} compact />
        ) : (
            <div className="empty">{t('selectRow')}</div>
        )
    return <SplitPane top={table} bottom={bottom} initial={0.45} />
}

export function useSequenceState() {
    const [selected, setSelected] = useState<string | undefined>(() => vscode.getState()?.selected)
    const select = (id: string) => {
        setSelected(id)
        saveState({ selected: id })
        vscode.postMessage({ type: 'select', id })
    }
    return { selected, select, setSelected }
}
