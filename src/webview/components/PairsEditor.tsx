import { useId } from 'react'
import type { Pair } from '../lib/http'
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
    mono = true
}: {
    pairs: Pair[]
    onChange(pairs: Pair[]): void
    suggestions?: string[]
    namePlaceholder?: string
    valuePlaceholder?: string
    mono?: boolean
}) {
    const listId = useId()
    const rows: Pair[] = [...pairs, { name: '', value: '' }]
    const update = (index: number, patch: Partial<Pair>) => {
        const next = rows.map((p, i) => (i === index ? { ...p, ...patch } : p))
        // Drop the sentinel unless it now holds text; keep interior blanks while editing.
        const last = next[next.length - 1]
        if (!last.name && !last.value) next.pop()
        onChange(next)
    }
    const remove = (index: number) => onChange(pairs.filter((_, i) => i !== index))
    const font = mono ? 'mono' : ''
    return (
        <div className="pairs-editor" role="table">
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
                        className={`pairs-row ${sentinel ? 'sentinel' : ''}`}
                        role="row"
                    >
                        <input
                            className={font}
                            type="text"
                            spellCheck={false}
                            list={suggestions ? listId : undefined}
                            placeholder={namePlaceholder ?? t('name')}
                            value={pair.name}
                            onChange={(e) => update(index, { name: e.target.value })}
                        />
                        <input
                            className={font}
                            type="text"
                            spellCheck={false}
                            placeholder={valuePlaceholder ?? t('value')}
                            value={pair.value}
                            onChange={(e) => update(index, { value: e.target.value })}
                        />
                        <span className="pairs-remove">
                            {!sentinel && (
                                <IconButton
                                    icon="close"
                                    title={t('remove')}
                                    tabIndex={-1}
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
