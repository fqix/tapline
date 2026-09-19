import { useState } from 'react'
import { t } from '../lib/i18n'
import { vscode } from '../lib/vscode'
import type { ComposeDraft } from '../types/messages'
import { Editor, textToHeaders } from './Editor'
import { IconButton } from './IconButton'

export const emptyDraft: ComposeDraft = { method: 'GET', url: '', headers: '', body: '' }

/** Compose and send a request through the proxy; the reply appears in the table. */
export function Composer({
    draft,
    onChange,
    onClose
}: {
    draft: ComposeDraft
    onChange(next: ComposeDraft): void
    onClose(): void
}) {
    const [error, setError] = useState<string>()
    const valid = /^https?:\/\/\S+$/i.test(draft.url.trim())
    const send = () => {
        if (!valid) {
            setError(t('composeInvalidUrl'))
            return
        }
        setError(undefined)
        vscode.postMessage({
            type: 'compose',
            request: {
                url: draft.url.trim(),
                method: draft.method,
                headers: textToHeaders(draft.headers),
                body: draft.body,
                replayOf: draft.replayOf
            }
        })
    }
    return (
        <div
            className="inspector pane"
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && send()}
        >
            <header className="inspector-head">
                <span className="codicon codicon-send" aria-hidden="true" />
                <span className="title">{t('composer')}</span>
                <span className="actions">
                    <IconButton
                        icon="clear-all"
                        title={t('composeClear')}
                        onClick={() => onChange(emptyDraft)}
                    />
                    <IconButton icon="close" title={t('close')} onClick={onClose} />
                </span>
            </header>
            <div className="inspector-body padded">
                <Editor
                    phase="request"
                    value={{ ...draft, status: '' }}
                    onChange={(v) =>
                        onChange({
                            ...draft,
                            method: v.method,
                            url: v.url,
                            headers: v.headers,
                            body: v.body
                        })
                    }
                    autoFocus
                />
                {error && <p className="note error">{error}</p>}
                <div className="editor-actions">
                    <button type="button" className="button" disabled={!valid} onClick={send}>
                        <span className="codicon codicon-send" aria-hidden="true" />
                        {t('send')}
                    </button>
                    <span className="muted">{t('sendHint')}</span>
                </div>
            </div>
        </div>
    )
}
