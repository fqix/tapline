import type { Headers } from '../../shared/model'

export function HeadersTable({ headers, title }: { headers: Headers; title: string }) {
    const entries = Object.entries(headers)
    return (
        <>
            <h3>
                {title} <span className="count">{entries.length}</span>
            </h3>
            {entries.length === 0 ? (
                <p className="muted">—</p>
            ) : (
                <table className="headers">
                    <tbody>
                        {entries.map(([name, value]) => (
                            <tr key={name}>
                                <th>{name}</th>
                                <td>{value}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </>
    )
}
