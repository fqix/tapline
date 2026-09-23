import type { ReactNode } from 'react'
import type { Headers, Transaction } from '../../shared/model'
import { bytes } from '../../shared/model'
import {
    cookies,
    findJwts,
    formFields,
    jwtClaims,
    queryParams,
    relativeTime,
    requestLine,
    statusLine,
    type Jwt,
    type Pair
} from '../lib/http'
import { t } from '../lib/i18n'
import { vscode } from '../lib/vscode'
import { BodyView } from './BodyView'
import { IconButton } from './IconButton'
import { JsonBody } from './JsonBody'
import { PairsTable } from './PairsTable'
import { Section } from './Section'

export const pairs = (h: Headers): Pair[] =>
    Object.entries(h).map(([name, value]) => ({ name, value }))

export function Pairs({
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
            <JwtSections headers={headers} side={side} />
            <BodyView x={x} side={side} />
        </div>
    )
}

/** Valid / not yet valid / expired, from the token's own time claims. */
function validity(jwt: Jwt, now: number) {
    if (jwt.expires !== undefined && jwt.expires * 1000 <= now)
        return { tone: 'bad', label: t('jwtExpired'), at: jwt.expires }
    if (jwt.notBefore !== undefined && jwt.notBefore * 1000 > now)
        return { tone: 'warn', label: t('jwtNotYetValid'), at: jwt.notBefore }
    if (jwt.expires !== undefined) return { tone: 'ok', label: t('jwtValid'), at: jwt.expires }
    return undefined
}

/** One JWT: status, its registered claims in words, then the decoded parts. */
function JwtSection({ jwt, id }: { jwt: Jwt; id: string }) {
    const now = Date.now()
    const state = validity(jwt, now)
    const claims = jwtClaims(jwt.payload, {
        iss: t('jwtIssuer'),
        sub: t('jwtSubject'),
        aud: t('jwtAudience'),
        iat: t('jwtIssued'),
        nbf: t('jwtNotBefore'),
        exp: t('jwtExpires')
    })
    return (
        <Section
            id={id}
            title="JWT"
            count={jwt.source}
            actions={
                <>
                    <IconButton
                        icon="copy"
                        title={t('jwtCopyToken')}
                        onClick={() => vscode.postMessage({ type: 'copy', text: jwt.token })}
                    />
                    <IconButton
                        icon="json"
                        title={t('jwtCopyDecoded')}
                        onClick={() =>
                            vscode.postMessage({
                                type: 'copy',
                                text: JSON.stringify(
                                    { header: jwt.header, payload: jwt.payload },
                                    null,
                                    2
                                )
                            })
                        }
                    />
                </>
            }
        >
            {state && (
                <p className={`jwt-state ${state.tone}`}>
                    <span
                        className={`codicon codicon-${state.tone === 'ok' ? 'pass' : 'warning'}`}
                        aria-hidden="true"
                    />
                    {state.label}
                    <span className="muted">{relativeTime(state.at, now)}</span>
                </p>
            )}
            {claims.length > 0 && (
                <table className="kv jwt-claims">
                    <tbody>
                        {claims.map((claim) => (
                            <tr key={claim.name}>
                                <th>
                                    {claim.label} <span className="muted mono">{claim.name}</span>
                                </th>
                                <td>{claim.value}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            <h4 className="jwt-part">{t('jwtHeader')}</h4>
            <JsonBody text={JSON.stringify(jwt.header)} />
            <h4 className="jwt-part">{t('jwtPayload')}</h4>
            <JsonBody text={JSON.stringify(jwt.payload)} />
            <p className="muted jwt-note">{t('jwtUnverified')}</p>
        </Section>
    )
}

/** One section per JSON Web Token found in the headers, with the decoded parts. */
export function JwtSections({ headers, side }: { headers: Headers; side: 'request' | 'response' }) {
    return (
        <>
            {findJwts(headers).map((jwt, i) => (
                // Each token collapses on its own, so the id has to be unique per token.
                <JwtSection
                    key={`${jwt.source}-${i}`}
                    jwt={jwt}
                    id={`${side}-jwt-${jwt.source}-${i}`}
                />
            ))}
        </>
    )
}

/** Why a side has nothing to show yet (tunnel, pending, failed), or undefined. */
export function messageNote(x: Transaction, side: 'request' | 'response'): ReactNode {
    if (x.scheme === 'connect') return <p className="note">{t('tunnel')}</p>
    if (side === 'response' && x.state === 'pending' && x.status === undefined)
        return <p className="muted padded">{t('pending')}</p>
    if (side === 'response' && x.state === 'error' && x.status === undefined)
        return <p className="note error">{x.error}</p>
    return undefined
}
