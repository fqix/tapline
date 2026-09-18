import { useEffect, useRef } from 'react'
import { isFiltered, quickFilters, type Filters } from '../lib/filter'
import { t } from '../lib/i18n'
import type { Layout } from '../types/messages'
import { IconButton } from './IconButton'

/** Filter input, quick status chips, host chip, counts and the layout toggle. */
export function Toolbar({
    filters,
    onChange,
    visible,
    total,
    layout,
    onLayout
}: {
    filters: Filters
    onChange(next: Filters): void
    visible: number
    total: number
    layout: Layout
    onLayout(layout: Layout): void
}) {
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
            <span className="spacer" />
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
