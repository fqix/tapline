import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { bytes, duration } from '../../shared/model'
import { columns, toggleSort, type Column, type Sort } from '../lib/filter'
import { t } from '../lib/i18n'
import { saveState, state, vscode } from '../lib/vscode'
import type { Row } from '../types/messages'
import { IconButton } from './IconButton'
import { methodClass, methodLabel, StatusBadge } from './StatusBadge'
import { VirtualList } from './VirtualList'

export const ROW_HEIGHT = 22

const numeric: Column[] = ['sequence', 'timestamp', 'duration', 'responseBytes']
type Widths = Record<Exclude<Column, 'path'>, number>
/** Columns follow the workbench font used by the list. */
const workbenchScale = () => {
    const size = parseFloat(getComputedStyle(document.body).getPropertyValue('--vscode-font-size'))
    return Number.isFinite(size) && size > 0 ? Math.max(1, size / 13) : 1
}
const defaultWidths = (): Widths => {
    const k = workbenchScale()
    return {
        sequence: Math.round(48 * k),
        status: 68,
        method: Math.round(66 * k),
        host: Math.round(170 * k),
        timestamp: Math.round(96 * k),
        duration: 80,
        responseBytes: 80
    }
}
const MIN_WIDTH = 40
/** Cell classes let narrow panes drop columns via container queries in table.css. */
const columnClass: Record<Column, string> = {
    sequence: 'seq',
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

const pathIcon = (row: Row) =>
    row.paused
        ? 'debug-pause'
        : row.local
          ? 'file'
          : row.replayOf
            ? 'debug-restart'
            : row.websocket
              ? 'plug'
              : row.events !== undefined
                ? 'radio-tower'
                : row.rules
                  ? 'edit'
                  : undefined

export interface SelectOptions {
    /** Add to / remove from the selection (Cmd/Ctrl-click). */
    toggle?: boolean
    /** Extend the selection from the anchor (Shift-click). */
    range?: boolean
}

const RowView = memo(function RowView({
    row,
    selected,
    primary,
    comparisonIds,
    onSelect
}: {
    row: Row
    selected: boolean
    /** The row the inspector shows (one of the selected). */
    primary: boolean
    comparisonIds?: string[]
    onSelect(id: string, options?: SelectOptions): void
}) {
    return (
        <div
            className={`grid-row ${selected ? 'selected' : ''} ${primary ? 'primary' : ''} ${row.state} ${row.paused ? 'paused' : ''}`}
            role="row"
            aria-selected={selected}
            data-vscode-context={JSON.stringify({
                webviewSection: 'requests',
                id: row.id,
                taplineReplay: !!row.replayOf,
                taplineCompareCount: comparisonIds?.length ?? 0,
                ids: comparisonIds
            })}
            onClick={(e) => onSelect(row.id, { toggle: e.metaKey || e.ctrlKey, range: e.shiftKey })}
            onDoubleClick={() => vscode.postMessage({ type: 'openText', id: row.id })}
        >
            <span role="gridcell" className="mono num seq c-seq">
                {row.sequence}
            </span>
            <span role="gridcell">
                <StatusBadge x={{ ...row, grpcStatus: row.grpcStatus }} />
            </span>
            <span role="gridcell" className={methodClass(methodLabel(row))}>
                {methodLabel(row)}
            </span>
            <span role="gridcell" className="mono ellipsis c-host" title={row.host}>
                {/* Always reserve the icon slot so host names line up across rows. */}
                <span
                    className={`codicon codicon-lock dim ${row.tls ? '' : 'slot-empty'}`}
                    aria-hidden="true"
                />
                {row.host}
            </span>
            <span role="gridcell" className="mono ellipsis path" title={row.url}>
                {/* One icon slot per row (paused, local, replay, WebSocket, SSE, rule) so paths line up. */}
                <span
                    className={`codicon codicon-${pathIcon(row) ?? 'circle-filled slot-empty'} dim`}
                    title={row.rules ? t('rulesApplied') : undefined}
                    aria-hidden="true"
                />
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
                        vscode.postMessage({ type: 'copyCurl', ids: [row.id] })
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
    selection,
    onSelect,
    sort,
    onSort,
    focus,
    onClearFilters
}: {
    rows: Row[]
    total: number
    selected?: string
    selection: string[]
    onSelect(id: string | undefined, options?: SelectOptions): void
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
                if (next && (next.id !== selected || event.shiftKey))
                    onSelect(next.id, { range: event.shiftKey })
                event.preventDefault()
            } else if ((event.metaKey || event.ctrlKey) && event.key === 'a') {
                if (rows.length) {
                    onSelect(rows[0].id)
                    onSelect(rows[rows.length - 1].id, { range: true })
                }
                event.preventDefault()
            } else if (event.key === 'Enter' && selected) {
                vscode.postMessage({ type: 'openText', id: selected })
            } else if (
                selected &&
                (event.key === 'Delete' ||
                    (event.key === 'Backspace' && (event.metaKey || event.ctrlKey)))
            ) {
                vscode.postMessage({
                    type: 'delete',
                    ids: selection.length ? selection : [selected]
                })
            } else if (event.key === 'Escape') {
                if (selected) onSelect(undefined)
                else onClearFilters()
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [rows, index, selected, selection, onSelect, onClearFilters])
    const selectedSet = useMemo(() => new Set(selection), [selection])
    const [widths, setWidths] = useState<Widths>(() => ({
        ...defaultWidths(),
        ...(state().columns as Partial<Widths> | undefined)
    }))
    /** Drag the handle at a header's right edge; double-click restores the default. */
    const startResize = useCallback(
        (column: keyof Widths, event: React.PointerEvent) => {
            event.preventDefault()
            event.stopPropagation()
            // Capturing keeps every event (including the final click) on the handle, so
            // releasing over another header never toggles its sort.
            const handle = event.currentTarget as HTMLElement
            handle.setPointerCapture(event.pointerId)
            const origin = event.clientX
            const initial = widths[column]
            let latest = initial
            const move = (e: PointerEvent) => {
                latest = Math.max(MIN_WIDTH, Math.round(initial + e.clientX - origin))
                setWidths((w) => ({ ...w, [column]: latest }))
            }
            const up = () => {
                handle.removeEventListener('pointermove', move)
                handle.removeEventListener('pointerup', up)
                document.body.classList.remove('resizing-column')
                saveState({ columns: { ...widths, [column]: latest } })
            }
            document.body.classList.add('resizing-column')
            handle.addEventListener('pointermove', move)
            handle.addEventListener('pointerup', up)
        },
        [widths]
    )
    const resetWidth = (column: keyof Widths) => {
        const next = { ...widths, [column]: defaultWidths()[column] }
        setWidths(next)
        saveState({ columns: next })
    }
    const style = Object.fromEntries(
        Object.entries(widths).map(([c, w]) => [`--w-${columnClass[c as Column]}`, `${w}px`])
    ) as React.CSSProperties
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
                    {c !== 'path' && (
                        <span
                            className="col-resize"
                            role="separator"
                            aria-orientation="vertical"
                            onPointerDown={(e) => startResize(c, e)}
                            onClick={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => {
                                e.stopPropagation()
                                resetWidth(c)
                            }}
                        />
                    )}
                </span>
            ))}
            <span role="columnheader" />
        </div>
    )
    return (
        <div className="sequence" role="grid" aria-rowcount={rows.length} style={style}>
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
                        selected={row.id === selected || selectedSet.has(row.id)}
                        primary={row.id === selected}
                        comparisonIds={
                            selection.length === 2 && selectedSet.has(row.id)
                                ? selection
                                : undefined
                        }
                        onSelect={onSelect}
                    />
                )}
            />
        </div>
    )
}
