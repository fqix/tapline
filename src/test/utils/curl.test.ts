import { describe, expect, it } from 'vitest'
import { importCurl, looksLikeCurl } from '../../utils/curl'
import { toCurl } from '../../shared/model'

describe('importCurl', () => {
    // Commands copied from the linked demos, including their unescaped line breaks.
    describe('ReqBin demos', () => {
        it.each([
            {
                source: 'https://reqbin.com/req/c-dwjszac0/curl-post-json-example',
                command: `curl -X POST https://reqbin.com/echo/post/json
   -H 'Content-Type: application/json'
   -d '{"login":"my_login","password":"my_password"}'`,
                method: 'POST',
                url: 'https://reqbin.com/echo/post/json',
                header: 'Content-Type: application/json',
                body: '{"login":"my_login","password":"my_password"}'
            },
            {
                source: 'https://reqbin.com/req/c-sma2qrvp/curl-post-form-example',
                command: `curl -X POST https://reqbin.com/echo/post/form
   -H "Content-Type: application/x-www-form-urlencoded"
   -d "param1=value1&param2=value2"`,
                method: 'POST',
                url: 'https://reqbin.com/echo/post/form',
                header: 'Content-Type: application/x-www-form-urlencoded',
                body: 'param1=value1&param2=value2'
            },
            {
                source: 'https://reqbin.com/req/c-haxm0xgr/curl-basic-auth-example',
                command: `curl https://reqbin.com/echo
   -u "login:password"`,
                method: 'GET',
                url: 'https://reqbin.com/echo',
                header: 'Authorization: Basic bG9naW46cGFzc3dvcmQ=',
                body: ''
            },
            {
                source: 'https://reqbin.com/req/c-bjcj04uw/curl-send-cookies-example',
                command: 'curl -b "cookie_name=cookie_value" https://reqbin.com/echo',
                method: 'GET',
                url: 'https://reqbin.com/echo',
                header: 'Cookie: cookie_name=cookie_value',
                body: ''
            }
        ])('imports $source', async ({ command, method, url, header, body }) => {
            const result = await importCurl(command)
            expect(result).toMatchObject({ method, url, body, warnings: [] })
            expect(result.headers).toContain(header)
        })
    })

    it('imports a browser "copy as cURL" command', async () => {
        const command = `curl 'https://api.example.com/v1/items?page=2' \\
  -H 'accept: application/json' \\
  -H 'authorization: Bearer abc' \\
  -H 'content-type: application/json' \\
  --data-raw '{"name":"demo"}' \\
  --compressed`
        expect(looksLikeCurl(command)).toBe(true)
        const r = await importCurl(command)
        expect(r).toMatchObject({
            method: 'POST',
            url: 'https://api.example.com/v1/items?page=2',
            body: '{"name":"demo"}',
            warnings: []
        })
        expect(r.headers).toContain('accept: application/json')
        expect(r.headers).toContain('authorization: Bearer abc')
        expect(r.headers).toContain('content-type: application/json')
        expect(r.headers.toLowerCase()).not.toContain('content-length')
    })

    it('handles attached values, -G, --json, basic auth and multipart', async () => {
        expect(await importCurl(`curl -XDELETE -sS example.com/x`)).toMatchObject({
            method: 'DELETE',
            url: 'http://example.com/x',
            warnings: []
        })
        expect((await importCurl(`$ curl -X PUT -u me:secret https://h/p`)).headers).toContain(
            'Authorization: Basic bWU6c2VjcmV0'
        )
        expect(
            await importCurl(`curl -G -d a=1 --data-urlencode 'q=x y' https://h/p?z=0`)
        ).toMatchObject({
            method: 'GET',
            url: 'https://h/p?z=0&a=1&q=x+y',
            body: ''
        })
        const json = await importCurl(`curl --json '{"a":1}' https://h/j`)
        expect(json.method).toBe('POST')
        expect(json.headers).toContain('Content-Type: application/json')
        expect(json.body).toBe('{"a":1}')
        const form = await importCurl(`curl -F name=demo -F file=@photo.png https://h/u`)
        expect(form.headers).toMatch(/Content-Type: multipart\/form-data; boundary=/)
        expect(form.body).toContain('Content-Disposition: form-data; name="name"\n\ndemo')
        expect((await importCurl(`curl -I -b 'sid=1' https://h/`)).method).toBe('HEAD')
    })

    it('reports what it cannot import', async () => {
        const r = await importCurl(`curl -d @body.json -o out https://h/`)
        expect(r.warnings).toHaveLength(1)
        expect(r.warnings[0]).toContain('body.json')
    })

    it.each(['\n', '\r\n'])(
        'preserves quoted body line breaks with %j option lines',
        async (eol) => {
            const body = '你好\r\n\r\n-H this is body text\nlast line\n'
            const command = [
                'curl https://reqbin.com/echo/post/json',
                "  -H 'Content-Type: text/plain'",
                `  --data-raw '${body}'`
            ].join(eol)
            expect(await importCurl(command)).toMatchObject({
                method: 'POST',
                body,
                warnings: []
            })
        }
    )

    it('does not truncate a body using a supplied Content-Length', async () => {
        const result = await importCurl(
            `curl https://reqbin.com/echo -H 'Content-Length: 1' --data-raw 'hello'`
        )
        expect(result.body).toBe('hello')
        expect(result.headers.toLowerCase()).not.toContain('content-length')
    })

    it('keeps separate curl commands separate and warns about extra requests', async () => {
        const result = await importCurl(`curl https://reqbin.com/echo
curl https://reqbin.com/echo/post/json
  --json '{"name":"Leo","age":26}'`)
        expect(result).toMatchObject({ method: 'GET', url: 'https://reqbin.com/echo', body: '' })
        expect(result.warnings.length).toBeGreaterThan(0)
    })

    it('does not join options across a shell command separator', async () => {
        await expect(
            importCurl("curl https://reqbin.com/echo;\n-H 'X-Test: value'")
        ).rejects.toThrow()
    })

    it("round-trips Tapline's own Copy as cURL output", async () => {
        const command = toCurl({
            method: 'PATCH',
            url: "https://h/it's?x=1",
            requestHeaders: { 'X-Id': '7', Host: 'h', 'Content-Type': 'text/plain' },
            requestBody: 'it\'s "quoted"\nline two',
            requestBinary: false
        })
        expect(await importCurl(command)).toMatchObject({
            method: 'PATCH',
            url: "https://h/it's?x=1",
            body: 'it\'s "quoted"\nline two'
        })
    })
})

