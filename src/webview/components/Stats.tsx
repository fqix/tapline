import { useMemo } from 'react'
import { bytes, duration } from '../../shared/model'
import { t } from '../lib/i18n'
import { aggregate } from '../lib/stats'
import type { Row } from '../types/messages'
import { IconButton } from './IconButton'

/** Statistics over the rows currently shown (filters apply). */
export function Stats({
    rows,
    onSelect,
    onHost,
    onClose
}: {
    rows: Row[]
    onSelect(id: string): void
    onHost(host: string): void
    onClose(): void
}) {
    const s = useMemo(() => aggregate(rows), [rows])
    const done = s.requests - rows.filter((r) => r.state === 'pending').length
    return (
        <div className="inspector pane">
            <header className="inspector-head">
                <span className="codicon codicon-graph" aria-hidden="true" />
                <span className="title">{t('stats')}</span>
                <span className="muted">{t('statsScope', rows.length)}</span>
                <span className="actions">
                    <IconButton icon="close" title={t('close')} onClick={onClose} />
                </span>
            </header>
            <div className="inspector-body">
                <div className="overview">
                    <div className="tiles">
                        <div className="tile">
                            <span className="tile-value">{s.requests}</span>
                            <span className="muted">{t('requests')}</span>
                        </div>
                        <div className="tile">
                            <span className={`tile-value ${s.errors ? 'error-text' : ''}`}>
                                {s.errors}
                            </span>
                            <span className="muted">{t('errors')}</span>
                        </div>
                        <div className="tile">
                            <span className="tile-value">
                                {done ? duration(s.totalTime / done) : '—'}
                            </span>
                            <span className="muted">{t('average')}</span>
                        </div>
                        <div className="tile">
                            <span className="tile-value">{bytes(s.received)}</span>
                            <span className="muted">{t('received')}</span>
                        </div>
                        <div className="tile">
                            <span className="tile-value">{bytes(s.sent)}</span>
                            <span className="muted">{t('sent')}</span>
                        </div>
                    </div>
                    <h3>{t('byHost')}</h3>
                    <table className="stats">
                        <thead>
                            <tr>
                                <th>{t('col.host')}</th>
                                <th className="num">{t('requests')}</th>
                                <th className="num">{t('errors')}</th>
                                <th className="num">{t('average')}</th>
                                <th className="num">{t('max')}</th>
                                <th className="num">{t('received')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {s.hosts.map((h) => (
                                <tr key={h.host}>
                                    <td className="mono ellipsis">
                                        <button
                                            type="button"
                                            className="link"
                                            onClick={() => onHost(h.host)}
                                        >
                                            {h.host}
                                        </button>
                                    </td>
                                    <td className="num">{h.requests}</td>
                                    <td className={`num ${h.errors ? 'error-text' : ''}`}>
                                        {h.errors || ''}
                                    </td>
                                    <td className="num">
                                        {h.requests - h.pending
                                            ? duration(h.total / (h.requests - h.pending))
                                            : '—'}
                                    </td>
                                    <td className="num">{duration(h.max)}</td>
                                    <td className="num">{bytes(h.received)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <h3>{t('slowest')}</h3>
                    <TopList
                        rows={s.slowest}
                        value={(r) => duration(r.duration)}
                        onSelect={onSelect}
                    />
                    <h3>{t('largest')}</h3>
                    <TopList
                        rows={s.largest}
                        value={(r) => bytes(r.responseBytes)}
                        onSelect={onSelect}
                    />
                </div>
            </div>
        </div>
    )
}

function TopList({
    rows,
    value,
    onSelect
}: {
    rows: Row[]
    value(row: Row): string
    onSelect(id: string): void
}) {
    if (!rows.length) return <p className="muted">—</p>
    return (
        <table className="stats">
            <tbody>
                {rows.map((r) => (
                    <tr key={r.id}>
                        <td className="mono muted num seq">{r.sequence}</td>
                        <td className="mono">{r.method}</td>
                        <td className="mono ellipsis">
                            <button
                                type="button"
                                className="link ellipsis"
                                title={r.url}
                                onClick={() => onSelect(r.id)}
                            >
                                {r.host}
                                {r.path}
                            </button>
                        </td>
                        <td className="num mono">{value(r)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    )
}
