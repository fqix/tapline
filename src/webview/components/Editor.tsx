import { useMemo, useState, type ReactNode } from 'react'
import { looksLikeCurl, parseCurl } from '../../shared/curl'
import { bytes, type Headers } from '../../shared/model'
import type { Pair } from '../lib/http'
import { t } from '../lib/i18n'
import { IconButton } from './IconButton'
import { PairsEditor } from './PairsEditor'
import { methodClass } from './StatusBadge'

/** Fields of the request/response editor used by the composer and at breakpoints. */
export interface EditorValue {
    method: string
    url: string
    status: string
    /** `Name: value` per line. */
    headers: string
    body: string
}

export const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

const headerSuggestions = [
    'Accept',
    'Accept-Encoding',
    'Accept-Language',
    'Authorization',
    'Cache-Control',
    'Content-Type',
    'Cookie',
    'If-None-Match',
    'Origin',
    'Referer',
    'User-Agent',
    'X-Request-Id'
]

export const headersToText = (headers: Headers) =>
    Object.entries(headers)
        .map(([name, value]) => `${name}: ${value}`)
        .join('\n')

export function textToHeaders(text: string): Headers {
    const headers: Headers = {}
    for (const line of text.split('\n')) {
        const at = line.indexOf(':')
        if (at <= 0) continue
        const name = line.slice(0, at).trim()
        if (name) headers[name] = line.slice(at + 1).trim()
    }
    return headers
}

/** Header lines as editable pairs; lines without a colon survive as name-only rows. */
const textToPairs = (text: string): Pair[] =>
    text
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
            const at = line.indexOf(':')
            return at > 0
                ? { name: line.slice(0, at).trim(), value: line.slice(at + 1).trim() }
                : { name: line.trim(), value: '' }
        })
const pairsToText = (pairs: Pair[]) =>
    pairs
        .map((p) => (p.value || p.name.includes(':') ? `${p.name}: ${p.value}` : p.name))
        .join('\n')

/** Fields of a curl command as editor values; the caller keeps the status field. */
export function fromCurl(text: string): { value: Omit<EditorValue, 'status'>; warnings: string[] } {
    const parsed = parseCurl(text)
    return {
        value: {
            method: parsed.method,
            url: parsed.url,
            headers: pairsToText(parsed.headers.map(([name, value]) => ({ name, value }))),
            body: parsed.body
        },
        warnings: parsed.warnings
    }
}

const parseUrl = (url: string) => {
    try {
        return new URL(url)
    } catch {
        return undefined
    }
}

const contentTypeOf = (headers: string) =>
    (
        textToHeaders(headers)['Content-Type'] ??
        Object.entries(textToHeaders(headers)).find(
            ([k]) => k.toLowerCase() === 'content-type'
        )?.[1] ??
        ''
    ).toLowerCase()

type Tab = 'params' | 'headers' | 'body'

/**
 * Request line (or status), then Params / Headers / Body tabs. `phase` decides which
 * first-line fields show; `action` (e.g. Send) sits at the end of the request line.
 */
