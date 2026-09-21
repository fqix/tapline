import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { bytes, pretty, type Transaction } from '../../shared/model'
import {
    bodyBytes,
    contentType,
    findAll,
    hexDump,
    imageType,
    isJSON,
    isMarkup,
    prettyMarkup
} from '../lib/http'
import { t } from '../lib/i18n'
import { tokenize } from '../lib/jsonHighlight'
import { saveState, state, vscode } from '../lib/vscode'
import { GrpcMessages } from './GrpcMessages'
import { IconButton } from './IconButton'
import { JsonBody } from './JsonBody'
import { Section } from './Section'

type View = 'messages' | 'pretty' | 'image' | 'text' | 'hex'

/** Highlighting a multi-megabyte body would freeze the panel; above this it is plain text. */
const HIGHLIGHT_LIMIT = 256 * 1024

const views = state().bodyView ?? {}

function toBase64(text: string) {
    const bytes = new TextEncoder().encode(text)
    let latin1 = ''
    for (let i = 0; i < bytes.length; i += 8192)
        latin1 += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return btoa(latin1)
}

/** Text with every occurrence of `needle` wrapped in a mark; the current one is `.current`. */
function marked(text: string, hits: number[], needle: string, current: number): ReactNode[] {
    const out: ReactNode[] = []
    let last = 0
    hits.forEach((at, i) => {
        out.push(text.slice(last, at))
        out.push(
            <mark key={at} className={i === current ? 'current' : ''} data-hit={i}>
                {text.slice(at, at + needle.length)}
            </mark>
        )
        last = at + needle.length
    })
    out.push(text.slice(last))
    return out
}

