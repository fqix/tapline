import { describe, expect, it } from 'vitest'
import { decodeBase64, encodeBase64, graphqlBody, multipartBody, type UploadPart } from './body'

describe('request body serialization', () => {
    it('preserves all byte values and large files', () => {
        const bytes = Uint8Array.from({ length: 100000 }, (_, i) => i % 256)
        expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes)
    })
    it('encodes multipart text, repeated keys, files and unchecked fields', async () => {
        const parts: UploadPart[] = [
            { name: 'tag', value: '你好', type: 'text', enabled: true },
            { name: 'tag', value: 'two', type: 'text', enabled: true },
            { name: 'skip', value: 'secret', type: 'text', enabled: false },
            {
                name: 'file',
                value: '',
                type: 'file',
                enabled: true,
                filename: 'bytes.bin',
                base64: 'AP+A',
                contentType: 'application/octet-stream'
            }
        ]
        const bytes = decodeBase64(multipartBody(parts, 'test-boundary'))
        const response = new Response(bytes, {
            headers: { 'Content-Type': 'multipart/form-data; boundary=test-boundary' }
        })
        const form = await response.formData()
        expect(form.getAll('tag')).toEqual(['你好', 'two'])
        expect(form.has('skip')).toBe(false)
        const file = form.get('file') as File
        expect(file.name).toBe('bytes.bin')
        expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([0, 255, 128]))
    })
    it('requires a selected file for enabled file fields', () => {
        expect(() =>
            multipartBody([{ name: 'file', value: '', type: 'file', enabled: true }], 'boundary')
        ).toThrow('Choose a file')
    })
    it('serializes GraphQL query, variables and operation name', () => {
        expect(JSON.parse(graphqlBody('query Q { viewer { id } }', '{"id":1}', ' Q '))).toEqual({
            query: 'query Q { viewer { id } }',
            variables: { id: 1 },
            operationName: 'Q'
        })
        expect(JSON.parse(graphqlBody('{ viewer { id } }', '', ''))).not.toHaveProperty(
            'operationName'
        )
    })
    it.each(['{', 'null', '[]', '1', '"value"'])('rejects invalid variables: %s', (variables) => {
        expect(() => graphqlBody('query', variables, '')).toThrow()
    })
})
