import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { bytes, duration, formatHttpVersion } from '../../shared/model'
import { columns, toggleSort, type Column, type Sort } from '../lib/filter'
import { t } from '../lib/i18n'
import { saveState, state, vscode } from '../lib/vscode'
import type { Row } from '../types/messages'
import { IconButton } from './IconButton'
import { methodClass, methodLabel, StatusBadge } from './StatusBadge'
import { VirtualList } from './VirtualList'

export const ROW_HEIGHT = 22

const numeric: Column[] = ['sequence', 'timestamp', 'duration', 'responseBytes']
type Widths = Record<Exclude<Column, 'url'>, number>
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
        method: Math.round(82 * k),
        httpVersion: Math.round(96 * k),
        serverAddress: Math.round(130 * k),
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
    httpVersion: 'proto',
    url: 'url',
    serverAddress: 'server',
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
                taplineMarked: !!row.marked,
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
            <span
                role="gridcell"
                className="mono ellipsis c-proto"
                title={formatHttpVersion(row.httpVersion)}
            >
                {formatHttpVersion(row.httpVersion)}
            </span>
            <span role="gridcell" className="mono ellipsis path c-url" title={row.url}>
                {/* One icon slot per row (paused, local, replay, WebSocket, SSE, rule, TLS) so URLs line up. */}
                <span
                    className={`codicon codicon-${pathIcon(row) ?? (row.tls ? 'lock' : 'circle-filled slot-empty')} dim`}
                    title={row.rules ? t('rulesApplied') : undefined}
                    aria-hidden="true"
                />
                {row.marked && (
                    <span className="codicon codicon-star-full request-mark" title={t('mark')} />
                )}
                {row.note && <span className="codicon codicon-comment" title={row.note} />}
                {row.scheme === 'connect' ? row.path : row.url}
            </span>
            <span role="gridcell" className="mono ellipsis c-server" title={row.serverAddress}>
                {row.serverAddress ?? ''}
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
    const [widths, setWidths] = useState<Widths>(() => {
        const defaults = defaultWidths()
        // Widths remembered for columns that no longer exist (Host, Path) are dropped.
        const remembered = Object.entries(state().columns ?? {}).filter(([c]) => c in defaults)
        return { ...defaults, ...Object.fromEntries(remembered) }
    })
    /**
     * Drag a column boundary; double-click restores the default. Columns left of the
     * flexible URL column carry the handle on their right edge and grow with the
     * pointer; columns right of it are anchored to the table's right edge, so their
     * handle sits on the left edge and the width moves against the pointer. Either
     * way the boundary under the pointer follows it.
     */
    const startResize = useCallback(
        (column: keyof Widths, sign: 1 | -1, event: React.PointerEvent) => {
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
                latest = Math.max(MIN_WIDTH, Math.round(initial + sign * (e.clientX - origin)))
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
    const flexible = columns.indexOf('url')
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
                    {c !== 'url' && (
                        <span
                            className={`col-resize ${columns.indexOf(c) > flexible ? 'left' : ''}`}
                            role="separator"
                            aria-orientation="vertical"
                            onPointerDown={(e) =>
                                startResize(c, columns.indexOf(c) > flexible ? -1 : 1, e)
                            }
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
