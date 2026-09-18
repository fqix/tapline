import { useState } from 'react'
import { bytes, pretty, type Transaction } from '../../shared/model'
import { t } from '../lib/i18n'
import { vscode } from '../lib/vscode'
import { HeadersTable } from './HeadersTable'

export function SideView({ x, side }: { x: Transaction; side: 'request' | 'response' }) {
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
