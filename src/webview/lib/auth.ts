export type Auth = {
    type: 'none' | 'bearer' | 'basic' | 'custom'
    token: string
    username: string
    password: string
}

export function parseAuth(value: string): Auth {
    const auth: Auth = { type: 'none', token: '', username: '', password: '' }
    if (!value) return auth
    if (/^Bearer(?:\s|$)/i.test(value))
        return { ...auth, type: 'bearer', token: value.slice(6).trimStart() }
    if (/^Basic(?:\s|$)/i.test(value)) {
        try {
            const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
                Uint8Array.from(atob(value.slice(5).trim()), (c) => c.charCodeAt(0))
            )
            const colon = decoded.indexOf(':')
            if (colon >= 0)
                return {
                    ...auth,
                    type: 'basic',
                    username: decoded.slice(0, colon),
                    password: decoded.slice(colon + 1)
                }
        } catch {
            /* Preserve unknown encodings in the raw field. */
        }
    }
    return { ...auth, type: 'custom', token: value }
}

export function formatAuth(auth: Auth): string {
    if (auth.type === 'none') return ''
    if (auth.type === 'bearer') return `Bearer ${auth.token}`
    if (auth.type === 'custom') return auth.token
    const bytes = new TextEncoder().encode(`${auth.username}:${auth.password}`)
    return `Basic ${btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))}`
}
