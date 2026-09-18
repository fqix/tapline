import type { Headers, Transaction } from '../../shared/model'
import { bytes } from '../../shared/model'
import { cookies, formFields, queryParams, requestLine, statusLine, type Pair } from '../lib/http'
import { t } from '../lib/i18n'
import { vscode } from '../lib/vscode'
import { BodyView } from './BodyView'
import { IconButton } from './IconButton'
import { PairsTable } from './PairsTable'
import { Section } from './Section'

const pairs = (h: Headers): Pair[] => Object.entries(h).map(([name, value]) => ({ name, value }))

function Pairs({
    id,
    title,
    items,
    copyable
}: {
    id: string
    title: string
    items: Pair[]
    copyable?: string
}) {
    if (!items.length) return null
    return (
        <Section
            id={id}
            title={title}
            count={items.length}
            actions={
                copyable !== undefined && (
                    <IconButton
                        icon="copy"
                        title={t('copy')}
                        onClick={() => vscode.postMessage({ type: 'copy', text: copyable })}
                    />
                )
            }
        >
            <PairsTable pairs={items} />
        </Section>
    )
}

/** Request or Response tab: one scrolling page of collapsible sections. */
export function MessageView({ x, side }: { x: Transaction; side: 'request' | 'response' }) {
    if (x.scheme === 'connect') return <p className="note">{t('tunnel')}</p>
    const headers = side === 'request' ? x.requestHeaders : x.responseHeaders
    const pending = side === 'response' && x.state === 'pending' && x.status === undefined
    if (pending) return <p className="muted padded">{t('pending')}</p>
    if (side === 'response' && x.state === 'error' && x.status === undefined)
        return <p className="note error">{x.error}</p>
    const raw = Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')
    return (
        <div className="message">
            <div className="first-line mono">
                <span className="ellipsis" title={side === 'request' ? x.url : undefined}>
                    {side === 'request' ? requestLine(x) : statusLine(x)}
                </span>
                <span className="muted">
                    {bytes(side === 'request' ? x.requestBytes : x.responseBytes)}
                </span>
            </div>
            <Pairs
                id={`${side}-headers`}
                title={t('headers')}
                items={pairs(headers)}
                copyable={raw}
            />
            {side === 'request' && (
                <Pairs id="request-query" title={t('query')} items={queryParams(x)} />
            )}
            <Pairs
                id={`${side}-cookies`}
                title={side === 'request' ? t('cookies') : t('setCookies')}
                items={cookies(headers, side)}
            />
            {side === 'request' && (
                <Pairs
                    id="request-form"
                    title={t('form')}
                    items={formFields(headers, x.requestBody, x.requestBinary)}
                />
            )}
            {side === 'response' && x.responseTrailers && (
                <Pairs
                    id="response-trailers"
                    title={t('trailers')}
                    items={pairs(x.responseTrailers)}
                />
            )}
            <BodyView x={x} side={side} />
        </div>
    )
}
