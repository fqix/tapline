import { useCallback, useDeferredValue, useMemo, useState } from 'react'
import { HostOverview } from './components/Overview'
import { Inspector } from './components/Inspector'
import { SequenceTable } from './components/SequenceTable'
import { SplitPane } from './components/SplitPane'
import { Toolbar } from './components/Toolbar'
import { useTraffic } from './hooks/useTraffic'
import { defaultFilters, defaultSort, matches, sortRows, type Sort } from './lib/filter'
import { t } from './lib/i18n'
import { saveState, state } from './lib/vscode'
import type { Layout } from './types/messages'

export function App() {
    const { rows, detail, selected, select, filters, setFilters, focus } = useTraffic()
    const [layout, setLayoutState] = useState<Layout>(() => state().layout ?? 'stacked')
    const [sort, setSort] = useState<Sort>(defaultSort)
    const deferred = useDeferredValue(filters)
    const visible = useMemo(
        () =>
            sortRows(
                [...rows.values()].filter((row) => matches(row, deferred)),
                sort
            ),
        [rows, deferred, sort]
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
    const focusRow = useCallback(
        (id: string) => {
            if (!rows.has(id)) return
            select(id)
        },
        [rows, select]
    )
    const inspector = detail ? (
        <Inspector x={detail} onFocus={focusRow} />
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
            />
            <SplitPane
                layout={layout}
                first={
                    <SequenceTable
                        rows={visible}
                        total={rows.size}
                        selected={selected}
                        onSelect={select}
                        sort={sort}
                        onSort={setSort}
                        focus={focus}
                        onClearFilters={clearFilters}
                    />
                }
                second={inspector}
            />
        </div>
    )
}
