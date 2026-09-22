import { describe, expect, it } from 'vitest'
import { looksLikeCurl, parseCurl, tokenize } from '../shared/curl'
import { toCurl } from '../shared/model'

describe('tokenize', () => {
    it('splits on whitespace and honours quotes, escapes and continuations', () => {
        expect(tokenize(`a 'b c' "d \\"e\\"" f\\ g \\\n h`)).toEqual([
            'a',
            'b c',
            'd "e"',
            'f g',
            'h'
        ])
        expect(tokenize(`$'line\\nbreak' 'it'"'"'s'`)).toEqual(['line\nbreak', "it's"])
        expect(tokenize(`x ^\r\n y`)).toEqual(['x', 'y'])
    })
})

describe('parseCurl', () => {
    it('imports a browser "copy as cURL" command', () => {
        const command = `curl 'https://api.example.com/v1/items?page=2' \\
  -H 'accept: application/json' \\
  -H 'authorization: Bearer abc' \\
  -H 'content-type: application/json' \\
  --data-raw '{"name":"demo"}' \\
  --compressed`
        expect(looksLikeCurl(command)).toBe(true)
        const r = parseCurl(command)
        expect(r).toMatchObject({
            method: 'POST',
            url: 'https://api.example.com/v1/items?page=2',
            body: '{"name":"demo"}',
            warnings: []
        })
        expect(r.headers).toEqual([
            ['accept', 'application/json'],
            ['authorization', 'Bearer abc'],
            ['content-type', 'application/json'],
            ['Accept-Encoding', 'gzip, deflate, br']
        ])
    })

    it('handles attached values, --request=, -G, --json and basic auth', () => {
        expect(parseCurl(`curl -XDELETE -sS example.com/x`)).toMatchObject({
            method: 'DELETE',
            url: 'http://example.com/x'
        })
        expect(parseCurl(`curl --request=PUT -u me:secret https://h/p`)).toMatchObject({
            method: 'PUT',
            headers: [['Authorization', 'Basic bWU6c2VjcmV0']]
        })
        expect(parseCurl(`curl -G -d a=1 --data-urlencode 'q=x y' https://h/p?z=0`)).toMatchObject({
            method: 'GET',
            url: 'https://h/p?z=0&a=1&q=x%20y',
            body: ''
        })
        const json = parseCurl(`curl --json '{"a":1}' https://h/j`)
        expect(json.method).toBe('POST')
        expect(json.headers).toEqual([
            ['Content-Type', 'application/json'],
            ['Accept', 'application/json']
        ])
        expect(parseCurl(`$ curl -I https://h/`).method).toBe('HEAD')
        expect(parseCurl(`curl -d a=1 -d b=2 https://h/`)).toMatchObject({
            body: 'a=1&b=2',
            headers: [['Content-Type', 'application/x-www-form-urlencoded']]
        })
    })

    it('builds multipart bodies and reports what it cannot import', () => {
        const r = parseCurl(
            `curl -F name=demo -F file=@photo.png -o out.bin -b cookies.txt https://h/u`
        )
        expect(r.method).toBe('POST')
        expect(r.body).toContain('Content-Disposition: form-data; name="name"\r\n\r\ndemo')
        expect(r.headers[0][1]).toMatch(/^multipart\/form-data; boundary=/)
        expect(r.warnings).toEqual([
            'form file @photo.png not imported',
            'cookie file cookies.txt not imported'
        ])
        expect(parseCurl(`curl -d @body.json https://h/`).warnings).toEqual([
            'data file @body.json not imported'
        ])
    })

    it("round-trips Tapline's own Copy as cURL output", () => {
        const command = toCurl({
            method: 'PATCH',
            url: "https://h/it's?x=1",
            requestHeaders: { 'X-Id': '7', Host: 'h', 'Content-Type': 'text/plain' },
            requestBody: 'it\'s "quoted"\nline two',
            requestBinary: false
        })
        expect(parseCurl(command)).toMatchObject({
            method: 'PATCH',
            url: "https://h/it's?x=1",
            headers: [
                ['X-Id', '7'],
                ['Content-Type', 'text/plain']
            ],
            body: 'it\'s "quoted"\nline two'
        })
    })
})
