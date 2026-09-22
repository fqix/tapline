import { useMemo, useState, type ReactNode } from 'react'
import { type Headers } from '../../shared/model'
import { AuthEditor } from './AuthEditor'
import { AdvancedBody, type BodyUpdate } from './AdvancedBody'
import { bodyModes, graphqlBody, multipartBody, type BodyDraft, type BodyMode } from '../lib/body'
import type { Pair } from '../lib/http'
import { parseFormBody, serializeFormBody, type FormPair } from '../lib/form'
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
    bodyEncoding?: 'base64'
    bodyDraft?: BodyDraft
    bodyError?: string
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
export const pairsToText = (pairs: FormPair[]) =>
    pairs
        .filter((p) => p.enabled !== false)
        .map((p) => (p.value || p.name.includes(':') ? `${p.name}: ${p.value}` : p.name))
        .join('\n')

/** Does the text look like a curl invocation (optionally after a `$ ` prompt)? */
const looksLikeCurl = (text: string) => /^\s*(\$\s*)?curl(\.exe)?\s/i.test(text)

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

type Tab = 'params' | 'authorization' | 'headers' | 'body'

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
    onCurl,
    allowFiles = false
}: {
    phase: 'request' | 'response'
    value: EditorValue
    onChange(next: EditorValue): void
    allowFiles?: boolean
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
    const [bodyRaw, setBodyRaw] = useState(false)
    const [formState, setFormState] = useState(() => ({
        body: value.body,
        url: value.url,
        pairs: parseFormBody(value.body)
    }))
    // Keep disabled rows locally, but replace them when another draft/body is loaded.
    if (formState.body !== value.body || formState.url !== value.url) {
        setFormState({ body: value.body, url: value.url, pairs: parseFormBody(value.body) })
    }
    const setForm = (pairs: FormPair[]) => {
        const body = serializeFormBody(pairs)
        setFormState({ body, url: value.url, pairs })
        set({ body })
    }
    const [headerState, setHeaderState] = useState(() => ({
        text: value.headers,
        pairs: textToPairs(value.headers) as FormPair[]
    }))
    if (headerState.text !== value.headers)
        setHeaderState({ text: value.headers, pairs: textToPairs(value.headers) })
    const headerPairs = headerState.pairs
    const enabledHeaders = headerPairs.filter((p) => p.enabled !== false)
    const setHeaderPairs = (pairs: FormPair[]) => {
        const text = pairsToText(pairs)
        setHeaderState({ text, pairs })
        set({ headers: text })
    }
    const url = parseUrl(value.url)
    const [paramsState, setParamsState] = useState(() => ({
        url: value.url,
        pairs: parseFormBody(url?.search ?? '')
    }))
    if (paramsState.url !== value.url)
        setParamsState({ url: value.url, pairs: parseFormBody(url?.search ?? '') })
    const params = paramsState.pairs
    const setParams = (pairs: FormPair[]) => {
        if (!url) return
        url.search = serializeFormBody(pairs)
        const nextUrl = url.toString()
        setParamsState({ url: nextUrl, pairs })
        // Query editing is not a new request: retain disabled Body fields too.
        setFormState((state) => ({ ...state, url: nextUrl }))
        set({ url: nextUrl })
    }
    const type = contentTypeOf(value.headers)
    const mode: BodyMode =
        phase === 'response'
            ? 'raw'
            : (value.bodyDraft?.mode ??
              (type.split(';')[0].trim() === 'application/x-www-form-urlencoded'
                  ? 'x-www-form-urlencoded'
                  : value.body || type
                    ? 'raw'
                    : 'none'))
    const form = phase === 'request' && mode === 'x-www-form-urlencoded'
    const advanced = mode === 'binary' || mode === 'form-data' || mode === 'GraphQL'
    const setBody = (update: BodyUpdate, contentType?: string) => {
        let headers = value.headers
        if (contentType !== undefined) {
            const pairs = headerPairs.filter((p) => p.name.toLowerCase() !== 'content-type')
            if (contentType) pairs.push({ name: 'Content-Type', value: contentType })
            headers = pairsToText(pairs)
            setHeaderState({ text: headers, pairs })
        }
        set({ bodyEncoding: undefined, bodyError: undefined, ...update, headers })
    }
    const changeMode = (mode: BodyMode) => {
        setBodyRaw(false)
        const bodyDraft: BodyDraft = { mode }
        const body = value.bodyEncoding ? '' : value.body
        if (mode === 'none') setBody({ body: '', bodyDraft }, '')
        else if (mode === 'binary')
            setBody(
                { body: '', bodyDraft, bodyError: t('chooseBodyFile') },
                'application/octet-stream'
            )
        else if (mode === 'form-data') {
            bodyDraft.parts = [{ name: '', value: '', enabled: true, type: 'text' }]
            const boundary = `----Tapline${crypto.randomUUID().replace(/-/g, '')}`
            setBody(
                {
                    body: multipartBody(bodyDraft.parts, boundary),
                    bodyEncoding: 'base64',
                    bodyDraft
                },
                `multipart/form-data; boundary=${boundary}`
            )
        } else if (mode === 'GraphQL') {
            bodyDraft.query = ''
            bodyDraft.variables = '{}'
            try {
                const parsed = JSON.parse(body)
                if (typeof parsed.query === 'string') {
                    bodyDraft.query = parsed.query
                    bodyDraft.variables = JSON.stringify(parsed.variables ?? {}, null, 2)
                    bodyDraft.operationName =
                        typeof parsed.operationName === 'string' ? parsed.operationName : ''
                }
            } catch {
                /* Start with an empty query for non-GraphQL text. */
            }
            try {
                setBody(
                    {
                        body: graphqlBody(
                            bodyDraft.query ?? '',
                            bodyDraft.variables ?? '',
                            bodyDraft.operationName ?? ''
                        ),
                        bodyDraft
                    },
                    'application/json'
                )
            } catch (error) {
                setBody({ body: '', bodyDraft, bodyError: String(error) }, 'application/json')
            }
        } else
            setBody(
                { body, bodyDraft },
                mode === 'x-www-form-urlencoded'
                    ? 'application/x-www-form-urlencoded'
                    : 'text/plain'
            )
    }
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
    const tabs: Tab[] =
        phase === 'request' ? ['params', 'authorization', 'headers', 'body'] : ['headers', 'body']
    const active = tabs.includes(tab) ? tab : tabs[0]
    const authorization =
        enabledHeaders.find((p) => p.name.toLowerCase() === 'authorization')?.value ?? ''
    const populated = (name: Tab) =>
        name === 'params'
            ? params.some((p) => p.enabled !== false && (p.name || p.value))
            : name === 'body'
              ? !!value.body
              : name === 'authorization'
                ? !!authorization
                : false
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
                        {name === 'headers' && enabledHeaders.length > 0 && (
                            <span className="editor-tab-count">{enabledHeaders.length}</span>
                        )}
                        {populated(name) && (
                            <span className="editor-tab-dot" aria-label={t('hasContent')} />
                        )}
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
                {active === 'body' && mode === 'raw' && json && !bodyDisabled && (
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
                        <PairsEditor pairs={params} onChange={setParams} toggles />
                    ) : (
                        <p className="muted editor-note">{t('paramsNeedUrl')}</p>
                    ))}
                {active === 'authorization' && (
                    <AuthEditor
                        value={authorization}
                        onChange={(authorization) => {
                            const headers = headerPairs.filter(
                                (p) => p.name.toLowerCase() !== 'authorization'
                            )
                            if (authorization)
                                headers.push({ name: 'Authorization', value: authorization })
                            setHeaderPairs(headers)
                        }}
                    />
                )}
                {active === 'headers' &&
                    (bulk ? (
                        <textarea
                            className="mono"
                            spellCheck={false}
                            rows={Math.min(14, Math.max(4, value.headers.split('\n').length + 1))}
                            placeholder="Content-Type: application/json"
                            value={value.headers}
                            onChange={(e) => {
                                const text = e.target.value
                                setHeaderState({
                                    text,
                                    pairs: [
                                        ...textToPairs(text),
                                        ...headerPairs.filter((p) => p.enabled === false)
                                    ]
                                })
                                set({ headers: text })
                            }}
                        />
                    ) : (
                        <PairsEditor
                            pairs={headerPairs}
                            onChange={setHeaderPairs}
                            suggestions={headerSuggestions}
                            toggles
                        />
                    ))}
                <div hidden={active !== 'body'}>
                    <>
                        {phase === 'request' && !bodyDisabled && (
                            <div className="body-toolbar">
                                <label>
                                    <select
                                        aria-label={t('bodyFormat')}
                                        value={mode}
                                        onChange={(e) => changeMode(e.target.value as BodyMode)}
                                    >
                                        {bodyModes
                                            .filter(
                                                (mode) =>
                                                    allowFiles ||
                                                    mode === 'raw' ||
                                                    mode === 'x-www-form-urlencoded'
                                            )
                                            .map((mode) => (
                                                <option key={mode} value={mode}>
                                                    {mode}
                                                </option>
                                            ))}
                                    </select>
                                </label>
                                {form && bodyRaw && (
                                    <button
                                        type="button"
                                        className="button secondary"
                                        onClick={() => setBodyRaw(!bodyRaw)}
                                    >
                                        {bodyRaw ? t('formFields') : t('bulkEdit')}
                                    </button>
                                )}
                            </div>
                        )}
                        {bodyDisabled && (
                            <p className="muted editor-note">{t('binaryNotEditable')}</p>
                        )}
                        {value.bodyError && (
                            <p className="body-error" role="alert">
                                {value.bodyError}
                            </p>
                        )}
                        {mode === 'none' && !bodyDisabled ? (
                            <p className="muted editor-note">{t('noRequestBody')}</p>
                        ) : advanced && !bodyDisabled ? (
                            <AdvancedBody
                                key={mode}
                                draft={value.bodyDraft ?? { mode }}
                                onChange={setBody}
                            />
                        ) : form && !bodyRaw && !bodyDisabled ? (
                            <PairsEditor
                                pairs={formState.pairs}
                                onChange={setForm}
                                toggles
                                descriptions
                                mono={false}
                                headerAction={
                                    <button
                                        type="button"
                                        className="pairs-bulk-edit"
                                        onClick={() => setBodyRaw(true)}
                                    >
                                        {t('bulkEditShort')}
                                    </button>
                                }
                            />
                        ) : (
                            <textarea
                                className="mono body-input"
                                spellCheck={false}
                                rows={Math.min(20, Math.max(6, value.body.split('\n').length + 1))}
                                disabled={bodyDisabled}
                                placeholder={json ? '{\n  "key": "value"\n}' : undefined}
                                value={value.body}
                                onChange={(e) => set({ body: e.target.value })}
                            />
                        )}
                    </>
                </div>
            </div>
        </div>
    )
}
