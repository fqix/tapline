import type { Transaction } from '../../shared/model'

const tone = (x: Pick<Transaction, 'status' | 'state'>) =>
    x.state === 'pending'
        ? 'pending'
        : x.state === 'error' && !x.status
          ? 'error'
          : `s${Math.floor((x.status ?? 0) / 100)}`

/** Coloured dot plus status code; a spinner while the response is outstanding. */
export function StatusBadge({ x }: { x: Pick<Transaction, 'status' | 'state'> }) {
    const label = x.state === 'pending' ? '' : x.state === 'error' && !x.status ? 'ERR' : x.status
    return (
        <span className={`status ${tone(x)}`}>
            <span
                className={`codicon codicon-${x.state === 'pending' ? 'loading codicon-modifier-spin' : 'circle-filled'}`}
                aria-hidden="true"
            />
            <span className="mono">{label}</span>
        </span>
    )
}

export function methodClass(method: string) {
    return `method m-${method.toLowerCase()}`
}
