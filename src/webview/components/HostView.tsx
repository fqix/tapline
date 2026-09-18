import { useMemo, useState } from 'react'
import { bytes, duration } from '../../shared/model'
import { contentType } from '../lib/http'
import { t } from '../lib/i18n'
import { vscode } from '../lib/vscode'
import type { HostSummary } from '../types/messages'
import { StatusBadge } from './StatusBadge'

function tally<T>(items: T[], key: (item: T) => string) {
    const counts = new Map<string, number>()
    for (const item of items) {
        const k = key(item)
        counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

/** Charles-style host summary plus a filterable request list. */
export function HostView({ summary }: { summary: HostSummary }) {
    const [filter, setFilter] = useState('')
    const items = summary.transactions
    const done = items.filter((x) => x.state !== 'pending')
    const total = done.reduce((n, x) => n + x.duration, 0)
    const visible = useMemo(() => {
        const needle = filter.trim().toLowerCase()
        return needle
            ? items.filter(
                  (x) =>
                      x.path.toLowerCase().includes(needle) ||
                      x.method.toLowerCase().includes(needle) ||
                      String(x.status ?? '').startsWith(needle)
              )
            : items
    }, [items, filter])
    const rows: [string, string][] = [
        [
            t('requests'),
            `${items.length}${items.length !== done.length ? ` (${items.length - done.length} ${t('pendingShort')})` : ''}`
        ],
        [
            t('statusCodes'),
            tally(items, (x) => (x.state === 'pending' ? '…' : x.status ? String(x.status) : 'ERR'))
                .map(([code, n]) => `${code} × ${n}`)
                .join(' · ')
        ],
        [
            t('contentTypes'),
            tally(
                done.filter((x) => x.scheme !== 'connect'),
                (x) => contentType(x.responseHeaders).split(';')[0] || '—'
            )
                .map(([type, n]) => `${type} × ${n}`)
                .join(' · ') || '—'
        ],
        [
            t('protocols'),
            tally(items, (x) => `${x.scheme}${x.httpVersion ? ' HTTP/' + x.httpVersion : ''}`)
                .map(([p, n]) => `${p} × ${n}`)
                .join(' · ')
        ],
        [
            t('durationSummary'),
            done.length
                ? `${duration(total)} ${t('total')} · ${duration(total / done.length)} ${t('average')} · ${duration(Math.max(...done.map((x) => x.duration)))} ${t('max')}`
                : '—'
        ],
        [t('totalSent'), bytes(items.reduce((n, x) => n + x.requestBytes, 0))],
        [t('totalReceived'), bytes(items.reduce((n, x) => n + x.responseBytes, 0))]
    ]
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
                        {rows.map(([k, v]) => (
                            <tr key={k}>
                                <th>{k}</th>
                                <td>{v}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="toolbar">
                    <input
                        className="filter"
                        placeholder={t('filterPlaceholder')}
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                    />
                    <span className="muted">{t('rowsCount', visible.length, items.length)}</span>
                </div>
                <table className="list">
                    <thead>
                        <tr>
                            <th>{t('col.status')}</th>
                            <th>{t('col.method')}</th>
                            <th>{t('col.path')}</th>
                            <th>{t('col.timestamp')}</th>
                            <th>{t('col.duration')}</th>
                            <th>{t('col.responseBytes')}</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {visible.map((x) => (
                            <tr
                                key={x.id}
                                onClick={() => vscode.postMessage({ type: 'open', id: x.id })}
                            >
                                <td>
                                    <StatusBadge x={x} />
                                </td>
                                <td className="mono">{x.method}</td>
                                <td className="mono path" title={x.url}>
                                    {x.replayOf ? '↻ ' : ''}
                                    {x.scheme === 'connect' ? x.path : x.path || '/'}
                                </td>
                                <td className="mono">
                                    {new Date(x.timestamp).toLocaleTimeString()}
                                </td>
                                <td>{x.state === 'pending' ? '…' : duration(x.duration)}</td>
                                <td>{bytes(x.responseBytes)}</td>
                                <td className="row-actions">
                                    {x.scheme !== 'connect' && (
                                        <button
                                            title={t('replay')}
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                vscode.postMessage({ type: 'replay', id: x.id })
                                            }}
                                        >
                                            ↻
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>
        </div>
    )
}
