import { useMemo, useState } from 'react'
import { bytes, pretty, type Transaction } from '../../shared/model'
import {
    bodyBytes,
    cookies,
    formFields,
    hexDump,
    isJSON,
    queryParams,
    rawMessage,
    requestLine,
    statusLine
} from '../lib/http'
import { t } from '../lib/i18n'
import { vscode } from '../lib/vscode'
import { PairsTable } from './PairsTable'

type Sub = 'headers' | 'text' | 'json' | 'raw' | 'hex' | 'query' | 'cookies' | 'form'

/** One half of the Contents view: a request or response with Charles-style sub-tabs. */
export function MessagePane({ x, side }: { x: Transaction; side: 'request' | 'response' }) {
    const headers = side === 'request' ? x.requestHeaders : x.responseHeaders
    const body = side === 'request' ? x.requestBody : x.responseBody
    const binary = side === 'request' ? x.requestBinary : x.responseBinary
    const size = side === 'request' ? x.requestBytes : x.responseBytes
    const pending = side === 'response' && x.state === 'pending' && x.status === undefined
    const json = !binary && !!body && isJSON(headers, body)
    const query = side === 'request' ? queryParams(x) : []
    const cookieList = cookies(headers, side)
    const form = formFields(headers, body, binary)
    const tabs: Sub[] = [
        'headers',
        ...(binary ? [] : (['text'] as Sub[])),
        ...(json ? (['json'] as Sub[]) : []),
        'raw',
        'hex',
        ...(query.length ? (['query'] as Sub[]) : []),
        ...(cookieList.length ? (['cookies'] as Sub[]) : []),
        ...(form.length ? (['form'] as Sub[]) : [])
    ]
    const [sub, setSub] = useState<Sub>(json ? 'json' : 'headers')
    const active = tabs.includes(sub) ? sub : 'headers'
    const hex = useMemo(
        () => (active === 'hex' ? hexDump(bodyBytes(body, binary)) : ''),
        [active, body, binary]
    )
    const copyable =
        active === 'raw'
            ? rawMessage(x, side)
            : active === 'json'
              ? pretty(body)
              : active === 'hex'
                ? hex
                : body
    return (
        <div className="pane">
            <div className="pane-head">
                <span className="line mono">
                    {side === 'request' ? requestLine(x) : pending ? t('pending') : statusLine(x)}
                </span>
                <span className="muted">{bytes(size)}</span>
                <span className="actions">
                    <button onClick={() => vscode.postMessage({ type: 'copy', text: copyable })}>
                        {t('copy')}
                    </button>
                    {!!body && !binary && (
                        <button
                            onClick={() => vscode.postMessage({ type: 'openBody', id: x.id, side })}
                        >
                            {t('openEditor')}
                        </button>
                    )}
                </span>
            </div>
            <nav className="subtabs">
                {tabs.map((name) => (
                    <button
                        key={name}
                        className={active === name ? 'active' : ''}
                        onClick={() => setSub(name)}
                    >
                        {t(`sub.${name}`)}
                    </button>
                ))}
            </nav>
            <div className="pane-body">
                {x.truncated && active !== 'headers' && <p className="note">{t('truncated')}</p>}
                {active === 'headers' && (
                    <PairsTable
                        pairs={Object.entries(headers).map(([name, value]) => ({ name, value }))}
                    />
                )}
                {active === 'text' &&
                    (body ? (
                        <pre className="body">{body}</pre>
                    ) : (
                        <p className="muted">{t('noBody')}</p>
                    ))}
                {active === 'json' && <pre className="body">{pretty(body)}</pre>}
                {active === 'raw' && <pre className="body">{rawMessage(x, side)}</pre>}
                {active === 'hex' &&
                    (size ? (
                        <pre className="body hex">{hex}</pre>
                    ) : (
                        <p className="muted">{t('noBody')}</p>
                    ))}
                {active === 'query' && <PairsTable pairs={query} />}
                {active === 'cookies' && <PairsTable pairs={cookieList} />}
                {active === 'form' && <PairsTable pairs={form} />}
            </div>
        </div>
    )
}
