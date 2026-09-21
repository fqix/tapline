import { useMemo, useState } from 'react'
import { t } from '../lib/i18n'
import { jsonTree } from '../lib/jsonTree'

/** Charles-style field/value tree with flat rendering for deeply nested JSON. */
export function JsonBody({ text }: { text: string }) {
    const rows = useMemo(() => jsonTree(text), [text])
    const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set())
    const toggle = (index: number) =>
        setCollapsed((previous) => {
            const next = new Set(previous)
            if (next.has(index)) next.delete(index)
            else next.add(index)
            return next
        })
    if (!rows) return <pre className="body">{text}</pre>
    const visible = []
    for (let index = 0; index < rows.length; index++) {
        const row = rows[index]
        const key = index
        const branch = row.count > 0
        const folded = branch && collapsed.has(key)
        visible.push(
            <tr
                key={key}
                role="row"
                aria-level={row.depth + 1}
                aria-expanded={branch ? !folded : undefined}
            >
                <td role="gridcell" className="json-name">
                    <div className="json-field" style={{ paddingLeft: row.depth * 16 + 6 }}>
                        {branch ? (
                            <button
                                type="button"
                                className="json-fold"
                                aria-label={`${t(folded ? 'expand' : 'collapse')} ${row.name}`}
                                aria-expanded={!folded}
                                onClick={() => toggle(key)}
                            >
                                <span
                                    className={`codicon codicon-chevron-${folded ? 'right' : 'down'}`}
                                    aria-hidden="true"
                                />
                            </button>
                        ) : (
                            <span className="json-fold-space" />
                        )}
                        <span className="json-field-name">{row.name}</span>
                    </div>
                </td>
                <td role="gridcell" className={`json-value tk-${row.kind}`}>
                    {row.kind === 'object'
                        ? t('jsonObject', row.count)
                        : row.kind === 'array'
                          ? t('jsonArray', row.count)
                          : row.kind === 'string' && !row.value
                            ? '""'
                            : row.value}
                </td>
            </tr>
        )
        if (folded) index = row.end
    }
    return (
        <div className="json-body">
            {rows.some((row) => row.count > 0) && (
                <div className="json-fold-actions">
                    <button type="button" className="link" onClick={() => setCollapsed(new Set())}>
                        {t('expandAll')}
                    </button>
                    <button
                        type="button"
                        className="link"
                        onClick={() =>
                            setCollapsed(new Set(rows.flatMap((row, i) => (row.count ? [i] : []))))
                        }
                    >
                        {t('collapseAll')}
                    </button>
                </div>
            )}
            <div className="json-tree-scroll">
                <table className="json-tree" role="treegrid" aria-label={t('pretty')}>
                    <thead>
                        <tr>
                            <th scope="col">{t('jsonField')}</th>
                            <th scope="col">{t('jsonValue')}</th>
                        </tr>
                    </thead>
                    <tbody>{visible}</tbody>
                </table>
            </div>
        </div>
    )
}
