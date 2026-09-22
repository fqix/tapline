import { useState } from 'react'
import type { Transaction } from '../../shared/model'
import { bytes, formatHttpVersion } from '../../shared/model'
import { cookies, formFields, queryParams } from '../lib/http'
import { t } from '../lib/i18n'
import { saveState, state } from '../lib/vscode'
import { BodyView } from './BodyView'
import { Frames, ServerEvents } from './Frames'
import { JwtSections, messageNote, pairs, Pairs } from './MessageView'
import { Overview } from './Overview'
import { RawView } from './RawView'
import { methodClass, methodLabel, StatusBadge } from './StatusBadge'

type RequestTab = 'overview' | 'raw' | 'params' | 'headers' | 'body'
type ResponseTab = 'raw' | 'headers' | 'body' | 'frames' | 'events'
type Tab = RequestTab | ResponseTab

/**
 * One half of the side-by-side inspector: the request or the response with its own
 * tab strip (Overview / Raw / Params / Headers / Body; the response adds Frames and
 * SSE Events when present) and a badge strip on the right.
 */
export function MessagePane({
    x,
    side,
    onFocus
}: {
    x: Transaction
    side: 'request' | 'response'
    onFocus(id: string): void
}) {
    const key = side === 'request' ? 'requestTab' : 'responseTab'
    const [tab, setTab] = useState<Tab>(
        () => (state()[key] as Tab) ?? (side === 'request' ? 'overview' : 'body')
    )
    const choose = (next: Tab) => {
        setTab(next)
        saveState({ [key]: next })
    }
    const headers = side === 'request' ? x.requestHeaders : x.responseHeaders
    const websocket = x.frames.length > 0 || x.status === 101 || x.scheme.startsWith('ws')
    const query = side === 'request' ? queryParams(x) : []
    const form = side === 'request' ? formFields(headers, x.requestBody, x.requestBinary) : []
    const tabs: Tab[] =
        side === 'request'
            ? ['overview', 'raw', 'params', 'headers', 'body']
            : [
                  'raw',
                  'headers',
                  'body',
                  ...(websocket ? (['frames'] as Tab[]) : []),
                  ...(x.events ? (['events'] as Tab[]) : [])
              ]
    const active = tabs.includes(tab) ? tab : tabs[0]
    const count = (name: Tab) =>
        name === 'params'
            ? query.length + form.length
            : name === 'headers'
              ? Object.keys(headers).length
              : name === 'frames'
                ? x.frames.length
                : name === 'events'
                  ? x.events?.length
                  : undefined
    const note = messageNote(x, side)
    return (
        <section className={`message-pane ${side}`}>
            <nav className="tabs pane-tabs" role="tablist">
                {tabs.map((name) => (
                    <button
                        key={name}
                        type="button"
                        role="tab"
                        aria-selected={active === name}
                        className={active === name ? 'active' : ''}
                        onClick={() => choose(name)}
                    >
                        {t(name)}
                        {!!count(name) && <span className="tab-count">{count(name)}</span>}
                    </button>
                ))}
                <span className="spacer" />
                {side === 'request' ? (
                    <>
                        {x.httpVersion && (
                            <span className="pane-badge mono muted">
                                {formatHttpVersion(x.httpVersion)}
                            </span>
                        )}
                        <span
                            className={`pane-badge ${methodClass(methodLabel({ method: x.method, grpc: !!x.grpc }))}`}
                        >
                            {methodLabel({ method: x.method, grpc: !!x.grpc })}
                        </span>
                    </>
                ) : (
                    <>
                        {x.httpVersion && (
                            <span className="pane-badge mono muted">
                                {formatHttpVersion(x.httpVersion)}
                            </span>
                        )}
                        <span className="pane-badge">
                            <StatusBadge x={{ ...x, grpcStatus: x.grpc?.status }} />
                        </span>
                    </>
                )}
            </nav>
            <div className="pane-body">
                {active === 'overview' && <Overview x={x} onFocus={onFocus} />}
                {active !== 'overview' && note}
                {active !== 'overview' && !note && (
                    <>
                        {active === 'raw' && <RawView key={x.id} x={x} side={side} />}
                        {active === 'params' && (
                            <div className="message">
                                <Pairs id="request-query" title={t('query')} items={query} />
                                <Pairs id="request-form" title={t('form')} items={form} />
                                <Pairs
                                    id="request-cookies"
                                    title={t('cookies')}
                                    items={cookies(headers, 'request')}
                                />
                                {!query.length && !form.length && (
                                    <p className="muted padded">{t('noParams')}</p>
                                )}
                            </div>
                        )}
                        {active === 'headers' && (
                            <div className="message">
                                <Pairs
                                    id={`${side}-headers`}
                                    title={t('headers')}
                                    items={pairs(headers)}
                                    copyable={Object.entries(headers)
                                        .map(([k, v]) => `${k}: ${v}`)
                                        .join('\n')}
                                />
                                {side === 'response' && (
                                    <Pairs
                                        id="response-cookies"
                                        title={t('setCookies')}
                                        items={cookies(headers, 'response')}
                                    />
                                )}
                                {side === 'response' && x.responseTrailers && (
                                    <Pairs
                                        id="response-trailers"
                                        title={t('trailers')}
                                        items={pairs(x.responseTrailers)}
                                    />
                                )}
                                <JwtSections headers={headers} side={side} />
                            </div>
                        )}
                        {active === 'body' && (
                            <div className="message">
                                <div className="first-line mono muted">
                                    <span className="ellipsis">
                                        {bytes(
                                            side === 'request' ? x.requestBytes : x.responseBytes
                                        )}
                                    </span>
                                </div>
                                <BodyView key={x.id} x={x} side={side} />
                            </div>
                        )}
                        {active === 'frames' && <Frames key={x.id} x={x} />}
                        {active === 'events' && <ServerEvents key={x.id} x={x} />}
                    </>
                )}
            </div>
        </section>
    )
}
