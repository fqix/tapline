import type { Pair } from '../lib/http'
import { t } from '../lib/i18n'
import { vscode } from '../lib/vscode'
import { IconButton } from './IconButton'

/**
 * Name/value rows (headers, query, cookies, form fields). Text in the table can be
 * selected and copied natively, and each row has a copy button for the single
 * `name: value` line.
 */
export function PairsTable({ pairs, empty = '—' }: { pairs: Pair[]; empty?: string }) {
    if (!pairs.length) return <p className="muted">{empty}</p>
    return (
        <table className="pairs" data-clipboard="">
            <tbody>
                {pairs.map((p, i) => (
                    <tr key={`${p.name}-${i}`}>
                        <th>{p.name}</th>
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
                ))}
            </tbody>
        </table>
    )
}
