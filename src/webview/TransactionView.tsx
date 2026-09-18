import { useState } from 'react'
import { bytes, duration, pretty, toCurl, type Headers, type Transaction } from '../shared/model'
import { t } from './strings'
import { vscode } from './vscode'

type Tab = 'overview' | 'request' | 'response' | 'frames'

export function TransactionView({ transaction: x }: { transaction: Transaction }) {
    const [tab, setTab] = useState<Tab>(() => (vscode.getState()?.tab as Tab) ?? 'overview')
    const select = (next: Tab) => {
        setTab(next)
        vscode.setState({ ...vscode.getState(), tab: next })
    }
    const isWS = x.frames.length > 0 || x.status === 101 || x.scheme.startsWith('ws')
    const tabs: Tab[] = ['overview', 'request', 'response', ...(isWS ? (['frames'] as Tab[]) : [])]
    return (
        <div className="page">
            <header className="summary">
                <span className={`badge status s${Math.floor((x.status ?? 0) / 100)} ${x.state}`}>
                    {x.state === 'pending'
                        ? '…'
                        : x.state === 'error' && !x.status
                          ? 'ERR'
                          : x.status}
                </span>
                <span className="method">{x.method}</span>
                <span className="url" title={x.url}>
                    {x.url}
                </span>
                <span className="actions">
                    <button onClick={() => vscode.postMessage({ type: 'copy', text: x.url })}>
                        {t('copy')} URL
                    </button>
                    <button onClick={() => vscode.postMessage({ type: 'copy', text: toCurl(x) })}>
                        {t('copyCurl')}
                    </button>
                    {x.scheme !== 'connect' && !isWS && !x.requestBinary && (
                        <button onClick={() => vscode.postMessage({ type: 'replay', id: x.id })}>
                            {t('replay')}
                        </button>
                    )}
                    <button onClick={() => vscode.postMessage({ type: 'openText', id: x.id })}>
                        {t('openText')}
                    </button>
                </span>
            </header>
            <nav className="tabs">
                {tabs.map((name) => (
                    <button
                        key={name}
                        className={tab === name ? 'active' : ''}
                        onClick={() => select(name)}
                    >
                        {t(name)}
                    </button>
                ))}
            </nav>
            {tab === 'overview' && <Overview x={x} />}
            {tab === 'request' && <Side x={x} side="request" />}
            {tab === 'response' && <Side x={x} side="response" />}
            {tab === 'frames' && <Frames x={x} />}
        </div>
    )
}

function Overview({ x }: { x: Transaction }) {
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

function HeadersTable({ headers, title }: { headers: Headers; title: string }) {
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

function Side({ x, side }: { x: Transaction; side: 'request' | 'response' }) {
    const [mode, setMode] = useState<'pretty' | 'raw'>('pretty')
    const headers = side === 'request' ? x.requestHeaders : x.responseHeaders
    const body = side === 'request' ? x.requestBody : x.responseBody
    const binary = side === 'request' ? x.requestBinary : x.responseBinary
    const size = side === 'request' ? x.requestBytes : x.responseBytes
    const type =
        Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
    const json = /json/i.test(type) || /^\s*[[{]/.test(body)
    const text = mode === 'pretty' && json ? pretty(body) : body
    if (side === 'response' && x.state === 'pending' && x.status === undefined)
        return <p className="muted">{t('pending')}</p>
    return (
        <section>
            {side === 'request' && (
                <p className="line mono">{`${x.method} ${x.path || '/'} HTTP/${x.httpVersion ?? '1.1'}`}</p>
            )}
            {side === 'response' && x.status !== undefined && (
                <p className="line mono">{`HTTP/${x.httpVersion ?? '1.1'} ${x.status} ${x.statusMessage ?? ''}`}</p>
            )}
            <HeadersTable headers={headers} title={t('headers')} />
            {side === 'response' &&
                x.responseTrailers &&
                Object.keys(x.responseTrailers).length > 0 && (
                    <HeadersTable headers={x.responseTrailers} title="Trailers" />
                )}
            <h3>
                {t('body')} <span className="count">{bytes(size)}</span>
                <span className="actions">
                    {json && !binary && (
                        <>
                            <button
                                className={mode === 'pretty' ? 'active' : ''}
                                onClick={() => setMode('pretty')}
                            >
                                {t('pretty')}
                            </button>
                            <button
                                className={mode === 'raw' ? 'active' : ''}
                                onClick={() => setMode('raw')}
                            >
                                {t('raw')}
                            </button>
                        </>
                    )}
                    {body && !binary && (
                        <button onClick={() => vscode.postMessage({ type: 'copy', text })}>
                            {t('copy')}
                        </button>
                    )}
                    {body && !binary && (
                        <button
                            onClick={() => vscode.postMessage({ type: 'openBody', id: x.id, side })}
                        >
                            {t('openEditor')}
                        </button>
                    )}
                </span>
            </h3>
            {x.truncated && <p className="note">{t('truncated')}</p>}
            {binary ? (
                <p className="muted">{t('binary', size)}</p>
            ) : body ? (
                <pre className="body">{text}</pre>
            ) : (
                <p className="muted">{t('noBody')}</p>
            )}
        </section>
    )
}

function Frames({ x }: { x: Transaction }) {
    return (
        <section className="frames">
            {x.frames.map((f) => (
                <div key={f.id} className={`frame ${f.direction}`}>
                    <span className="dir">{f.direction === 'send' ? '↑' : '↓'}</span>
                    <span className="time mono">
                        {new Date(f.time).toISOString().slice(11, 23)}
                    </span>
                    <pre className="mono">
                        {f.binary ? t('binary', Math.floor((f.data.length * 3) / 4)) : f.data}
                    </pre>
                </div>
            ))}
        </section>
    )
}
