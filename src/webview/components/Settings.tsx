import {
    matchesSetting,
    settingsCatalog,
    settingsCategories,
    type SettingsCategory
} from '../lib/settingsCatalog'
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
    const [query, setQuery] = useState('')
    const [category, setCategory] = useState<SettingsCategory>('all')
    const locale = zh ? 'zh' : 'en'
    const matches = Object.entries(preferenceSchema).filter(
        ([key]) => key !== 'rules' && matchesSetting(key, query)
    )
    const visible = matches.filter(
        ([key]) => category === 'all' || settingsCatalog[key]?.category === category
    )
    const categories = [
        { id: 'all' as const, en: 'All settings', zh: '全部设置' },
        ...settingsCategories
    ]
    const clearSearch = () => {
        setQuery('')
        setCategory('all')
    }

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
            <header className="settings-header">
                <div className="settings-heading">
                    <h2>{zh ? '设置' : 'Settings'}</h2>
                    <button type="button" className="button secondary" onClick={onClose}>
                        {zh ? '关闭' : 'Close'}
                    </button>
                </div>
                <p className="muted">
                    {zh
                        ? '全局保存，所有项目共用。窗口隔离变更需重新加载窗口。'
                        : 'Saved globally for all projects. Reload the window after changing isolation.'}
                </p>
                <div className="settings-search">
                    <span className="codicon codicon-search" aria-hidden="true" />
                    <input
                        type="search"
                        aria-label={zh ? '搜索全部设置' : 'Search all settings'}
                        placeholder={
                            zh ? '搜索设置名称或说明…' : 'Search setting names or descriptions…'
                        }
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value)
                            setCategory('all')
                        }}
                    />
                    {query && (
                        <button type="button" className="button secondary" onClick={clearSearch}>
                            {zh ? '清除' : 'Clear'}
                        </button>
                    )}
                </div>
            </header>
            <div className="settings-layout">
                <nav className="settings-nav" aria-label={zh ? '设置分类' : 'Settings categories'}>
                    {categories.map((item) => (
                        <button
                            key={item.id}
                            aria-current={category === item.id ? 'page' : undefined}
                            onClick={() => setCategory(item.id)}
                        >
                            <span>{item[locale]}</span>
                            <span className="settings-count">
                                {item.id === 'all'
                                    ? matches.length
                                    : matches.filter(
                                          ([key]) => settingsCatalog[key]?.category === item.id
                                      ).length}
                            </span>
                        </button>
                    ))}
                    <button className="settings-rules-link" onClick={onRules}>
                        <span>{zh ? '管理规则' : 'Manage Rules'}</span>
                        <span className="codicon codicon-link-external" aria-hidden="true" />
                    </button>
                </nav>
                <main className="settings-content" key={category}>
                    <div className="settings-section-heading">
                        <h3>{categories.find((item) => item.id === category)?.[locale]}</h3>
                        <span className="muted" role="status">
                            {zh ? `${visible.length} 项设置` : `${visible.length} settings`}
                        </span>
                    </div>
                    <p className="settings-save-status" role="status" aria-live="polite">
                        {status}
                    </p>
                    {!values ? (
                        <p className="muted">{zh ? '正在加载设置…' : 'Loading settings…'}</p>
                    ) : !visible.length ? (
                        <div className="settings-empty">
                            <p>{zh ? '没有匹配的设置' : 'No matching settings'}</p>
                            <p className="muted">
                                {zh
                                    ? '尝试其他关键词，或查看全部设置。'
                                    : 'Try another keyword, or view all settings.'}
                            </p>
                            <button
                                type="button"
                                className="button secondary"
                                onClick={clearSearch}
                            >
                                {zh ? '查看全部设置' : 'View all settings'}
                            </button>
                        </div>
                    ) : (
                        visible.map(([key, schema]) => {
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
                                    <label htmlFor={`setting-${key}`}>
                                        {settingsCatalog[key]?.[locale] ?? key}
                                    </label>
                                    <p
                                        className="settings-description muted"
                                        id={`description-${key}`}
                                    >
                                        {description}
                                    </p>
                                    {schema.type === 'boolean' ? (
                                        <input
                                            id={`setting-${key}`}
                                            aria-describedby={`description-${key}`}
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
                                                    aria-describedby={`description-${key}`}
                                                    type="number"
                                                    min={schema.minimum}
                                                    max={schema.maximum}
                                                    value={text}
                                                    onChange={(e) =>
                                                        setDrafts({
                                                            ...drafts,
                                                            [key]: e.target.value
                                                        })
                                                    }
                                                />
                                            ) : (
                                                <textarea
                                                    id={`setting-${key}`}
                                                    aria-describedby={`description-${key}`}
                                                    rows={schema.type === 'object' ? 12 : 3}
                                                    value={text}
                                                    onChange={(e) =>
                                                        setDrafts({
                                                            ...drafts,
                                                            [key]: e.target.value
                                                        })
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
                                                type="button"
                                                className="button"
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
                                                            zh
                                                                ? '请输入有效 JSON'
                                                                : 'Enter valid JSON'
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
                        })
                    )}
                </main>
            </div>
        </section>
    )
}
