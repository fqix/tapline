import { useCallback, useEffect, useRef, useState } from 'react'
import type { Rule, Transaction } from '../../shared/model'
import { defaultFilters, matches, type Filters } from '../lib/filter'
import { saveState, state, vscode } from '../lib/vscode'
import type { ComposeDraft, HostMessage, Pane, Row } from '../types/messages'

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
    const [rules, setRulesState] = useState<Rule[]>([])
    /** Ids the host found for the body/header part of the filter, keyed by that query. */
    const [remote, setRemote] = useState<{ query: string; ids: Set<string> }>()
    const [pane, setPaneState] = useState<Pane>(() => {
        const saved = state().pane
        return saved && ['inspector', 'stats', 'rules', 'composer'].includes(saved)
            ? saved
            : 'inspector'
    })
    const [draft, setDraftState] = useState<ComposeDraft | undefined>(() => state().draft)
    /** Outcome of the last curl import, shown by the composer until the next one. */
    const [curlImport, setCurlImport] = useState<{ warnings: string[]; error?: string }>()
    const [pickedFile, setPickedFile] = useState<{ ruleId: string; path: string }>()
    const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

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

    const setPane = useCallback((next: Pane) => {
        setPaneState(next)
        saveState({ pane: next })
    }, [])

    const setDraft = useCallback((next: ComposeDraft | undefined) => {
        setDraftState(next)
        saveState({ draft: next })
    }, [])

    /** Local edit first, then one save to the host once typing pauses. */
    const setRules = useCallback((next: Rule[]) => {
        setRulesState(next)
        clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => {
            saveTimer.current = undefined
            vscode.postMessage({ type: 'saveRules', rules: next })
        }, 400)
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
                    setPane('inspector')
                    return
                case 'host':
                    setFilters({ ...defaultFilters, host: message.host })
                    select(undefined)
                    setPane('inspector')
                    return
                case 'rules':
                    // A save is in flight: the host echoes what we sent, keep our copy.
                    if (!saveTimer.current) setRulesState(message.rules)
                    return
                case 'search':
                    setRemote({ query: message.query, ids: new Set(message.ids) })
                    return
                case 'pane':
                    if (message.draft) setDraft(message.draft)
                    setPane(message.pane)
                    return
                case 'curl':
                    if (message.draft) setDraft(message.draft)
                    setCurlImport({ warnings: message.warnings, error: message.error })
                    setPane('composer')
                    return
                case 'pickedFile':
                    setPickedFile({ ruleId: message.ruleId, path: message.path })
                    return
            }
        }
        window.addEventListener('message', listener)
        vscode.postMessage({ type: 'ready' })
        return () => window.removeEventListener('message', listener)
    }, [select, setFilters, setPane, setDraft])

    // A picked file lands in its map-local rule.
    useEffect(() => {
        if (!pickedFile) return
        setPickedFile(undefined)
        setRules(
            rules.map((r) =>
                r.id === pickedFile.ruleId && r.kind === 'mapLocal'
                    ? { ...r, file: pickedFile.path }
                    : r
            )
        )
    }, [pickedFile, rules, setRules])

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
        focus,
        rules,
        setRules,
        remote,
        pane,
        setPane,
        draft,
        setDraft,
        curlImport,
        setCurlImport
    }
}
