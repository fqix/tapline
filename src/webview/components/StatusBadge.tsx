import type { Transaction } from '../../shared/model'

export function StatusBadge({ x }: { x: Pick<Transaction, 'status' | 'state'> }) {
    const label = x.state === 'pending' ? '…' : x.state === 'error' && !x.status ? 'ERR' : x.status
    return (
        <span className={`badge status s${Math.floor((x.status ?? 0) / 100)} ${x.state}`}>
            {label}
        </span>
    )
}
