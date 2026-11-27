import type { Pair } from '../lib/http'
import { t } from '../lib/i18n'
import { vscode } from '../lib/vscode'
import { IconButton } from './IconButton'

/**
 * Name/value rows (headers, query, cookies, form fields). Text in the table can be
 * selected and copied natively, and each row has a copy button for the single
 * `name: value` line.
 */
export function PairsTable({
    pairs,
    empty = '—',
    highlight
}: {
    pairs: Pair[]
    empty?: string
    /** Category labels for parameter names worth flagging. */
    highlight?: (name: string) => string | undefined
}) {
    if (!pairs.length) return <p className="muted">{empty}</p>
    return (
        <table className="pairs" data-clipboard="">
            <tbody>
                {pairs.map((p, i) => {
                    const flagged = highlight?.(p.name)
                    return (
                        <tr key={`${p.name}-${i}`}>
                            <th
                                className={flagged ? 'param-hit' : undefined}
                                title={flagged ? `${t('suspiciousParams')}: ${flagged}` : undefined}
                            >
                                {p.name}
                            </th>
                            <td>{p.value}</td>
                            <td className="row-copy">
                                <IconButton
                                    icon="copy"
                                    title={t('copy')}
                                    onClick={() =>
                                        vscode.postMessage({
                                            type: 'copy',
                                            text: `${p.name}: ${p.value}`
                                        })
                                    }
                                />
                            </td>
                        </tr>
                    )
                })}
            </tbody>
        </table>
    )
}
