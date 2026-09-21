import { describe, expect, it } from 'vitest'
import { jsonTree } from '../webview/lib/jsonTree'

describe('JSON field/value tree', () => {
    it('keeps array indexes, field names, types and subtree boundaries', () => {
        const rows = jsonTree('{"items":[{"name":"Tapline","ok":true}],"empty":null}')!
        expect(rows.map(({ name, depth, kind, end }) => ({ name, depth, kind, end }))).toEqual([
            { name: 'JSON', depth: 0, kind: 'object', end: 5 },
            { name: 'items', depth: 1, kind: 'array', end: 4 },
            { name: '[0]', depth: 2, kind: 'object', end: 4 },
            { name: 'name', depth: 3, kind: 'string', end: 3 },
            { name: 'ok', depth: 3, kind: 'boolean', end: 4 },
            { name: 'empty', depth: 1, kind: 'null', end: 5 }
        ])
        expect(rows[3].value).toBe('Tapline')
        expect(rows[4].value).toBe('true')
        expect(rows[5].value).toBe('null')
    })
    it('retains empty containers and strings without making them expandable', () => {
        const rows = jsonTree('{"a":{},"b":[],"c":"","d":0}')!
        expect(rows.slice(1).map(({ count, kind, value }) => [count, kind, value])).toEqual([
            [0, 'object', ''],
            [0, 'array', ''],
            [0, 'string', ''],
            [0, 'number', '0']
        ])
    })
    it('falls back for truncated JSON and handles root primitives', () => {
        expect(jsonTree('{"a":')).toBeUndefined()
        expect(jsonTree('false')![0]).toMatchObject({ kind: 'boolean', value: 'false', end: 0 })
    })
    it('handles deeply nested arrays without recursive traversal', () => {
        const rows = jsonTree('['.repeat(1000) + '0' + ']'.repeat(1000))!
        expect(rows).toHaveLength(1001)
        expect(rows[0].end).toBe(1000)
        expect(rows[1000].depth).toBe(1000)
    })
})
