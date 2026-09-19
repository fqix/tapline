import { useEffect, useRef, useState } from 'react'
import { ruleKinds, ruleLabel, type Edit, type Rule, type RuleKind } from '../../shared/model'
import { t } from '../lib/i18n'
import { saveState, state, vscode } from '../lib/vscode'
import { IconButton } from './IconButton'

const kindIcon: Record<RuleKind, string> = {
    breakpoint: 'debug-breakpoint',
    rewrite: 'edit',
    mapLocal: 'file',
    mapRemote: 'arrow-swap',
    block: 'circle-slash',
    throttle: 'pulse'
}

export const newRuleId = () =>
    `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** A fresh rule of `kind`, optionally scoped to a URL pattern. */
export function newRule(kind: RuleKind, url = ''): Rule {
    const base = { id: newRuleId(), enabled: true, url }
    switch (kind) {
        case 'breakpoint':
            return { ...base, kind, request: true, response: false }
        case 'rewrite':
            return { ...base, kind, request: {}, response: {} }
        case 'mapLocal':
            return { ...base, kind, body: '', status: 200 }
        case 'mapRemote':
            return { ...base, kind, to: 'http://localhost:8080' }
        case 'block':
            return { ...base, kind, status: 403 }
        case 'throttle':
            return { ...base, kind, latencyMs: 500, kbps: 256 }
    }
}

/** `Name: value` sets a header, `Name:` (no value) removes it. */
export function headerEditsToText(edits: Record<string, string | null> | undefined) {
    return Object.entries(edits ?? {})
        .map(([name, value]) => (value === null ? `${name}:` : `${name}: ${value}`))
        .join('\n')
}
export function textToHeaderEdits(text: string): Record<string, string | null> | undefined {
    const edits: Record<string, string | null> = {}
    for (const line of text.split('\n')) {
        const at = line.indexOf(':')
        if (at <= 0) continue
        const name = line.slice(0, at).trim()
        const value = line.slice(at + 1).trim()
        if (name) edits[name] = value === '' ? null : value
    }
    return Object.keys(edits).length ? edits : undefined
}

function Field({
    label,
    hint,
    children
}: {
    label: string
    hint?: string
    children: React.ReactNode
}) {
    return (
        <label className="field">
            <span className="field-label muted">
                {label}
                {hint && <span className="field-hint"> · {hint}</span>}
            </span>
            {children}
        </label>
    )
}

const Text = ({
    value,
    onChange,
    placeholder,
    mono = true,
    type = 'text'
}: {
    value: string | number | undefined
    onChange(v: string): void
    placeholder?: string
    mono?: boolean
    type?: string
}) => (
    <input
        className={mono ? 'mono' : ''}
        type={type}
        spellCheck={false}
        placeholder={placeholder}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
    />
)

const Area = ({
    value,
    onChange,
    placeholder,
    rows = 3
}: {
    value: string | undefined
    onChange(v: string): void
    placeholder?: string
    rows?: number
}) => (
    <textarea
        className="mono"
        spellCheck={false}
        rows={rows}
        placeholder={placeholder}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
    />
)

const int = (v: string) => (v.trim() === '' ? undefined : Number(v) || undefined)

/**
 * Header edits as text. Keeps the raw text while typing: re-serialising the parsed
 * edits on every keystroke would swallow a half-typed `Name:` line.
 */
function HeaderEdits({
    edits,
    onChange
}: {
    edits: Record<string, string | null> | undefined
    onChange(next: Record<string, string | null> | undefined): void
}) {
    const [text, setText] = useState(() => headerEditsToText(edits))
    return (
        <Area
            value={text}
            placeholder={'X-Debug: 1\nAuthorization:'}
            onChange={(v) => {
                setText(v)
                onChange(textToHeaderEdits(v))
            }}
        />
    )
}

/** Edit block for one phase of a rewrite rule. */
function EditFields({
    phase,
    edit,
    onChange
}: {
    phase: 'request' | 'response'
    edit: Edit
    onChange(next: Edit): void
}) {
    const set = (patch: Partial<Edit>) => onChange({ ...edit, ...patch })
    const bodyMode = edit.body !== undefined ? 'set' : edit.bodyReplace ? 'replace' : 'keep'
    return (
        <fieldset className="edit-fields">
            <legend>{t(phase)}</legend>
            {phase === 'request' ? (
                <>
                    <Field label={t('method')}>
                        <Text
                            value={edit.method}
                            placeholder={t('keepOriginal')}
                            onChange={(v) => set({ method: v || undefined })}
                        />
                    </Field>
                    <Field label={t('urlRegex')} hint={t('regexHint')}>
                        <div className="pair">
                            <Text
                                value={edit.url?.pattern}
                                placeholder="/v1/"
                                onChange={(v) =>
                                    set({
                                        url: v
                                            ? {
                                                  pattern: v,
                                                  replacement: edit.url?.replacement ?? ''
                                              }
                                            : undefined
                                    })
                                }
                            />
                            <Text
                                value={edit.url?.replacement}
                                placeholder="/v2/"
                                onChange={(v) =>
                                    set({
                                        url: { pattern: edit.url?.pattern ?? '', replacement: v }
                                    })
                                }
                            />
                        </div>
                    </Field>
                </>
            ) : (
                <Field label={t('status')}>
                    <Text
                        value={edit.status}
                        type="number"
                        placeholder={t('keepOriginal')}
                        onChange={(v) => set({ status: int(v) })}
                    />
                </Field>
            )}
            <Field label={t('headers')} hint={t('headerEditHint')}>
                <HeaderEdits edits={edit.headers} onChange={(headers) => set({ headers })} />
            </Field>
            <Field label={t('body')}>
                <select
                    value={bodyMode}
                    onChange={(e) => {
                        const mode = e.target.value
                        set({
                            body: mode === 'set' ? (edit.body ?? '') : undefined,
                            bodyReplace:
                                mode === 'replace'
                                    ? (edit.bodyReplace ?? { pattern: '', replacement: '' })
                                    : undefined
                        })
                    }}
                >
                    <option value="keep">{t('keepOriginal')}</option>
                    <option value="replace">{t('bodyReplace')}</option>
                    <option value="set">{t('bodySet')}</option>
                </select>
            </Field>
            {bodyMode === 'replace' && (
                <Field label={t('regexHint')}>
                    <div className="pair">
                        <Text
                            value={edit.bodyReplace?.pattern}
                            placeholder="pattern"
                            onChange={(v) =>
                                set({
                                    bodyReplace: {
                                        pattern: v,
                                        replacement: edit.bodyReplace?.replacement ?? ''
                                    }
                                })
                            }
                        />
                        <Text
                            value={edit.bodyReplace?.replacement}
                            placeholder="replacement"
                            onChange={(v) =>
                                set({
                                    bodyReplace: {
                                        pattern: edit.bodyReplace?.pattern ?? '',
                                        replacement: v
                                    }
                                })
                            }
                        />
                    </div>
                </Field>
            )}
            {bodyMode === 'set' && (
                <Area value={edit.body} rows={6} onChange={(v) => set({ body: v })} />
            )}
        </fieldset>
    )
}

function RuleForm({ rule, onChange }: { rule: Rule; onChange(next: Rule): void }) {
    const set = (patch: Partial<Rule>) => onChange({ ...rule, ...patch } as Rule)
    return (
        <div className="rule-form">
            <div className="rule-row">
                <label className="checkbox">
                    <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) => set({ enabled: e.target.checked })}
                    />
                    {t('enabled')}
                </label>
                <select
                    value={rule.kind}
                    onChange={(e) => {
                        const next = newRule(e.target.value as RuleKind, rule.url)
                        onChange({
                            ...next,
                            id: rule.id,
                            name: rule.name,
                            method: rule.method,
                            enabled: rule.enabled
                        } as Rule)
                    }}
                >
                    {ruleKinds.map((k) => (
                        <option key={k} value={k}>
                            {t(`kind.${k}`)}
                        </option>
                    ))}
                </select>
                <input
                    type="text"
                    placeholder={t('ruleName')}
                    value={rule.name ?? ''}
                    onChange={(e) => set({ name: e.target.value || undefined })}
                />
            </div>
            <p className="muted kind-help">{t(`kindHelp.${rule.kind}`)}</p>
            <Field label={t('urlPattern')} hint={t('urlPatternHint')}>
                <Text
                    value={rule.url}
                    placeholder="https://api.example.com/*"
                    onChange={(v) => set({ url: v })}
                />
            </Field>
            <Field label={t('methods')} hint={t('methodsHint')}>
                <Text
                    value={rule.method}
                    placeholder="GET, POST"
                    onChange={(v) => set({ method: v || undefined })}
                />
            </Field>
            {rule.kind === 'breakpoint' && (
                <div className="rule-row">
                    <label className="checkbox">
                        <input
                            type="checkbox"
                            checked={!!rule.request}
                            onChange={(e) => set({ request: e.target.checked })}
                        />
                        {t('breakRequest')}
                    </label>
                    <label className="checkbox">
                        <input
                            type="checkbox"
                            checked={!!rule.response}
                            onChange={(e) => set({ response: e.target.checked })}
                        />
                        {t('breakResponse')}
                    </label>
                </div>
            )}
            {rule.kind === 'rewrite' && (
                <>
                    <EditFields
                        phase="request"
                        edit={rule.request ?? {}}
                        onChange={(request) => set({ request })}
                    />
                    <EditFields
                        phase="response"
                        edit={rule.response ?? {}}
                        onChange={(response) => set({ response })}
                    />
                </>
            )}
            {rule.kind === 'mapLocal' && (
                <>
                    <Field label={t('file')} hint={t('fileHint')}>
                        <div className="pair">
                            <Text
                                value={rule.file}
                                placeholder="mocks/users.json"
                                onChange={(v) => set({ file: v || undefined })}
                            />
                            <IconButton
                                icon="folder-opened"
                                title={t('browse')}
                                onClick={() =>
                                    vscode.postMessage({ type: 'pickFile', ruleId: rule.id })
                                }
                            />
                        </div>
                    </Field>
                    {!rule.file && (
                        <Field label={t('inlineBody')}>
                            <Area
                                value={rule.body}
                                rows={6}
                                placeholder='{"ok": true}'
                                onChange={(v) => set({ body: v })}
                            />
                        </Field>
                    )}
                    <div className="pair">
                        <Field label={t('status')}>
                            <Text
                                value={rule.status}
                                type="number"
                                placeholder="200"
                                onChange={(v) => set({ status: int(v) })}
                            />
                        </Field>
                        <Field label="Content-Type" hint={t('contentTypeHint')}>
                            <Text
                                value={rule.contentType}
                                placeholder="application/json"
                                onChange={(v) => set({ contentType: v || undefined })}
                            />
                        </Field>
                    </div>
                </>
            )}
            {rule.kind === 'mapRemote' && (
                <Field label={t('mapTo')} hint={t('mapToHint')}>
                    <Text
                        value={rule.to}
                        placeholder="http://localhost:8080"
                        onChange={(v) => set({ to: v })}
                    />
                </Field>
            )}
            {rule.kind === 'block' && (
                <Field label={t('status')}>
                    <Text
                        value={rule.status}
                        type="number"
                        placeholder="403"
                        onChange={(v) => set({ status: int(v) })}
                    />
                </Field>
            )}
            {rule.kind === 'throttle' && (
                <div className="pair">
                    <Field label={t('latency')}>
                        <Text
                            value={rule.latencyMs}
                            type="number"
                            placeholder="500"
                            onChange={(v) => set({ latencyMs: int(v) })}
                        />
                    </Field>
                    <Field label={t('bandwidth')}>
                        <Text
                            value={rule.kbps}
                            type="number"
                            placeholder="256"
                            onChange={(v) => set({ kbps: int(v) })}
                        />
                    </Field>
                </div>
            )}
        </div>
    )
}

/** Rule list and editor; every change is saved to `tapline.rules` after a short delay. */
export function Rules({
    rules,
    onChange,
    onClose
}: {
    rules: Rule[]
    onChange(next: Rule[]): void
    onClose(): void
}) {
    const [selected, setSelected] = useState<string | undefined>(() => state().rule)
    const [adding, setAdding] = useState(false)
    const listRef = useRef<HTMLDivElement>(null)
    const current = rules.find((r) => r.id === selected) ?? rules[0]
    useEffect(() => {
        if (current && current.id !== selected) {
            setSelected(current.id)
            saveState({ rule: current.id })
        }
    }, [current, selected])
    const choose = (id: string) => {
        setSelected(id)
        saveState({ rule: id })
    }
    const update = (next: Rule) => onChange(rules.map((r) => (r.id === next.id ? next : r)))
    const add = (kind: RuleKind) => {
        const rule = newRule(kind)
        onChange([...rules, rule])
        choose(rule.id)
        setAdding(false)
    }
    const remove = (id: string) => onChange(rules.filter((r) => r.id !== id))
    const move = (id: string, delta: number) => {
        const index = rules.findIndex((r) => r.id === id)
        const target = index + delta
        if (index < 0 || target < 0 || target >= rules.length) return
        const next = [...rules]
        ;[next[index], next[target]] = [next[target], next[index]]
        onChange(next)
    }
    return (
        <div className="inspector pane rules">
            <header className="inspector-head">
                <span className="codicon codicon-symbol-ruler" aria-hidden="true" />
                <span className="title">{t('rules')}</span>
                <span className="muted">{t('rulesHint')}</span>
                <span className="actions">
                    <IconButton
                        icon="add"
                        title={t('addRule')}
                        active={adding}
                        onClick={() => setAdding(!adding)}
                    />
                    <IconButton icon="close" title={t('close')} onClick={onClose} />
                </span>
            </header>
            {adding && (
                <div className="kind-picker">
                    {ruleKinds.map((k) => (
                        <button key={k} type="button" className="kind" onClick={() => add(k)}>
                            <span className={`codicon codicon-${kindIcon[k]}`} aria-hidden="true" />
                            <span>
                                <strong>{t(`kind.${k}`)}</strong>
                                <span className="muted">{t(`kindHelp.${k}`)}</span>
                            </span>
                        </button>
                    ))}
                </div>
            )}
            <div className="inspector-body">
                {!rules.length && !adding && (
                    <div className="empty">
                        <div>
                            <p>{t('noRules')}</p>
                            <button
                                type="button"
                                className="button"
                                onClick={() => setAdding(true)}
                            >
                                <span className="codicon codicon-add" aria-hidden="true" />
                                {t('addRule')}
                            </button>
                        </div>
                    </div>
                )}
                {rules.length > 0 && (
                    <div className="rule-list" ref={listRef} role="listbox">
                        {rules.map((rule, i) => (
                            <div
                                key={rule.id}
                                role="option"
                                aria-selected={rule.id === current?.id}
                                className={`rule-item ${rule.id === current?.id ? 'selected' : ''} ${rule.enabled ? '' : 'disabled'}`}
                                onClick={() => choose(rule.id)}
                            >
                                <input
                                    type="checkbox"
                                    checked={rule.enabled}
                                    title={t('enabled')}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => update({ ...rule, enabled: e.target.checked })}
                                />
                                <span
                                    className={`codicon codicon-${kindIcon[rule.kind]}`}
                                    title={t(`kind.${rule.kind}`)}
                                    aria-hidden="true"
                                />
                                <span className="rule-name ellipsis">
                                    {ruleLabel(rule)}
                                    {rule.name && (
                                        <span className="muted"> · {t(`kind.${rule.kind}`)}</span>
                                    )}
                                </span>
                                <span className="rule-url mono muted ellipsis" title={rule.url}>
                                    {rule.method ? `${rule.method.toUpperCase()} ` : ''}
                                    {rule.url || '*'}
                                </span>
                                <span className="rule-actions">
                                    <IconButton
                                        icon="chevron-up"
                                        title={t('moveUp')}
                                        disabled={i === 0}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            move(rule.id, -1)
                                        }}
                                    />
                                    <IconButton
                                        icon="chevron-down"
                                        title={t('moveDown')}
                                        disabled={i === rules.length - 1}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            move(rule.id, 1)
                                        }}
                                    />
                                    <IconButton
                                        icon="trash"
                                        title={t('delete')}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            remove(rule.id)
                                        }}
                                    />
                                </span>
                            </div>
                        ))}
                    </div>
                )}
                {current && <RuleForm key={current.id} rule={current} onChange={update} />}
            </div>
        </div>
    )
}
