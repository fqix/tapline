import { useMemo, useState, type ReactNode } from 'react'
import { pretty, type Transaction } from '../../shared/model'
import { bodyBytes, isJSON, rawMessage, requestLine, statusLine } from '../lib/http'
import { t } from '../lib/i18n'
import { tokenize, type Token } from '../lib/jsonHighlight'
import { vscode } from '../lib/vscode'
import { IconButton } from './IconButton'

/** Colouring a huge body line by line would freeze the panel; above this it is plain. */
const HIGHLIGHT_LIMIT = 256 * 1024

/** Split a token stream on newlines so each line can be rendered on its own. */
function tokenLines(text: string): Token[][] {
    const lines: Token[][] = [[]]
    for (const token of tokenize(text)) {
        const parts = token.text.split('\n')
        parts.forEach((part, i) => {
            if (i > 0) lines.push([])
            if (part) lines[lines.length - 1].push({ kind: token.kind, text: part })
        })
    }
    return lines
}

const render = (tokens: Token[]): ReactNode =>
    tokens.map((token, i) =>
        token.kind === 'space' || token.kind === 'punct' ? (
            token.text
        ) : (
            <span key={i} className={`tk-${token.kind}`}>
                {token.text}
            </span>
        )
    )

/**
 * The message as it went over the wire: status/request line, headers, blank line and
 * body, numbered like an editor. JSON bodies are pretty-printed and coloured when
 * `formatted` is on; otherwise the body shows byte for byte.
 */
export function RawView({ x, side }: { x: Transaction; side: 'request' | 'response' }) {
    const [formatted, setFormatted] = useState(true)
    const headers = side === 'request' ? x.requestHeaders : x.responseHeaders
    const body = side === 'request' ? x.requestBody : x.responseBody
    const binary = side === 'request' ? x.requestBinary : x.responseBinary
    const first = side === 'request' ? requestLine(x) : statusLine(x)
    const json = !binary && !!body && isJSON(headers, body)
    const bodyLines = useMemo<ReactNode[]>(() => {
        if (binary)
            return [<span className="muted">{t('binary', bodyBytes(body, true).length)}</span>]
        if (!body) return []
        const text = json && formatted ? pretty(body) : body
        if (json && text.length <= HIGHLIGHT_LIMIT) return tokenLines(text).map(render)
        return text.split('\n')
    }, [body, binary, json, formatted])
    const lines: ReactNode[] = [
        <span className="raw-first">{first}</span>,
        ...Object.entries(headers).map(([name, value]) => (
            <>
                <span className="raw-name">{name}</span>
                <span className="raw-colon">: </span>
                {value}
            </>
        )),
        ...(bodyLines.length ? ['', ...bodyLines] : [])
    ]
    return (
        <div className="raw">
            <div className="raw-actions">
                {json && (
                    <span className="segmented" role="radiogroup">
                        {(['pretty', 'text'] as const).map((name) => (
                            <button
                                key={name}
                                type="button"
                                role="radio"
                                aria-checked={formatted === (name === 'pretty')}
                                className={formatted === (name === 'pretty') ? 'active' : ''}
                                onClick={() => setFormatted(name === 'pretty')}
                            >
                                {t(name)}
                            </button>
                        ))}
                    </span>
                )}
                <IconButton
                    icon="copy"
                    title={t('copy')}
                    onClick={() => vscode.postMessage({ type: 'copy', text: rawMessage(x, side) })}
                />
            </div>
            <pre className="raw-lines">
                {lines.map((line, i) => (
                    <div key={i} className="raw-line">
                        <span className="raw-ln">{i + 1}</span>
                        <span className="raw-text">{line}</span>
                    </div>
                ))}
            </pre>
        </div>
    )
}
