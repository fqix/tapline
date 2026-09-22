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
    onClose,
    curlImport,
    onImportCurl
}: {
    draft: ComposeDraft
    onChange(next: ComposeDraft): void
    onClose(): void
    /** Outcome of the last curl import from the host. */
    curlImport?: { warnings: string[]; error?: string }
    onImportCurl(text: string): void
}) {
    const [error, setError] = useState<string>()
    const [importing, setImporting] = useState(false)
    const [command, setCommand] = useState('')
    const valid = /^https?:\/\/\S+$/i.test(draft.url.trim())
    const send = () => {
        if (draft.bodyError) {
            setError(draft.bodyError)
            return
        }
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
                bodyEncoding: draft.bodyEncoding,
                replayOf: draft.replayOf
            }
        })
    }
    /** Hand a curl command (pasted, or typed into the import box) to the host parser. */
    const importCurl = (text: string) => {
        setError(undefined)
        setImporting(false)
        setCommand('')
        onImportCurl(text)
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
                        icon="sign-in"
                        label="cURL"
                        title={t('importCurl')}
                        active={importing}
                        onClick={() => setImporting(!importing)}
                    />
                    <IconButton
                        icon="clear-all"
                        title={t('composeClear')}
                        onClick={() => onChange(emptyDraft)}
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
                            body: v.body,
                            bodyEncoding: v.bodyEncoding,
                            bodyDraft: v.bodyDraft,
                            bodyError: v.bodyError
                        })
                    }
                    onCurl={importCurl}
                    allowFiles
                    autoFocus={!importing}
                    action={
                        <button
                            type="button"
                            className="button send"
                            disabled={!valid || !!draft.bodyError}
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
                {curlImport?.error && (
                    <p className="note error">
                        {t('importCurlFailed')} {curlImport.error}
                    </p>
                )}
                {curlImport && curlImport.warnings.length > 0 && (
                    <p className="note">
                        {t('importCurlPartial')} {curlImport.warnings.join(' · ')}
                    </p>
                )}
                {draft.replayOf && <p className="muted editor-note">{t('editResendNote')}</p>}
            </div>
        </div>
    )
}
