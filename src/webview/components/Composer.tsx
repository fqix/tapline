import { useState } from 'react'
import { t } from '../lib/i18n'
import { vscode } from '../lib/vscode'
import type { ComposeDraft } from '../types/messages'
import { Editor, fromCurl, textToHeaders } from './Editor'
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
    const [importing, setImporting] = useState(false)
    const [command, setCommand] = useState('')
    const [warnings, setWarnings] = useState<string[]>([])
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
    /** Replace the draft with a parsed curl command (pasted or typed into the import box). */
    const importCurl = (text: string) => {
        const { value, warnings } = fromCurl(text)
        onChange({ ...value })
        setWarnings(warnings)
        setError(undefined)
        setImporting(false)
        setCommand('')
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
                        icon="terminal"
                        title={t('importCurl')}
                        active={importing}
                        onClick={() => setImporting(!importing)}
                    />
                    <IconButton
                        icon="clear-all"
                        title={t('composeClear')}
                        onClick={() => {
                            onChange(emptyDraft)
                            setWarnings([])
                        }}
                    />
                    <IconButton icon="close" title={t('close')} onClick={onClose} />
                </span>
            </header>
            <div className="inspector-body padded composer">
                {importing && (
                    <div className="curl-import" data-clipboard="">
                        <textarea
                            className="mono"
                            spellCheck={false}
                            autoFocus
                            rows={4}
                            placeholder={t('importCurlHint')}
                            value={command}
                            onChange={(e) => setCommand(e.target.value)}
                            onKeyDown={(e) => {
                                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                    e.stopPropagation()
                                    if (command.trim()) importCurl(command)
                                }
                            }}
                        />
                        <div className="curl-import-actions">
                            <button
                                type="button"
                                className="button"
                                disabled={!command.trim()}
                                onClick={() => importCurl(command)}
                            >
                                {t('import')}
                            </button>
                            <button
                                type="button"
                                className="button secondary"
                                onClick={() => setImporting(false)}
                            >
                                {t('cancel')}
                            </button>
                        </div>
                    </div>
                )}
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
                    onCurl={importCurl}
                    autoFocus={!importing}
                    action={
                        <button
                            type="button"
                            className="button send"
                            disabled={!valid}
                            title={t('sendHint')}
                            onClick={send}
                        >
                            <span className="codicon codicon-send" aria-hidden="true" />
                            {t('send')}
                            <kbd>{navigator.platform.startsWith('Mac') ? '⌘↩' : 'Ctrl+↩'}</kbd>
                        </button>
                    }
                />
                {error && <p className="note error">{error}</p>}
                {warnings.length > 0 && (
                    <p className="note">
                        {t('importCurlPartial')} {warnings.join(' · ')}
                    </p>
                )}
                {draft.replayOf && <p className="muted editor-note">{t('editResendNote')}</p>}
            </div>
        </div>
    )
}
