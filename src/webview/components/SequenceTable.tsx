import { memo, useEffect, useMemo } from 'react'
import { bytes, duration } from '../../shared/model'
import { columns, toggleSort, type Column, type Sort } from '../lib/filter'
import { t } from '../lib/i18n'
import { vscode } from '../lib/vscode'
import type { Row } from '../types/messages'
import { IconButton } from './IconButton'
import { methodClass, StatusBadge } from './StatusBadge'
import { VirtualList } from './VirtualList'

export const ROW_HEIGHT = 22

const numeric: Column[] = ['timestamp', 'duration', 'responseBytes']
/** Cell classes let narrow panes drop columns via container queries in table.css. */
const columnClass: Record<Column, string> = {
    status: 'status',
    method: 'method',
    host: 'host',
    path: 'path',
    timestamp: 'start',
    duration: 'duration',
    responseBytes: 'size'
}

const clock = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
})

const RowView = memo(function RowView({
    row,
    selected,
    onSelect
}: {
    row: Row
    selected: boolean
    onSelect(id: string): void
}) {
    return (
        <div
            className={`grid-row ${selected ? 'selected' : ''} ${row.state}`}
            role="row"
            aria-selected={selected}
            onClick={() => onSelect(row.id)}
            onDoubleClick={() => vscode.postMessage({ type: 'openText', id: row.id })}
        >
            <span role="gridcell">
                <StatusBadge x={row} />
            </span>
            <span role="gridcell" className={methodClass(row.method)}>
                {row.method}
            </span>
            <span role="gridcell" className="mono ellipsis c-host" title={row.host}>
                {row.tls && <span className="codicon codicon-lock dim" aria-hidden="true" />}
                {row.host}
            </span>
            <span role="gridcell" className="mono ellipsis path" title={row.url}>
                {row.replayOf && (
                    <span className="codicon codicon-debug-restart dim" aria-hidden="true" />
                )}
                {row.websocket && <span className="codicon codicon-plug dim" aria-hidden="true" />}
                {row.events !== undefined && (
                    <span className="codicon codicon-radio-tower dim" aria-hidden="true" />
                )}
                {row.scheme === 'connect' ? row.path : row.path || '/'}
            </span>
            <span role="gridcell" className="mono num c-start">
                {clock.format(row.timestamp)}
            </span>
            <span role="gridcell" className="num c-duration">
                {row.state === 'pending' ? '…' : duration(row.duration)}
            </span>
            <span role="gridcell" className="num c-size">
                {bytes(row.responseBytes)}
            </span>
            <span role="gridcell" className="row-actions">
                {row.scheme !== 'connect' && !row.websocket && (
                    <IconButton
                        icon="debug-restart"
                        title={t('replay')}
                        onClick={(e) => {
                            e.stopPropagation()
                            vscode.postMessage({ type: 'replay', id: row.id })
                        }}
                    />
                )}
                <IconButton
                    icon="terminal"
                    title={t('copyCurl')}
                    onClick={(e) => {
                        e.stopPropagation()
                        vscode.postMessage({ type: 'copyCurl', id: row.id })
                    }}
                />
            </span>
        </div>
    )
})

/** Windowed, sortable sequence table with keyboard navigation. */
export function SequenceTable({
    rows,
    total,
    selected,
    onSelect,
    sort,
    onSort,
    focus,
    onClearFilters
}: {
    rows: Row[]
    total: number
    selected?: string
    onSelect(id: string | undefined): void
    sort: Sort
    onSort(sort: Sort): void
    focus?: { id: string; tick: number }
    onClearFilters(): void
}) {
    const index = useMemo(() => rows.findIndex((r) => r.id === selected), [rows, selected])
    const reveal = useMemo(
        () =>
            focus
                ? { index: rows.findIndex((r) => r.id === focus.id), tick: focus.tick }
                : undefined,
        [rows, focus]
    )
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null
            if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                if (!rows.length) return
                const step = event.key === 'ArrowDown' ? 1 : -1
                const next = rows[Math.min(rows.length - 1, Math.max(0, index + step))]
                if (next && next.id !== selected) onSelect(next.id)
                event.preventDefault()
            } else if (event.key === 'Enter' && selected) {
                vscode.postMessage({ type: 'openText', id: selected })
            } else if (
                selected &&
                (event.key === 'Delete' ||
                    (event.key === 'Backspace' && (event.metaKey || event.ctrlKey)))
            ) {
                vscode.postMessage({ type: 'delete', ids: [selected] })
            } else if (event.key === 'Escape') {
                if (selected) onSelect(undefined)
                else onClearFilters()
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [rows, index, selected, onSelect, onClearFilters])
    const header = (
        <div className="grid-head" role="row">
            {columns.map((c) => (
                <span
                    key={c}
                    role="columnheader"
                    className={`${sort.column === c ? 'sorted' : ''} ${numeric.includes(c) ? 'num' : ''} c-${columnClass[c]}`}
                    onClick={() => onSort(toggleSort(sort, c))}
                >
                    {t(`col.${c}`)}
                    {sort.column === c && (
                        <span
                            className={`codicon codicon-chevron-${sort.ascending ? 'up' : 'down'}`}
                            aria-hidden="true"
                        />
                    )}
                </span>
            ))}
            <span role="columnheader" />
        </div>
    )
    return (
        <div className="sequence" role="grid" aria-rowcount={rows.length}>
            <VirtualList
                items={rows}
                rowHeight={ROW_HEIGHT}
                header={header}
                reveal={reveal}
                empty={<div className="empty">{total ? t('noMatch') : t('empty')}</div>}
                render={(row) => (
                    <RowView
                        key={row.id}
                        row={row}
                        selected={row.id === selected}
                        onSelect={onSelect}
                    />
                )}
            />
        </div>
    )
}