describe('importCurl with @file data', () => {
    const files: Record<string, string> = {
        'data.json': '{\n  "name": "demo"\n}\n',
        'raw.txt': 'line one\nline two\n',
        'q.txt': 'a b&c'
    }
    const read = async (name: string) => (name in files ? Buffer.from(files[name]) : undefined)

    it.each([
        'https://reqbin.com/echo/post/json',
        '[https://reqbin.com/echo/post/json](https://reqbin.com/echo/post/json)'
    ])('imports a file with the URL on the next line: %s', async (url) => {
        expect(await importCurl(`curl -d @data.json\n${url}`, read)).toMatchObject({
            method: 'POST',
            url: 'https://reqbin.com/echo/post/json',
            body: '{  "name": "demo"}',
            warnings: []
        })
    })

    it('reads -d @file and strips newlines like curl', async () => {
        const r = await importCurl('curl -d @data.json https://reqbin.com/echo/post/json', read)
        expect(r.method).toBe('POST')
        expect(r.body).toBe('{  "name": "demo"}')
        expect(r.warnings).toEqual([])
    })

    it('preserves Markdown in a quoted body and query characters in a linked URL', async () => {
        const body = '[https://example.com](https://example.com)'
        const r = await importCurl(
            `curl --data-raw 'line one\n${body}\n'\n[request](https://reqbin.com/echo?name=it's&n=2)`
        )
        expect(r).toMatchObject({
            method: 'POST',
            url: "https://reqbin.com/echo?name=it's&n=2",
            body: `line one\n${body}\n`,
            warnings: []
        })
    })

    it('warns about a missing file after importing a Markdown URL', async () => {
        const r = await importCurl(
            'curl -d @data.json\r\n  [request](https://reqbin.com/echo/post/json)'
        )
        expect(r).toMatchObject({ method: 'POST', url: 'https://reqbin.com/echo/post/json' })
        expect(r.warnings.join('\n')).toContain('data.json')
    })

    it('keeps --data-binary and --json bytes as they are', async () => {
        const r = await importCurl('curl --data-binary @raw.txt -X PUT https://x/y', read)
        expect(r.body).toBe('line one\nline two\n')
        const j = await importCurl('curl --json @data.json https://x/y', read)
        expect(j.body).toBe(files['data.json'])
        expect(j.headers).toContain('Content-Type: application/json')
    })

    it('url-encodes --data-urlencode and joins parts with &', async () => {
        const r = await importCurl('curl -d a=1 --data-urlencode q@q.txt https://x/', read)
        expect(r.body).toBe('a=1&q=a%20b%26c')
    })

    it('warns and keeps the literal when the file is missing', async () => {
        const r = await importCurl('curl -d @missing.json https://x/', read)
        expect(r.body).toBe('@missing.json')
        expect(r.warnings.some((w) => w.includes('missing.json'))).toBe(true)
        const none = await importCurl('curl -d @data.json https://x/')
        expect(none.body).toBe('@data.json')
    })
})