export function Editor({
    phase,
    value,
    onChange,
    bodyDisabled,
    autoFocus,
    action,
    onCurl
}: {
    phase: 'request' | 'response'
    value: EditorValue
    onChange(next: EditorValue): void
    bodyDisabled?: boolean
    autoFocus?: boolean
    action?: ReactNode
    /** Called with a pasted curl command instead of inserting it as text. */
    onCurl?(text: string): void
}) {
    const set = (patch: Partial<EditorValue>) => onChange({ ...value, ...patch })
    const pasteCurl = (event: React.ClipboardEvent) => {
        const text = event.clipboardData.getData('text/plain')
        if (onCurl && looksLikeCurl(text)) {
            event.preventDefault()
            onCurl(text)
        }
    }
    const [tab, setTab] = useState<Tab>(phase === 'request' ? 'params' : 'headers')
    const [bulk, setBulk] = useState(false)
    const headerPairs = useMemo(() => textToPairs(value.headers), [value.headers])
    const url = parseUrl(value.url)
    const params: Pair[] = url
        ? [...url.searchParams].map(([name, value]) => ({ name, value }))
        : []
    const setParams = (pairs: Pair[]) => {
        if (!url) return
        const search = new URLSearchParams()
        for (const p of pairs) if (p.name) search.append(p.name, p.value)
        url.search = search.toString()
        set({ url: url.toString() })
    }
    const type = contentTypeOf(value.headers)
    const json = type.includes('json') || (!type && /^\s*[[{]/.test(value.body))
    const jsonError = useMemo(() => {
        if (!json || !value.body.trim()) return undefined
        try {
            JSON.parse(value.body)
            return undefined
        } catch (error) {
            return error instanceof Error ? error.message : String(error)
        }
    }, [json, value.body])
    const format = () => {
        try {
            set({ body: JSON.stringify(JSON.parse(value.body), null, 2) })
        } catch {
            /* the validity badge already explains */
        }
    }
    const tabs: Tab[] = phase === 'request' ? ['params', 'headers', 'body'] : ['headers', 'body']
    const active = tabs.includes(tab) ? tab : tabs[0]
    const count = (name: Tab) =>
        name === 'params'
            ? params.length
            : name === 'headers'
              ? headerPairs.length
              : value.body
                ? bytes(new TextEncoder().encode(value.body).length)
                : 0
    return (
        <div className="editor" data-clipboard="" onPaste={pasteCurl}>
            {phase === 'request' ? (
                <div className="request-line">
                    <select
                        className={`mono ${methodClass(value.method)}`}
                        value={value.method}
                        onChange={(e) => set({ method: e.target.value })}
                    >
                        {(methods.includes(value.method)
                            ? methods
                            : [value.method, ...methods]
                        ).map((m) => (
                            <option key={m} value={m}>
                                {m}
                            </option>
                        ))}
                    </select>
                    <input
                        className="mono"
                        type="text"
                        spellCheck={false}
                        autoFocus={autoFocus}
                        placeholder="https://api.example.com/path?query=1"
                        value={value.url}
                        onChange={(e) => set({ url: e.target.value })}
                    />
                    {action}
                </div>
            ) : (
                <div className="request-line">
                    <label className="muted status-label">{t('status')}</label>
                    <input
                        className="mono status-input"
                        type="number"
                        min={100}
                        max={599}
                        value={value.status}
                        onChange={(e) => set({ status: e.target.value })}
                    />
                    {action}
                </div>
            )}
            <nav className="editor-tabs" role="tablist">
                {tabs.map((name) => (
                    <button
                        key={name}
                        type="button"
                        role="tab"
                        aria-selected={active === name}
                        className={active === name ? 'active' : ''}
                        onClick={() => setTab(name)}
                    >
                        {t(name)}
                        {count(name) ? <span className="tab-count">{count(name)}</span> : null}
                    </button>
                ))}
                <span className="spacer" />
                {active === 'headers' && (
                    <IconButton
                        icon="list-flat"
                        title={t('bulkEdit')}
                        active={bulk}
                        onClick={() => setBulk(!bulk)}
                    />
                )}
                {active === 'body' && json && !bodyDisabled && (
                    <>
                        <span
                            className={`json-state ${jsonError ? 'bad' : 'ok'}`}
                            title={jsonError}
                        >
                            <span
                                className={`codicon codicon-${jsonError ? 'warning' : 'check'}`}
                                aria-hidden="true"
                            />
                            {jsonError ? t('jsonInvalid') : 'JSON'}
                        </span>
                        <IconButton
                            icon="json"
                            title={t('formatJson')}
                            disabled={!!jsonError || !value.body.trim()}
                            onClick={format}
                        />
                    </>
                )}
            </nav>
            <div className="editor-page">
                {active === 'params' &&
                    (url ? (
                        <PairsEditor pairs={params} onChange={setParams} />
                    ) : (
                        <p className="muted editor-note">{t('paramsNeedUrl')}</p>
                    ))}
                {active === 'headers' &&
                    (bulk ? (
                        <textarea
                            className="mono"
                            spellCheck={false}
                            rows={Math.min(14, Math.max(4, value.headers.split('\n').length + 1))}
                            placeholder="Content-Type: application/json"
                            value={value.headers}
                            onChange={(e) => set({ headers: e.target.value })}
                        />
                    ) : (
                        <PairsEditor
                            pairs={headerPairs}
                            onChange={(pairs) => set({ headers: pairsToText(pairs) })}
                            suggestions={headerSuggestions}
                        />
                    ))}
                {active === 'body' && (
                    <>
                        {bodyDisabled && (
                            <p className="muted editor-note">{t('binaryNotEditable')}</p>
                        )}
                        <textarea
                            className="mono body-input"
                            spellCheck={false}
                            rows={Math.min(20, Math.max(6, value.body.split('\n').length + 1))}
                            disabled={bodyDisabled}
                            placeholder={json ? '{\n  "key": "value"\n}' : undefined}
                            value={value.body}
                            onChange={(e) => set({ body: e.target.value })}
                        />
                    </>
                )}
            </div>
        </div>
    )
}
