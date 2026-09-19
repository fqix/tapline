import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { matchesMessage, type MessageDirection } from '../lib/messages'
import { t } from '../lib/i18n'
import { vscode } from '../lib/vscode'
import type { HostMessage } from '../types/messages'
import { IconButton } from './IconButton'

export interface StreamItem {
    id: string
    text: string
    search: string
    direction?: 'send' | 'receive'
    body: ReactNode
    binary?: boolean
    resendDisabled?: string
}

/** A bounded scrolling viewport. Pausing freezes a snapshot, not network capture. */
export function MessageStream({
    items,
    className = '',
    notice,
    empty,
    transaction,
    open
}: {
    items: StreamItem[]
    className?: string
    notice?: ReactNode
    empty: string
    transaction?: string
    open?: boolean
}) {
    const [query, setQuery] = useState('')
    const [direction, setDirection] = useState<MessageDirection>('all')
    const [snapshot, setSnapshot] = useState<StreamItem[] | null>(null)
    const [sending, setSending] = useState<string>()
    const pendingSend = useRef<string>(undefined)
    const [result, setResult] = useState<{ error?: string }>()
    const viewport = useRef<HTMLDivElement>(null)
    const input = useRef<HTMLInputElement>(null)
    const lastTop = useRef(0)
    const displayed = snapshot ?? items
    const filtered = useMemo(
        () =>
            displayed.filter(
                (item) =>
                    (direction === 'all' || item.direction === direction) &&
                    matchesMessage(item.search, query)
            ),
        [displayed, query, direction]
    )
    const retainedNew = useMemo(() => {
        if (!snapshot) return 0
        const seen = new Set(snapshot.map((item) => item.id))
        return items.filter((item) => !seen.has(item.id)).length
    }, [snapshot, items])
    useLayoutEffect(() => {
        const element = viewport.current
        if (element && !snapshot) {
            element.scrollTop = element.scrollHeight
            lastTop.current = element.scrollTop
        }
    }, [filtered, snapshot])
    useEffect(() => {
        const receive = (event: MessageEvent<HostMessage>) => {
            const message = event.data
            if (
                message.type === 'frameResent' &&
                message.id === transaction &&
                message.frameId === pendingSend.current
            ) {
                pendingSend.current = undefined
                setSending(undefined)
                setResult({ error: message.error })
            }
        }
        window.addEventListener('message', receive)
        return () => window.removeEventListener('message', receive)
    }, [transaction])
    useEffect(() => {
        if (!sending) return
        const timer = setTimeout(() => {
            pendingSend.current = undefined
            setSending(undefined)
            setResult({ error: t('streamSendTimeout') })
        }, 15000)
        return () => clearTimeout(timer)
    }, [sending])
    const resend = (item: StreamItem) => {
        if (pendingSend.current) return
        pendingSend.current = item.id
        setSending(item.id)
        setResult(undefined)
        vscode.postMessage({ type: 'resendFrame', id: transaction!, frameId: item.id })
    }
    return (
        <div
            className={`message-stream ${className}`}
            onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
                    event.preventDefault()
                    input.current?.focus()
                }
            }}
        >
            <div className="stream-toolbar">
                <div className="filter">
                    <span className="codicon codicon-search" aria-hidden="true" />
                    <input
                        ref={input}
                        aria-label={t('streamSearch')}
                        placeholder={t('streamSearch')}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') setQuery('')
                        }}
                    />
                    {query && (
                        <IconButton
                            icon="close"
                            title={t('streamClearSearch')}
                            onClick={() => setQuery('')}
                        />
                    )}
                </div>
                {transaction && (
                    <select
                        aria-label={t('streamDirection')}
                        value={direction}
                        onChange={(event) => setDirection(event.target.value as MessageDirection)}
                    >
                        <option value="all">{t('streamAll')}</option>
                        <option value="send">{t('streamSent')}</option>
                        <option value="receive">{t('streamReceived')}</option>
                    </select>
                )}
                <span className="muted stream-count">
                    {t('streamCount', filtered.length, displayed.length)}
                </span>
                <IconButton
                    icon={snapshot ? 'debug-continue' : 'debug-pause'}
                    title={t(snapshot ? 'streamResume' : 'streamPause')}
                    label={t(snapshot ? 'streamResume' : 'streamPause')}
                    active={!!snapshot}
                    onClick={() => setSnapshot(snapshot ? null : items)}
                />
            </div>
            {snapshot && (
                <div className="stream-paused muted" role="status">
                    {t('streamPaused')}
                    {retainedNew > 0 && ` · ${t('streamNew', retainedNew)}`}
                </div>
            )}
            {result && (
                <p className={`note ${result.error ? 'error' : ''}`} role="status">
                    {result.error ?? t('streamResent')}
                </p>
            )}
            <div
                className="stream-scroll"
                ref={viewport}
                tabIndex={0}
                aria-label={t('messages')}
                onScroll={(event) => {
                    const element = event.currentTarget
                    if (
                        !snapshot &&
                        element.scrollTop < lastTop.current - 1 &&
                        element.scrollHeight - element.scrollTop - element.clientHeight > 16
                    )
                        setSnapshot(items)
                    lastTop.current = element.scrollTop
                }}
            >
                {notice}
                {!filtered.length && (
                    <p className="muted padded">
                        {t(query.trim() || direction !== 'all' ? 'streamNoMatches' : empty)}
                    </p>
                )}
                {filtered.map((item) => (
                    <div className="stream-item" key={item.id}>
                        {item.body}
                        <div className="stream-actions">
                            <IconButton
                                icon="copy"
                                title={t(item.binary ? 'streamCopyBase64' : 'streamCopy')}
                                onClick={() =>
                                    vscode.postMessage({ type: 'copy', text: item.text })
                                }
                            />
                            {transaction && item.direction === 'send' && (
                                <IconButton
                                    icon="debug-restart"
                                    title={t(
                                        !open
                                            ? 'streamClosed'
                                            : (item.resendDisabled ?? 'streamResend')
                                    )}
                                    disabled={!open || !!item.resendDisabled || !!sending}
                                    onClick={() => resend(item)}
                                />
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
