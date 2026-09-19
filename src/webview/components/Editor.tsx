import type { Headers } from '../../shared/model'
import { t } from '../lib/i18n'

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

/**
 * Method / URL / status line, headers and body inputs. `phase` decides which of the
 * first-line fields show: the request line for requests, the status for responses.
 */
export function Editor({
    phase,
    value,
    onChange,
    bodyDisabled,
    autoFocus
}: {
    phase: 'request' | 'response'
    value: EditorValue
    onChange(next: EditorValue): void
    bodyDisabled?: boolean
    autoFocus?: boolean
}) {
    const set = (patch: Partial<EditorValue>) => onChange({ ...value, ...patch })
    return (
        <div className="editor">
            {phase === 'request' ? (
                <div className="editor-line">
                    <select
                        className="mono"
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
                        placeholder="https://"
                        value={value.url}
                        onChange={(e) => set({ url: e.target.value })}
                    />
                </div>
            ) : (
                <div className="editor-line">
                    <label className="muted">{t('status')}</label>
                    <input
                        className="mono status-input"
                        type="number"
                        min={100}
                        max={599}
                        value={value.status}
                        onChange={(e) => set({ status: e.target.value })}
                    />
                </div>
            )}
            <label className="editor-label muted">{t('headers')}</label>
            <textarea
                className="mono"
                spellCheck={false}
                rows={Math.min(12, Math.max(3, value.headers.split('\n').length + 1))}
                placeholder="Content-Type: application/json"
                value={value.headers}
                onChange={(e) => set({ headers: e.target.value })}
            />
            <label className="editor-label muted">
                {t('body')}
                {bodyDisabled && <span> · {t('binaryNotEditable')}</span>}
            </label>
            <textarea
                className="mono"
                spellCheck={false}
                rows={Math.min(20, Math.max(4, value.body.split('\n').length + 1))}
                disabled={bodyDisabled}
                value={value.body}
                onChange={(e) => set({ body: e.target.value })}
            />
        </div>
    )
}
