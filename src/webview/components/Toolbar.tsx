import { useEffect, useRef, useState } from 'react'
import { isFiltered, quickFilters, type Filters } from '../lib/filter'
import { t } from '../lib/i18n'
import { vscode } from '../lib/vscode'
import type { Layout, Pane } from '../types/messages'
import { IconButton } from './IconButton'

const syntax = [
    'status:5xx',
    'method:post',
    'host:api.*',
    'ip:10.0.',
    'path:/v1',
    'type:json',
    'proto:grpc',
    'size>10k',
    'dur>500',
    'body:"text"',
    'header:x-id=1',
    'rule:any',
    '-status:2xx'
]

/** Filter input, quick status chips, host chip, counts, pane buttons and the layout toggle. */
export function Toolbar({
    filters,
    onChange,
    visible,
    total,
    layout,
    onLayout,
    pane,
    onPane,
    rules,
    paused,
    selection,
    onClearSelection
}: {
    filters: Filters
    onChange(next: Filters): void
    visible: number
    total: number
    layout: Layout
    onLayout(layout: Layout): void
    pane: Pane
    onPane(pane: Pane): void
    /** Enabled rule count, shown on the rules button. */
    rules: number
    /** Transactions held at breakpoints. */
    paused: number
    selection: string[]
    onClearSelection(): void
}) {
    const [help, setHelp] = useState(false)
    const input = useRef<HTMLInputElement>(null)
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
                input.current?.focus()
                input.current?.select()
                event.preventDefault()
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])
    return (
        <div className="toolbar" role="toolbar">
            <label className="filter">
                <span className="codicon codicon-filter" aria-hidden="true" />
                <input
                    ref={input}
                    type="text"
                    spellCheck={false}
                    placeholder={t('filterPlaceholder')}
                    value={filters.text}
                    onChange={(e) => onChange({ ...filters, text: e.target.value })}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            onChange({ ...filters, text: '' })
                            e.currentTarget.blur()
                        }
                    }}
                />
                {filters.text && (
                    <IconButton
                        icon="close"
                        title={t('clearFilters')}
                        onClick={() => onChange({ ...filters, text: '' })}
                    />
                )}
                <IconButton
                    icon="question"
                    title={t('filterHelp')}
                    active={help}
                    onClick={() => setHelp(!help)}
                />
                {help && (
                    <div className="filter-help" onMouseDown={(e) => e.preventDefault()}>
                        <p className="muted">{t('filterHelpText')}</p>
                        <div className="examples">
                            {syntax.map((example) => (
                                <button
                                    key={example}
                                    type="button"
                                    className="mono chip"
                                    onClick={() =>
                                        onChange({
                                            ...filters,
                                            text: `${filters.text.trim()} ${example}`.trim()
                                        })
                                    }
                                >
                                    {example}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </label>
            <div className="chips" role="radiogroup">
                {quickFilters.map((quick) => (
                    <button
                        key={quick}
                        type="button"
                        role="radio"
                        aria-checked={filters.quick === quick}
                        className={`chip ${quick} ${filters.quick === quick ? 'active' : ''}`}
                        onClick={() => onChange({ ...filters, quick })}
                    >
                        {quick === 'all'
                            ? t('all')
                            : quick === 'pending'
                              ? t('pendingShort')
                              : quick === 'error'
                                ? t('errors')
                                : quick}
                    </button>
                ))}
            </div>
            {filters.host && (
                <span className="chip host active">
                    <span className="codicon codicon-globe" aria-hidden="true" />
                    {filters.host}
                    <IconButton
                        icon="close"
                        title={t('clearFilters')}
                        onClick={() => onChange({ ...filters, host: undefined })}
                    />
                </span>
            )}
            <IconButton
                icon={filters.hideTunnels ? 'eye-closed' : 'eye'}
                title={t('hideTunnels')}
                active={filters.hideTunnels}
                onClick={() => onChange({ ...filters, hideTunnels: !filters.hideTunnels })}
            />
            <span className="count muted">
                {isFiltered(filters) ? t('rowsCount', visible, total) : total}
            </span>
            {selection.length > 1 && (
                <span className="chip active selection">
                    {t('selectedCount', selection.length)}
                    {selection.length === 2 && (
                        <IconButton
                            icon="diff"
                            title={t('compare')}
                            onClick={() => vscode.postMessage({ type: 'compare', ids: selection })}
                        />
                    )}
                    <IconButton
                        icon="terminal"
                        title={t('copyCurl')}
                        onClick={() => vscode.postMessage({ type: 'copyCurl', ids: selection })}
                    />
                    <IconButton
                        icon="export"
                        title={t('exportHar')}
                        onClick={() => vscode.postMessage({ type: 'exportHar', ids: selection })}
                    />
                    <IconButton
                        icon="trash"
                        title={t('delete')}
                        onClick={() => vscode.postMessage({ type: 'delete', ids: selection })}
                    />
                    <IconButton
                        icon="close"
                        title={t('clearSelection')}
                        onClick={onClearSelection}
                    />
                </span>
            )}
            {paused > 0 && (
                <button
                    type="button"
                    className="chip paused active"
                    title={t('showPaused')}
                    onClick={() => onChange({ ...filters, text: 'status:paused' })}
                >
                    <span className="codicon codicon-debug-pause" aria-hidden="true" />
                    {t('pausedCount', paused)}
                </button>
            )}
            <span className="spacer" />
            <IconButton
                icon="send"
                title={t('composer')}
                active={pane === 'composer'}
                onClick={() => onPane('composer')}
            />
            <IconButton
                icon="symbol-ruler"
                title={t('rules')}
                label={rules ? String(rules) : undefined}
                active={pane === 'rules'}
                onClick={() => onPane('rules')}
            />
            <IconButton
                icon="graph"
                title={t('stats')}
                active={pane === 'stats'}
                onClick={() => onPane('stats')}
            />
            <IconButton
                icon="settings-gear"
                title={t('settings')}
                onClick={() => vscode.postMessage({ type: 'openSettings' })}
            />
            <span className="toolbar-sep" />
            <IconButton
                icon="layout-panel"
                title={t('layoutStacked')}
                active={layout === 'stacked'}
                onClick={() => onLayout('stacked')}
            />
            <IconButton
                icon="layout-sidebar-right"
                title={t('layoutSide')}
                active={layout === 'side'}
                onClick={() => onLayout('side')}
            />
        </div>
    )
}
