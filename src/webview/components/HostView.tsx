import { bytes, duration } from '../../shared/model'
import { t } from '../lib/i18n'
import { vscode } from '../lib/vscode'
import type { HostSummary } from '../types/messages'
import { StatusBadge } from './StatusBadge'

export function HostView({ summary }: { summary: HostSummary }) {
    const items = summary.transactions
    const codes = new Map<string, number>()
    for (const x of items) {
        const key = x.state === 'pending' ? '…' : x.status ? String(x.status) : 'ERR'
        codes.set(key, (codes.get(key) ?? 0) + 1)
    }
    return (
        <div className="page">
            <header className="summary">
                <span className="badge host">{t('hostTitle')}</span>
                <span className="url">{summary.host}</span>
                <span className="actions">
                    <button
                        onClick={() => vscode.postMessage({ type: 'copy', text: summary.host })}
                    >
                        {t('copy')}
                    </button>
                </span>
            </header>
            <section>
                <table className="kv">
                    <tbody>
                        <tr>
                            <th>{t('requests')}</th>
                            <td>{items.length}</td>
                        </tr>
                        <tr>
                            <th>{t('statusCodes')}</th>
                            <td>
                                {[...codes.entries()]
                                    .sort()
                                    .map(([code, n]) => `${code} × ${n}`)
                                    .join(' · ')}
                            </td>
                        </tr>
                        <tr>
                            <th>{t('totalSent')}</th>
                            <td>{bytes(items.reduce((n, x) => n + x.requestBytes, 0))}</td>
                        </tr>
                        <tr>
                            <th>{t('totalReceived')}</th>
                            <td>{bytes(items.reduce((n, x) => n + x.responseBytes, 0))}</td>
                        </tr>
                    </tbody>
                </table>
                <table className="list">
                    <thead>
                        <tr>
                            <th>{t('status')}</th>
                            <th>{t('method')}</th>
                            <th>{t('url')}</th>
                            <th>{t('duration')}</th>
                            <th>{t('sizes')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((x) => (
                            <tr
                                key={x.id}
                                onClick={() => vscode.postMessage({ type: 'open', id: x.id })}
                            >
                                <td>
                                    <span
                                        className={`badge status s${Math.floor((x.status ?? 0) / 100)} ${x.state}`}
                                    >
                                        {x.state === 'pending' ? '…' : (x.status ?? 'ERR')}
                                    </span>
                                </td>
                                <td className="mono">{x.method}</td>
                                <td className="mono path" title={x.url}>
                                    {x.path || '/'}
                                </td>
                                <td>{x.state === 'pending' ? '…' : duration(x.duration)}</td>
                                <td>{bytes(x.responseBytes)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>
        </div>
    )
}
