import type { Pair } from '../lib/http'

export function PairsTable({ pairs, empty = '—' }: { pairs: Pair[]; empty?: string }) {
    if (!pairs.length) return <p className="muted">{empty}</p>
    return (
        <table className="headers">
            <tbody>
                {pairs.map((p, i) => (
                    <tr key={`${p.name}-${i}`}>
                        <th>{p.name}</th>
                        <td>{p.value}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    )
}
