import { bytes, duration, type Transaction } from '../../shared/model'
import { t } from '../lib/i18n'

export function Overview({ x }: { x: Transaction }) {
    const rows: [string, string][] = [
        [t('url'), x.url],
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
    if (x.error) rows.push([t('error'), x.error])
    if (x.replayOf) rows.push(['↻', t('replayOf')])
    const timings = x.timings
        ? Object.entries(x.timings).filter(([, v]) => typeof v === 'number' && v >= 0)
        : []
    const total = timings.reduce((n, [, v]) => n + (v as number), 0) || 1
    return (
        <section>
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
                                className="phase"
                                style={{
                                    width: `${Math.max(2, ((value as number) / total) * 100)}%`
                                }}
                                title={`${name}: ${duration(value as number)}`}
                            >
                                <span>{name}</span>
                            </div>
                        ))}
                    </div>
                    <table className="kv">
                        <tbody>
                            {timings.map(([name, value]) => (
                                <tr key={name}>
                                    <th>{name}</th>
                                    <td>{duration(value as number)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}
        </section>
    )
}
