import { describe, expect, it } from 'vitest'
import { parseFormBody, serializeFormBody } from './form'

describe('form body editing', () => {
    it('decodes imported fields, preserving order, repeated names and empty values', () => {
        expect(parseFormBody('tag=one&tag=two&empty=&q=a+b%26c&name=%E4%B8%AD%E6%96%87')).toEqual([
            { name: 'tag', value: 'one', enabled: true },
            { name: 'tag', value: 'two', enabled: true },
            { name: 'empty', value: '', enabled: true },
            { name: 'q', value: 'a b&c', enabled: true },
            { name: 'name', value: '中文', enabled: true }
        ])
    })
    it('encodes enabled rows, retaining disabled values for re-enabling', () => {
        const pairs = parseFormBody('tag=one&tag=two&q=a+b%26c')
        pairs[1].enabled = false
        expect(serializeFormBody(pairs)).toBe('tag=one&q=a+b%26c')
        expect(pairs[1].value).toBe('two')
        pairs[1].enabled = true
        expect(serializeFormBody(pairs)).toBe('tag=one&tag=two&q=a+b%26c')
    })
    it('supports adding and removing rows, plus literal plus signs and empty names', () => {
        const pairs = parseFormBody('remove=me')
        pairs.splice(0, 1)
        pairs.push(
            { name: '', value: 'a+b' },
            { name: 'empty', value: '' },
            { name: '', value: '' }
        )
        expect(serializeFormBody(pairs)).toBe('=a%2Bb&empty=')
        expect(parseFormBody('')).toEqual([])
    })
})
