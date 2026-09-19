import { grpcStatusName, type Transaction } from '../../shared/model'

type Subject = Pick<Transaction, 'status' | 'state' | 'paused'> & { grpcStatus?: number }

const tone = (x: Subject) =>
    x.paused
        ? 'paused'
        : x.state === 'pending'
          ? 'pending'
          : x.state === 'error' && !x.status
            ? 'error'
            : x.grpcStatus !== undefined
              ? x.grpcStatus === 0
                  ? 's2'
                  : 'error'
              : `s${Math.floor((x.status ?? 0) / 100)}`

/**
 * Coloured dot plus status code; a spinner while the response is outstanding. For
 * gRPC the dot follows `grpc-status` (HTTP is always 200) and the tooltip names it.
 */
export function StatusBadge({ x }: { x: Subject }) {
    const label = x.paused
        ? (x.status ?? '')
        : x.state === 'pending'
          ? ''
          : x.state === 'error' && !x.status
            ? 'ERR'
            : x.status
    const title =
        x.grpcStatus !== undefined
            ? `gRPC ${x.grpcStatus} ${grpcStatusName(x.grpcStatus)}`
            : x.paused
              ? 'Paused at a breakpoint'
              : undefined
    return (
        <span className={`status ${tone(x)}`} title={title}>
            <span
                className={`codicon codicon-${x.paused ? 'debug-pause' : x.state === 'pending' ? 'loading codicon-modifier-spin' : 'circle-filled'}`}
                aria-hidden="true"
            />
            <span className="mono">{label}</span>
        </span>
    )
}

export function methodClass(method: string) {
    return `method m-${method.toLowerCase()}`
}

/** gRPC calls are always POST; the method column is more useful saying gRPC. */
export function methodLabel(x: { method: string; grpc?: boolean }) {
    return x.grpc ? 'gRPC' : x.method
}
