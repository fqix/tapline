import { useMemo, useState } from 'react'
import { bytes, pretty, type Transaction } from '../../shared/model'
import { bodyBytes, hexDump, isJSON } from '../lib/http'
import { t } from '../lib/i18n'
import { tokenize } from '../lib/jsonHighlight'
import { saveState, state, vscode } from '../lib/vscode'
import { IconButton } from './IconButton'
import { Section } from './Section'

type View = 'pretty' | 'text' | 'hex'

/** Highlighting a multi-megabyte body would freeze the panel; above this it is plain text. */
const HIGHLIGHT_LIMIT = 256 * 1024

const views = state().bodyView ?? {}

/** Body section with a Pretty / Text / Hex switch, copy and open-in-editor actions. */
export function BodyView({ x, side }: { x: Transaction; side: 'request' | 'response' }) {
    const headers = side === 'request' ? x.requestHeaders : x.responseHeaders
    const body = side === 'request' ? x.requestBody : x.responseBody
    const binary = side === 'request' ? x.requestBinary : x.responseBinary
    const size = side === 'request' ? x.requestBytes : x.responseBytes
    const json = !binary && !!body && isJSON(headers, body)
    const available: View[] = [
        ...(json ? (['pretty'] as View[]) : []),
        ...(binary ? [] : (['text'] as View[])),
        'hex'
    ]
    const [view, setView] = useState<View>(() => (views[side] as View) ?? 'pretty')
    const active = available.includes(view) ? view : available[0]
    const choose = (next: View) => {
        views[side] = next
        setView(next)
        saveState({ bodyView: { ...views } })
    }
    const text = useMemo(
        () =>
            active === 'pretty'
                ? pretty(body)
                : active === 'hex'
                  ? hexDump(bodyBytes(body, binary))
                  : body,
        [active, body, binary]
    )
    const tokens = useMemo(
        () => (active === 'pretty' && text.length <= HIGHLIGHT_LIMIT ? tokenize(text) : undefined),
        [active, text]
    )
    if (!size && !body)
        return (
            <Section id={`${side}-body`} title={t('body')} count={bytes(0)}>
                <p className="muted">{t('noBody')}</p>
            </Section>
        )
    return (
        <Section
            id={`${side}-body`}
            title={t('body')}
            count={bytes(size)}
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
            {binary && active !== 'hex' && (
                <p className="muted">{t('binary', bodyBytes(body, true).length)}</p>
            )}
            <pre className={`body ${active === 'hex' ? 'hex' : ''}`}>
                {tokens
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
        </Section>
    )
}
