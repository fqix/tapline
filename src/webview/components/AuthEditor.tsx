import { formatAuth, parseAuth, type Auth } from '../lib/auth'
import { t } from '../lib/i18n'
import { useState } from 'react'

export function AuthEditor({ value, onChange }: { value: string; onChange(value: string): void }) {
    const [state, setState] = useState(() => ({ value, auth: parseAuth(value) }))
    if (state.value !== value) setState({ value, auth: parseAuth(value) })
    const auth = state.auth
    const update = (patch: Partial<Auth>) => {
        const next = { ...auth, ...patch }
        const value = formatAuth(next)
        setState({ value, auth: next })
        onChange(value)
    }
    return (
        <div className="auth-editor">
            <label>
                {t('authType')}
                <select
                    value={auth.type}
                    onChange={(e) =>
                        update({
                            type: e.target.value as Auth['type'],
                            token: '',
                            username: '',
                            password: ''
                        })
                    }
                >
                    <option value="none">{t('noAuth')}</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="basic">Basic Auth</option>
                    <option value="custom">{t('customAuth')}</option>
                </select>
            </label>
            {auth.type === 'basic' ? (
                <>
                    <label>
                        {t('username')}
                        <input
                            type="text"
                            autoComplete="off"
                            value={auth.username}
                            onChange={(e) => update({ username: e.target.value.replace(/:/g, '') })}
                        />
                    </label>
                    <label>
                        {t('password')}
                        <input
                            type="password"
                            autoComplete="off"
                            value={auth.password}
                            onChange={(e) => update({ password: e.target.value })}
                        />
                    </label>
                </>
            ) : (
                auth.type !== 'none' && (
                    <label>
                        {auth.type === 'bearer' ? 'Token' : 'Authorization'}
                        <input
                            type="text"
                            className="mono"
                            autoComplete="off"
                            spellCheck={false}
                            value={auth.token}
                            onChange={(e) => update({ token: e.target.value })}
                        />
                    </label>
                )
            )}
        </div>
    )
}
