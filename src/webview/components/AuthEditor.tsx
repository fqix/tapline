import { useState } from 'react'
import { formatAuth, parseAuth, type Auth } from '../lib/auth'
import { t } from '../lib/i18n'
import { IconButton } from './IconButton'

/** Authorization header as a small form, with the header it produces shown below it. */
export function AuthEditor({ value, onChange }: { value: string; onChange(value: string): void }) {
    const [state, setState] = useState(() => ({ value, auth: parseAuth(value) }))
    const [reveal, setReveal] = useState(false)
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
            <div className="auth-fields">
                <label htmlFor="auth-type">{t('authType')}</label>
                <select
                    id="auth-type"
                    className="auth-type"
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
                {auth.type === 'basic' && (
                    <>
                        <label htmlFor="auth-username">{t('username')}</label>
                        <input
                            id="auth-username"
                            type="text"
                            autoComplete="off"
                            spellCheck={false}
                            value={auth.username}
                            onChange={(e) => update({ username: e.target.value.replace(/:/g, '') })}
                        />
                        <label htmlFor="auth-password">{t('password')}</label>
                        <span className="auth-secret">
                            <input
                                id="auth-password"
                                type={reveal ? 'text' : 'password'}
                                autoComplete="off"
                                spellCheck={false}
                                value={auth.password}
                                onChange={(e) => update({ password: e.target.value })}
                            />
                            <IconButton
                                icon={reveal ? 'eye-closed' : 'eye'}
                                title={t(reveal ? 'hideValue' : 'revealValue')}
                                active={reveal}
                                onClick={() => setReveal(!reveal)}
                            />
                        </span>
                    </>
                )}
                {(auth.type === 'bearer' || auth.type === 'custom') && (
                    <>
                        <label htmlFor="auth-token">
                            {auth.type === 'bearer' ? 'Token' : t('headerValue')}
                        </label>
                        <input
                            id="auth-token"
                            type="text"
                            className="mono"
                            autoComplete="off"
                            spellCheck={false}
                            placeholder={auth.type === 'bearer' ? 'eyJhbGciOi…' : 'Digest …'}
                            value={auth.token}
                            onChange={(e) => update({ token: e.target.value })}
                        />
                    </>
                )}
            </div>
            <p className="auth-preview muted">
                {value ? (
                    <>
                        <span className="auth-preview-label">{t('authSends')}</span>
                        <code className="mono ellipsis" title={value}>
                            Authorization: {value}
                        </code>
                    </>
                ) : (
                    t('authSendsNothing')
                )}
            </p>
        </div>
    )
}
