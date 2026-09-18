import { bytes, duration, grpcStatusName, type Transaction } from '../../shared/model'
import { t } from '../lib/i18n'
import type { Row } from '../types/messages'

const phases = ['dns', 'connect', 'tls', 'send', 'wait', 'receive'] as const

export function Overview({ x, onFocus }: { x: Transaction; onFocus(id: string): void }) {
    const rows: [string, React.ReactNode][] = [
        [t('url'), <span className="mono selectable">{x.url}</span>],
        [t('method'), x.method],
        [
            t('status'),
            x.status
                ? `${x.status} ${x.statusMessage ?? ''}`
                : x.state === 'pending'
                  ? t('pending')
                  : '—'
        ],
        [
            t('protocol'),
            `${x.scheme}${x.httpVersion ? ` · HTTP/${x.httpVersion}` : ''}${x.tls ? ' · TLS' : ''}`
        ],
        [t('client'), x.client],
        [t('time'), new Date(x.timestamp).toLocaleString()],
        [t('duration'), x.state === 'pending' ? '…' : duration(x.duration)],
        [
            t('sizes'),
            `${bytes(x.requestBytes)} ${t('sent')} · ${bytes(x.responseBytes)} ${t('received')}`
        ]
    ]
    if (x.grpc)
        rows.splice(4, 0, [
            'gRPC',
            <>
                <span className="mono">
                    {x.grpc.service}/{x.grpc.method}
                </span>
                {x.grpc.status !== undefined && (
                    <>
                        {' · '}
                        <span className={x.grpc.status ? 'error-text' : ''}>
                            {x.grpc.status} {grpcStatusName(x.grpc.status)}
                            {x.grpc.statusMessage ? `: ${x.grpc.statusMessage}` : ''}
                        </span>
                    </>
                )}
                {x.grpc.encoding ? ` · ${x.grpc.encoding}` : ''}
                {x.grpc.web ? ' · gRPC-Web' : ''}
            </>
        ])
    if (x.error) rows.push([t('error'), <span className="error-text">{x.error}</span>])
    if (x.replayOf)
        rows.push([
            t('replayOf'),
            <button type="button" className="link" onClick={() => onFocus(x.replayOf!)}>
                {t('showOriginal')}
            </button>
        ])
    const timings = phases
        .map((name) => [name, x.timings?.[name]] as const)
        .filter(
            (entry): entry is readonly [(typeof phases)[number], number] =>
                typeof entry[1] === 'number' && entry[1] >= 0
        )
    const total = timings.reduce((n, [, v]) => n + v, 0) || 1
    return (
        <div className="overview">
            {x.scheme === 'connect' && <p className="note">{t('tunnel')}</p>}
            <table className="kv">
                <tbody>
                    {rows.map(([k, v]) => (
                        <tr key={k}>
                            <th>{k}</th>
                            <td>{v}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {timings.length > 0 && (
                <>
                    <h3>{t('timing')}</h3>
                    <div className="waterfall">
                        {timings.map(([name, value]) => (
                            <div
                                key={name}
                                className={`phase ${name}`}
                                style={{ width: `${Math.max(1.5, (value / total) * 100)}%` }}
                                title={`${name}: ${duration(value)}`}
                            />
                        ))}
                    </div>
                    <ul className="legend">
                        {timings.map(([name, value]) => (
                            <li key={name}>
                                <span className={`swatch ${name}`} />
                                <span className="muted">{name}</span>
                                <span className="num mono">{duration(value)}</span>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </div>
    )
}

function tally<T>(items: T[], key: (item: T) => string) {
    const counts = new Map<string, number>()
    for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

const list = (entries: [string, number][]) =>
    entries.map(([k, n]) => `${k} × ${n}`).join(' · ') || '—'

/** Host summary aggregated from table rows; shown while a host filter has no selection. */
export function HostOverview({ host, rows }: { host: string; rows: Row[] }) {
    const done = rows.filter((x) => x.state !== 'pending')
    const total = done.reduce((n, x) => n + x.duration, 0)
    const items: [string, string][] = [
        [
            t('requests'),
            `${rows.length}${rows.length !== done.length ? ` (${rows.length - done.length} ${t('pendingShort')})` : ''}`
        ],
        [
            t('statusCodes'),
            list(
                tally(rows, (x) =>
                    x.state === 'pending' ? '…' : x.status ? String(x.status) : 'ERR'
                )
            )
        ],
        [
            t('contentTypes'),
            list(
                tally(
                    done.filter((x) => x.scheme !== 'connect'),
                    (x) => x.contentType || '—'
                )
            )
        ],
        [
            t('protocols'),
            list(tally(rows, (x) => `${x.scheme}${x.httpVersion ? ' HTTP/' + x.httpVersion : ''}`))
        ],
        [
            t('durationSummary'),
            done.length
                ? `${duration(total)} ${t('total')} · ${duration(total / done.length)} ${t('average')} · ${duration(Math.max(...done.map((x) => x.duration)))} ${t('max')}`
                : '—'
        ],
        [t('totalSent'), bytes(rows.reduce((n, x) => n + x.requestBytes, 0))],
        [t('totalReceived'), bytes(rows.reduce((n, x) => n + x.responseBytes, 0))]
    ]
    return (
        <div className="inspector">
            <header className="inspector-head">
                <span className="codicon codicon-globe" aria-hidden="true" />
                <span className="title ellipsis mono" title={host}>
                    {host}
                </span>
                <span className="muted">{t('hostTitle')}</span>
            </header>
            <div className="inspector-body">
                <div className="overview">
                    <table className="kv">
                        <tbody>
                            {items.map(([k, v]) => (
                                <tr key={k}>
                                    <th>{k}</th>
                                    <td>{v}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
