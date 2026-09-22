import { expect, it } from 'vitest'
import { formatAuth, parseAuth } from './auth'

it('round trips imported bearer and basic credentials', () => {
    for (const value of ['Bearer abc.def', 'Basic bG9naW46cGFzc3dvcmQ='])
        expect(formatAuth(parseAuth(value))).toBe(value)
    const auth = { type: 'basic' as const, token: '', username: '用户', password: 'pass:word' }
    expect(parseAuth(formatAuth(auth))).toEqual(auth)
})

it('preserves unsupported or malformed schemes and removes auth explicitly', () => {
    for (const value of ['Digest realm="example"', 'Basic ???']) {
        expect(parseAuth(value).type).toBe('custom')
        expect(formatAuth(parseAuth(value))).toBe(value)
    }
    expect(formatAuth({ ...parseAuth('Bearer abc'), type: 'none' })).toBe('')
})
