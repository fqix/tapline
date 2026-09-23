import {
    matchesSetting,
    settingsCatalog,
    settingsCategories,
    type SettingsCategory
} from '../lib/settingsCatalog'
import { useEffect, useState } from 'react'
import { preferenceSchema, preferenceDescriptions } from '../../shared/preferences'
import {
    captureEnvironment,
    PROFILES,
    profileDescriptions,
    proxyVariables,
    type CaptureTarget,
    type Profile
} from '../../utils/environment'
import { vscode } from '../lib/vscode'
import type { HostMessage } from '../types/messages'

const isProfile = (name: unknown): name is Profile =>
    typeof name === 'string' && (PROFILES as string[]).includes(name)

/** `NAME=value` rows for one set of profiles, resolved against this machine. */
function VariableTable({ target, profiles }: { target: CaptureTarget; profiles: unknown }) {
    const chosen = Array.isArray(profiles) ? profiles.filter(isProfile) : []
    const env = captureEnvironment(target, chosen)
    const proxy = new Set(Object.keys(proxyVariables(target.port)))
    // While capture is stopped the port is not known yet; show a placeholder for it.
    const show = (value: string) =>
        target.port ? value : value.replace(/(127\.0\.0\.1:|proxyPort=)0\b/g, '$1<port>')
    return (
        <table className="env-table" data-clipboard="">
            <tbody>
                {Object.entries(env).map(([name, value]) => (
                    <tr key={name} className={proxy.has(name) ? 'muted' : ''}>
                        <th>{name}</th>
                        <td>{show(value)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    )
}

/**
 * What the terminal profile setting actually injects: the resolved variables for the
 * current selection, plus a legend of what each profile name stands for.
 */
function EnvironmentPreview({
    value,
    target,
    zh
}: {
    value: unknown
    target: CaptureTarget
    zh: boolean
}) {
    return (
        <div className="env-preview">
            <p className="muted">
                {zh ? '当前会注入到每个新终端的变量：' : 'Injected into every new terminal:'}
            </p>
            <VariableTable target={target} profiles={value} />
            <details className="env-legend">
                <summary className="muted">{zh ? '名称对应的变量' : 'What each name adds'}</summary>
                <table className="env-table">
                    <tbody>
                        {PROFILES.map((profile) => (
                            <tr key={profile}>
                                <th>{profile}</th>
                                <td>{profileDescriptions[profile]}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </details>
        </div>
    )
}

export function Settings({ onClose, onRules }: { onClose(): void; onRules(): void }) {
    const zh = document.documentElement.lang.toLowerCase().startsWith('zh')
    const [values, setValues] = useState<Record<string, unknown>>()
    const [target, setTarget] = useState<CaptureTarget>()
    const [proxy, setProxy] = useState<Extract<HostMessage, { type: 'settings' }>['vscodeProxy']>()
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
            if (message.target) setTarget(message.target)
            if (message.vscodeProxy) setProxy(message.vscodeProxy)
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
                        ? '全局保存，所有项目共用；每个窗口独立抓包。'
                        : 'Saved globally for all projects; every window captures on its own.'}
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
                                            {target && key === 'terminal.profiles' && (
                                                <EnvironmentPreview
                                                    value={value}
                                                    target={target}
                                                    zh={zh}
                                                />
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
                                    {key === 'port' && (
                                        <div className="settings-proxy-actions">
                                            <p className="muted">
                                                {zh
                                                    ? 'VS Code 用户级代理，影响共用用户配置的窗口。跟随当前抓包端口，停止或退出时恢复原用户设置。移除仅清除用户级覆盖。HTTPS 解密需要信任 Tapline 根证书。'
                                                    : 'VS Code user proxy, shared by windows using this profile. Follows the live capture port and restores the previous user setting on stop or exit. Remove clears only the user override. HTTPS decryption requires trusting the Tapline root certificate.'}
                                            </p>
                                            <p className="muted">
                                                {proxy?.canSet
                                                    ? `http://127.0.0.1:${target?.port}`
                                                    : zh
                                                      ? '请先开始抓包'
                                                      : 'Start capture first'}
                                                {' · '}
                                                {proxy?.configured
                                                    ? zh
                                                        ? '已配置用户代理'
                                                        : 'User proxy configured'
                                                    : zh
                                                      ? '未配置用户代理'
                                                      : 'No user proxy configured'}
                                            </p>
                                            <p className="muted">
                                                {zh ? '生效代理' : 'Effective proxy'}:{' '}
                                                {proxy?.effective ||
                                                    (zh ? '默认 / 系统' : 'Default / system')}
                                                {' · '}
                                                {proxy?.scope === 'user'
                                                    ? zh
                                                        ? '用户级'
                                                        : 'User'
                                                    : zh
                                                      ? '工作区覆盖；请在工作区设置中修改'
                                                      : 'Workspace override; edit in workspace settings'}
                                                {proxy?.effective &&
                                                    !proxy.matches &&
                                                    (zh
                                                        ? ' · 与当前抓包端口不同'
                                                        : ' · Differs from current capture port')}
                                            </p>
                                            <div
                                                className="settings-proxy-buttons"
                                                aria-busy={pending}
                                            >
                                                <button
                                                    type="button"
                                                    className="button"
                                                    disabled={pending || !proxy?.canSet}
                                                    onClick={() => {
                                                        setPending(true)
                                                        setStatus(
                                                            zh ? '正在设置代理…' : 'Setting proxy…'
                                                        )
                                                        vscode.postMessage({
                                                            type: 'setVSCodeProxy'
                                                        })
                                                    }}
                                                >
                                                    {zh ? '设置 VS Code 代理' : 'Set VS Code proxy'}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="button secondary"
                                                    disabled={pending || !proxy?.configured}
                                                    onClick={() => {
                                                        setPending(true)
                                                        setStatus(
                                                            zh ? '正在移除代理…' : 'Removing proxy…'
                                                        )
                                                        vscode.postMessage({
                                                            type: 'removeVSCodeProxy'
                                                        })
                                                    }}
                                                >
                                                    {zh ? '移除用户级代理' : 'Remove user proxy'}
                                                </button>
                                            </div>
                                        </div>
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
