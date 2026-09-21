import { useEffect, useState } from 'react'
import { preferenceSchema, preferenceDescriptions } from '../../shared/preferences'
import { vscode } from '../lib/vscode'
import type { HostMessage } from '../types/messages'

export function Settings({ onClose, onRules }: { onClose(): void; onRules(): void }) {
    const zh = document.documentElement.lang.toLowerCase().startsWith('zh')
    const [values, setValues] = useState<Record<string, unknown>>()
    const [drafts, setDrafts] = useState<Record<string, string>>({})
    const [status, setStatus] = useState('')
    const [pending, setPending] = useState(false)
    useEffect(() => {
        const listener = (event: MessageEvent<HostMessage>) => {
            const message = event.data
            if (message.type !== 'settings') return
            setValues(message.values)
            if (message.saved || message.error) {
                setPending(false)
                setStatus(message.error || (zh ? '已保存' : 'Saved'))
                if (message.saved)
                    setDrafts((old) => {
                        const next = { ...old }
                        delete next[message.saved!]
                        return next
                    })
            }
        }
        window.addEventListener('message', listener)
        vscode.postMessage({ type: 'loadSettings' })
        return () => window.removeEventListener('message', listener)
    }, [zh])
    const save = (key: string, value: unknown) => {
        setPending(true)
        setStatus(zh ? '正在保存…' : 'Saving…')
        vscode.postMessage({ type: 'saveSetting', key, value })
    }
    return (
        <section className="settings-pane">
            <div className="settings-heading">
                <h2>{zh ? '设置' : 'Settings'}</h2>
                <button onClick={onClose}>{zh ? '关闭' : 'Close'}</button>
            </div>
            <p className="muted">
                {zh
                    ? '全局保存，所有项目共用。窗口隔离变更需重新加载窗口。'
                    : 'Saved globally for all projects. Reload the window after changing isolation.'}
            </p>
            <p role="status" aria-live="polite">
                {status}
            </p>
            <button onClick={onRules}>{zh ? '管理规则' : 'Manage Rules'}</button>
            {values &&
                Object.entries(preferenceSchema)
                    .filter(([key]) => key !== 'rules')
                    .map(([key, schema]) => {
                        const value = values[key]
                        const description = preferenceDescriptions[key][zh ? 'zh' : 'en']
                        const text =
                            drafts[key] ??
                            (schema.type === 'array'
                                ? (value as string[]).join('\n')
                                : schema.type === 'object'
                                  ? JSON.stringify(value, null, 2)
                                  : String(value))
                        return (
                            <div className="settings-field" key={key}>
                                <label htmlFor={`setting-${key}`}>{description}</label>
                                {schema.type === 'boolean' ? (
                                    <input
                                        id={`setting-${key}`}
                                        type="checkbox"
                                        checked={Boolean(value)}
                                        disabled={pending}
                                        onChange={(e) => save(key, e.target.checked)}
                                    />
                                ) : (
                                    <>
                                        {schema.type === 'integer' ? (
                                            <input
                                                id={`setting-${key}`}
                                                type="number"
                                                min={schema.minimum}
                                                max={schema.maximum}
                                                value={text}
                                                onChange={(e) =>
                                                    setDrafts({ ...drafts, [key]: e.target.value })
                                                }
                                            />
                                        ) : (
                                            <textarea
                                                id={`setting-${key}`}
                                                rows={schema.type === 'object' ? 12 : 3}
                                                value={text}
                                                onChange={(e) =>
                                                    setDrafts({ ...drafts, [key]: e.target.value })
                                                }
                                            />
                                        )}
                                        {schema.type === 'array' && (
                                            <small className="muted">
                                                {zh ? '每行一项' : 'One item per line'}
                                                {schema.items?.enum
                                                    ? `: ${schema.items.enum.join(', ')}`
                                                    : ''}
                                            </small>
                                        )}
                                        <button
                                            disabled={pending || drafts[key] === undefined}
                                            onClick={() => {
                                                try {
                                                    const parsed =
                                                        schema.type === 'integer'
                                                            ? text.trim()
                                                                ? Number(text)
                                                                : NaN
                                                            : schema.type === 'array'
                                                              ? text
                                                                    .split('\n')
                                                                    .map((s) => s.trim())
                                                                    .filter(Boolean)
                                                              : JSON.parse(text)
                                                    save(key, parsed)
                                                } catch {
                                                    setStatus(
                                                        zh ? '请输入有效 JSON' : 'Enter valid JSON'
                                                    )
                                                }
                                            }}
                                        >
                                            {zh ? '保存' : 'Save'}
                                        </button>
                                    </>
                                )}
                            </div>
                        )
                    })}
        </section>
    )
}