/** Body section with a Pretty / Text / Hex / Image switch, find, copy and open-in-editor. */
export function BodyView({ x, side }: { x: Transaction; side: 'request' | 'response' }) {
    const headers = side === 'request' ? x.requestHeaders : x.responseHeaders
    const body = side === 'request' ? x.requestBody : x.responseBody
    const binary = side === 'request' ? x.requestBinary : x.responseBinary
    const size = side === 'request' ? x.requestBytes : x.responseBytes
    const json = !binary && !!body && isJSON(headers, body)
    const markup = !binary && !!body && !json && isMarkup(headers, body)
    const image = body ? imageType(headers) : undefined
    const grpc = x.grpc && x.grpc[side].length ? x.grpc : undefined
    const available: View[] = [
        ...(grpc ? (['messages'] as View[]) : []),
        ...(json || markup ? (['pretty'] as View[]) : []),
        ...(image ? (['image'] as View[]) : []),
        ...(binary ? [] : (['text'] as View[])),
        'hex'
    ]
    const [view, setView] = useState<View>(() => (views[side] as View) ?? 'messages')
    const active = available.includes(view) ? view : available[0]
    const choose = (next: View) => {
        views[side] = next
        setView(next)
        saveState({ bodyView: { ...views } })
    }
    const [finding, setFinding] = useState(false)
    const [needle, setNeedle] = useState('')
    const [current, setCurrent] = useState(0)
    const input = useRef<HTMLInputElement>(null)
    const text = useMemo(
        () =>
            active === 'messages'
                ? JSON.stringify(
                      grpc![side].map((m) => m.body ?? null),
                      null,
                      2
                  )
                : active === 'pretty'
                  ? json
                      ? pretty(body)
                      : prettyMarkup(body)
                  : active === 'hex'
                    ? hexDump(bodyBytes(body, binary))
                    : body,
        [active, body, binary, grpc, json, side]
    )
    const hits = useMemo(() => (finding ? findAll(text, needle) : []), [finding, text, needle])
    const tokens = useMemo(
        () =>
            active === 'pretty' && json && !hits.length && text.length <= HIGHLIGHT_LIMIT
                ? tokenize(text)
                : undefined,
        [active, json, text, hits.length]
    )
    useEffect(() => {
        if (finding) input.current?.focus()
    }, [finding])
    useEffect(() => {
        setCurrent(0)
    }, [needle, text])
    useEffect(() => {
        document.querySelector(`mark[data-hit="${current}"]`)?.scrollIntoView({ block: 'center' })
    }, [current, hits])
    const step = (delta: number) =>
        hits.length && setCurrent((c) => (c + delta + hits.length) % hits.length)
    const folding = active === 'pretty' && json && !finding && text.length <= HIGHLIGHT_LIMIT
    if (!size && !body)
        return (
            <Section id={`${side}-body`} title={t('body')} count={bytes(0)}>
                <p className="muted">{t('noBody')}</p>
            </Section>
        )
    const encoding = side === 'response' ? x.responseEncoding : undefined
    return (
        <Section
            id={`${side}-body`}
            title={t('body')}
            count={encoding ? `${bytes(size)} · ${encoding}` : bytes(size)}
            actions={
                <>
                    {available.length > 1 && (
                        <span className="segmented" role="radiogroup">
                            {available.map((name) => (
                                <button
                                    key={name}
                                    type="button"
                                    role="radio"
                                    aria-checked={active === name}
                                    className={active === name ? 'active' : ''}
                                    onClick={() => choose(name)}
                                >
                                    {t(name)}
                                </button>
                            ))}
                        </span>
                    )}
                    {active !== 'image' && active !== 'messages' && (
                        <IconButton
                            icon="search"
                            title={t('find')}
                            active={finding}
                            onClick={() => setFinding(!finding)}
                        />
                    )}
                    <IconButton
                        icon="copy"
                        title={t('copy')}
                        onClick={() => vscode.postMessage({ type: 'copy', text })}
                    />
                    {!binary && (
                        <IconButton
                            icon="go-to-file"
                            title={t('openEditor')}
                            onClick={() => vscode.postMessage({ type: 'openBody', id: x.id, side })}
                        />
                    )}
                </>
            }
        >
            {x.truncated && <p className="note">{t('truncated')}</p>}
            {finding && active !== 'image' && active !== 'messages' && (
                <div className="find">
                    <span className="codicon codicon-search" aria-hidden="true" />
                    <input
                        ref={input}
                        type="text"
                        spellCheck={false}
                        placeholder={t('findPlaceholder')}
                        value={needle}
                        onChange={(e) => setNeedle(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') step(e.shiftKey ? -1 : 1)
                            else if (e.key === 'Escape') setFinding(false)
                        }}
                    />
                    <span className="muted count">
                        {needle ? (hits.length ? `${current + 1}/${hits.length}` : '0') : ''}
                    </span>
                    <IconButton icon="chevron-up" title={t('previous')} onClick={() => step(-1)} />
                    <IconButton icon="chevron-down" title={t('next')} onClick={() => step(1)} />
                    <IconButton icon="close" title={t('close')} onClick={() => setFinding(false)} />
                </div>
            )}
            {active === 'messages' && (
                <GrpcMessages
                    key={`${x.id}:${side}`}
                    info={grpc!}
                    side={side}
                    encoding={x.grpc?.encoding}
                />
            )}
            {active === 'image' && (
                <img
                    className="body-image"
                    alt=""
                    src={`data:${contentType(headers).split(';')[0]};base64,${
                        binary ? body : toBase64(body)
                    }`}
                />
            )}
            {binary && active === 'text' && (
                <p className="muted">{t('binary', bodyBytes(body, true).length)}</p>
            )}
            {folding && <JsonBody key={`${x.id}:${side}:${text}`} text={text} />}
            {!folding && active !== 'messages' && active !== 'image' && (
                <pre className={`body ${active === 'hex' ? 'hex' : ''}`}>
                    {hits.length
                        ? marked(text, hits, needle, current)
                        : tokens
                          ? tokens.map((token, i) =>
                                token.kind === 'space' || token.kind === 'punct' ? (
                                    token.text
                                ) : (
                                    <span key={i} className={`tk-${token.kind}`}>
                                        {token.text}
                                    </span>
                                )
                            )
                          : text}
                </pre>
            )}
        </Section>
    )
}
