import { expect, it } from 'vitest'
import { pairsToText, textToHeaders } from './Editor'

it('excludes unchecked headers from the outgoing request and restores them on re-enable', () => {
    const pairs = [
        { name: 'Accept', value: 'application/json' },
        { name: 'Authorization', value: 'Bearer secret', enabled: false },
        { name: 'X-Debug', value: '1', enabled: false }
    ]
    expect(textToHeaders(pairsToText(pairs))).toEqual({ Accept: 'application/json' })
    expect(pairs[1].value).toBe('Bearer secret')
    pairs[1].enabled = true
    expect(textToHeaders(pairsToText(pairs))).toEqual({
        Accept: 'application/json',
        Authorization: 'Bearer secret'
    })
})
