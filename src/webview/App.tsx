import { Settings } from './components/Settings'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Composer, emptyDraft } from './components/Composer'
import { HostOverview } from './components/Overview'
import { Inspector } from './components/Inspector'
import { Rules } from './components/Rules'
import { SequenceTable, type SelectOptions } from './components/SequenceTable'
import { SplitPane } from './components/SplitPane'
import { Stats } from './components/Stats'
import { Toolbar } from './components/Toolbar'
import { useTraffic } from './hooks/useTraffic'
import {
    defaultFilters,
    defaultSort,
    matches,
    parseQuery,
    remoteQuery,
    sortRows,
    type Sort
} from './lib/filter'
import { t } from './lib/i18n'
import { saveState, state, vscode } from './lib/vscode'
import type { ComposeDraft, Layout } from './types/messages'

export function App() {
    const {
        rows,
        detail,
        selected,
        select,
        filters,
        setFilters,
        focus,
        rules,
        setRules,
        remote,
        pane,
        setPane,
        draft,
        setDraft
    } = useTraffic()
    const [layout, setLayoutState] = useState<Layout>(() => state().layout ?? 'stacked')
    const [sort, setSort] = useState<Sort>(defaultSort)
    /** Every selected row (multi-select); `selected` is the one the inspector shows. */
    const [selection, setSelection] = useState<string[]>(() => (selected ? [selected] : []))
    const anchor = useRef<string | undefined>(selected)
    const deferred = useDeferredValue(filters)
    const terms = useMemo(() => parseQuery(deferred.text), [deferred.text])
    const remoteText = useMemo(() => remoteQuery(terms), [terms])
    // Body/header terms are answered by the host; ask again when the query or rows change.
    useEffect(() => {
        if (!remoteText) return
        const timer = setTimeout(
            () => vscode.postMessage({ type: 'search', query: remoteText }),
            remote?.query === remoteText ? 500 : 200
        )
        return () => clearTimeout(timer)
    }, [remoteText, rows, remote?.query])
    const remoteIds = remoteText
        ? remote?.query === remoteText
            ? remote.ids
            : new Set<string>()
        : undefined
    const visible = useMemo(
        () =>
            sortRows(
                [...rows.values()].filter((row) => matches(row, deferred, terms, remoteIds)),
                sort
            ),
        [rows, deferred, terms, remoteIds, sort]
    )
    const hostRows = useMemo(
        () => (deferred.host ? [...rows.values()].filter((r) => r.host === deferred.host) : []),
        [rows, deferred.host]
    )
    const setLayout = (next: Layout) => {
        setLayoutState(next)
        saveState({ layout: next })
    }
    const clearFilters = useCallback(() => setFilters(defaultFilters), [setFilters])
    // Keep the multi-selection honest when rows disappear or the primary changes elsewhere.
    useEffect(() => {
        setSelection((s) => {
            const kept = s.filter((id) => rows.has(id))
            if (selected && !kept.includes(selected)) return [selected]
            if (!selected && kept.length) return []
            return kept.length === s.length ? s : kept
        })
    }, [rows, selected])
    const onSelect = useCallback(
        (id: string | undefined, options?: SelectOptions) => {
            if (!id) {
                setSelection([])
                select(undefined)
                return
            }
            // Statistics give way to the inspector on a click; the editors stay put.
            if (pane === 'stats') setPane('inspector')
            if (options?.range && anchor.current) {
                const ids = visible.map((r) => r.id)
                const a = ids.indexOf(anchor.current)
                const b = ids.indexOf(id)
                if (a >= 0 && b >= 0) {
                    setSelection(ids.slice(Math.min(a, b), Math.max(a, b) + 1))
                    select(id)
                    return
                }
            }
            if (options?.toggle) {
                setSelection((s) => {
                    const next = s.includes(id) ? s.filter((x) => x !== id) : [...s, id]
                    select(next.includes(id) ? id : next.at(-1))
                    return next
                })
                anchor.current = id
                return
            }
            anchor.current = id
            setSelection([id])
            select(id)
        },
        [select, visible, pane, setPane]
    )
    const focusRow = useCallback(
        (id: string) => {
            if (!rows.has(id)) return
            onSelect(id)
            setPane('inspector')
        },
        [rows, onSelect, setPane]
    )
    const compose = useCallback(
        (next: ComposeDraft) => {
            setDraft(next)
            setPane('composer')
        },
        [setDraft, setPane]
    )
    const showHost = useCallback(
        (host: string) => {
            setFilters({ ...defaultFilters, host })
            onSelect(undefined)
            setPane('inspector')
        },
        [setFilters, onSelect, setPane]
    )
    const paused = useMemo(() => [...rows.values()].filter((r) => r.paused).length, [rows])
    const closePane = () => setPane('inspector')
    const second =
        pane === 'settings' ? (
            <Settings onClose={closePane} onRules={() => setPane('rules')} />
        ) : pane === 'rules' ? (
            <Rules rules={rules} onChange={setRules} onClose={closePane} />
        ) : pane === 'composer' ? (
            <Composer draft={draft ?? emptyDraft} onChange={setDraft} onClose={closePane} />
        ) : pane === 'stats' ? (
            <Stats rows={visible} onSelect={focusRow} onHost={showHost} onClose={closePane} />
        ) : detail ? (
            <Inspector x={detail} onFocus={focusRow} onCompose={compose} />
        ) : selected && rows.has(selected) ? (
            <div className="empty">…</div>
        ) : filters.host ? (
            <HostOverview host={filters.host} rows={hostRows} />
        ) : (
            <div className="empty">{t('selectRow')}</div>
        )
    return (
        <div className="app">
            <Toolbar
                filters={filters}
                onChange={setFilters}
                visible={visible.length}
                total={rows.size}
                layout={layout}
                onLayout={setLayout}
                pane={pane}
                onPane={(next) => setPane(pane === next ? 'inspector' : next)}
                rules={rules.filter((r) => r.enabled).length}
                paused={paused}
                selection={selection}
                onClearSelection={() => onSelect(undefined)}
            />
            <SplitPane
                layout={layout}
                first={
                    <SequenceTable
                        rows={visible}
                        total={rows.size}
                        selected={selected}
                        selection={selection}
                        onSelect={onSelect}
                        sort={sort}
                        onSort={setSort}
                        focus={focus}
                        onClearFilters={clearFilters}
                    />
                }
                second={second}
            />
        </div>
    )
}
