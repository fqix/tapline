import { useId, type ReactNode } from 'react'
import type { FormPair } from '../lib/form'
import { t } from '../lib/i18n'
import { IconButton } from './IconButton'

/**
 * Editable name/value rows (headers, query parameters). The trailing blank row
 * adds a pair as soon as either field is typed into; removing empties the pair.
 */
export function PairsEditor({
    pairs,
    onChange,
    suggestions,
    namePlaceholder,
    valuePlaceholder,
    mono = true,
    toggles = false,
    descriptions = false,
    headerAction
}: {
    pairs: FormPair[]
    onChange(pairs: FormPair[]): void
    suggestions?: string[]
    namePlaceholder?: string
    valuePlaceholder?: string
    mono?: boolean
    toggles?: boolean
    descriptions?: boolean
    headerAction?: ReactNode
}) {
    const listId = useId()
    const rows: FormPair[] = [...pairs, { name: '', value: '', enabled: true }]
    const update = (index: number, patch: Partial<FormPair>) => {
        const next = rows.map((p, i) => (i === index ? { ...p, ...patch } : p))
        // Drop the sentinel unless it now holds text; keep interior blanks while editing.
        const last = next[next.length - 1]
        if (!last.name && !last.value && !last.description) next.pop()
        onChange(next)
    }
    const remove = (index: number) => onChange(pairs.filter((_, i) => i !== index))
    const font = mono ? 'mono' : ''
    return (
        <div
            className={`pairs-editor ${toggles ? 'form-pairs' : ''} ${descriptions ? 'body-pairs' : ''}`}
            role="table"
            aria-label={toggles ? t('formFields') : undefined}
        >
            {toggles && (
                <div className="pairs-row pairs-heading" role="row">
                    <span />
                    <span role="columnheader">{t(descriptions ? 'key' : 'name')}</span>
                    <span role="columnheader">{t('value')}</span>
                    {descriptions && <span role="columnheader">{t('description')}</span>}
                    <span className="pairs-header-action">{headerAction}</span>
                </div>
            )}
            {suggestions && (
                <datalist id={listId}>
                    {suggestions.map((s) => (
                        <option key={s} value={s} />
                    ))}
                </datalist>
            )}
            {rows.map((pair, index) => {
                const sentinel = index === pairs.length
                return (
                    <div
                        key={index}
                        className={`pairs-row ${sentinel ? 'sentinel' : ''} ${toggles && pair.enabled === false ? 'pair-inactive' : ''}`}
                        role="row"
                    >
                        {toggles && (
                            <input
                                type="checkbox"
                                aria-label={`${t('enableField')} ${index + 1}`}
                                checked={pair.enabled !== false}
                                disabled={sentinel}
                                onChange={(e) => update(index, { enabled: e.target.checked })}
                            />
                        )}
                        <input
                            className={font}
                            type="text"
                            spellCheck={false}
                            list={suggestions ? listId : undefined}
                            placeholder={namePlaceholder ?? t(descriptions ? 'key' : 'name')}
                            aria-label={`${t(descriptions ? 'key' : 'name')} ${index + 1}`}
                            value={pair.name}
                            onChange={(e) => update(index, { name: e.target.value })}
                        />
                        <input
                            className={font}
                            type="text"
                            spellCheck={false}
                            placeholder={valuePlaceholder ?? t('value')}
                            aria-label={`${t('value')} ${index + 1}`}
                            value={pair.value}
                            onChange={(e) => update(index, { value: e.target.value })}
                        />
                        {descriptions && (
                            <input
                                type="text"
                                placeholder={t('description')}
                                aria-label={`${t('description')} ${index + 1}`}
                                value={pair.description ?? ''}
                                onChange={(e) => update(index, { description: e.target.value })}
                            />
                        )}
                        <span className="pairs-remove">
                            {!sentinel && (
                                <IconButton
                                    icon="close"
                                    title={t('remove')}
                                    tabIndex={toggles ? 0 : -1}
                                    onClick={() => remove(index)}
                                />
                            )}
                        </span>
                    </div>
                )
            })}
        </div>
    )
}
