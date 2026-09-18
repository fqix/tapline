import { useCallback, useEffect, useRef, useState } from 'react'
import type { Transaction } from '../../shared/model'
import { defaultFilters, matches, type Filters } from '../lib/filter'
import { saveState, state, vscode } from '../lib/vscode'
import type { HostMessage, Row } from '../types/messages'

/**
 * Table rows, selection and the selected transaction, kept live from host messages.
 * Rows are never persisted: the host resends them on `ready`, so only the selection
 * and filters survive a hidden panel.
 */
export function useTraffic() {
    const [rows, setRows] = useState<Map<string, Row>>(() => new Map())
    const [detail, setDetail] = useState<Transaction>()
    const [selected, setSelectedState] = useState<string | undefined>(() => state().selected)
    const [filters, setFiltersState] = useState<Filters>(() => ({
        ...defaultFilters,
        text: state().filter ?? '',
        host: state().host
    }))
    /** Bumped when the host asks to reveal a row so the table scrolls even if already selected. */
    const [focus, setFocus] = useState<{ id: string; tick: number }>()
    const pendingFocus = useRef<string | undefined>(undefined)

    const setFilters = useCallback((next: Filters | ((f: Filters) => Filters)) => {
        setFiltersState((prev) => {
            const value = typeof next === 'function' ? next(prev) : next
            saveState({ filter: value.text, host: value.host })
            return value
        })
    }, [])

    const select = useCallback((id: string | undefined) => {
        setSelectedState(id)
        saveState({ selected: id })
        vscode.postMessage({ type: 'select', id })
    }, [])

    useEffect(() => {
        const listener = (event: MessageEvent<HostMessage>) => {
            const message = event.data
            switch (message.type) {
                case 'rows':
                    setRows((prev) => {
                        const next = message.reset ? new Map<string, Row>() : new Map(prev)
                        for (const row of message.rows) next.set(row.id, row)
                        return next
                    })
                    return
                case 'detail':
                    setDetail(message.transaction)
                    return
                case 'focus':
                    pendingFocus.current = message.id
                    setSelectedState(message.id)
                    saveState({ selected: message.id })
                    setFocus((f) => ({ id: message.id, tick: (f?.tick ?? 0) + 1 }))
                    return
                case 'host':
                    setFilters({ ...defaultFilters, host: message.host })
                    select(undefined)
                    return
            }
        }
        window.addEventListener('message', listener)
        vscode.postMessage({ type: 'ready' })
        return () => window.removeEventListener('message', listener)
    }, [select, setFilters])

    // A focused row hidden by the filters would be invisible: drop the filters instead.
    useEffect(() => {
        const id = pendingFocus.current
        if (!id) return
        const row = rows.get(id)
        if (!row) return
        pendingFocus.current = undefined
        if (!matches(row, filters)) setFilters(defaultFilters)
    }, [rows, filters, focus, setFilters])

    // Selection vanished (clear, delete, eviction): let go of it.
    useEffect(() => {
        if (selected && rows.size && !rows.has(selected) && !pendingFocus.current) select(undefined)
    }, [rows, selected, select])

    return {
        rows,
        detail: detail && detail.id === selected ? detail : undefined,
        selected,
        select,
        filters,
        setFilters,
        focus
    }
}
