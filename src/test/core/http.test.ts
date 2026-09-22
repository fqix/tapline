import { describe, expect, it } from 'vitest'
import type { Transaction } from '../../shared/model'
import {
    bodyBytes,
    cookies,
    formFields,
    hexDump,
    queryParams,
    rawMessage
} from '../../webview/lib/http'

const base = {
    id: 'a',
    sequence: 1,
    timestamp: 0,
    method: 'POST',
    url: 'https://example.com/login?next=%2Fhome&x=1',
    host: 'example.com',
    path: '/login?next=%2Fhome&x=1',
    scheme: 'https',
    httpVersion: '1.1',
    client: 'c',
    state: 'completed',
    status: 302,
    statusMessage: 'Found',
    requestHeaders: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'a=1; b=two=2' },
    responseHeaders: { 'set-cookie': 'sid=abc; Path=/; HttpOnly', location: '/home' },
    requestBody: 'user=me&pass=p%26w',
    responseBody: '',
    requestBinary: false,
    responseBinary: false,
    requestBytes: 18,
    responseBytes: 0,
    truncated: false,
    duration: 1,
    tls: true,
    frames: []
} satisfies Transaction

describe('http helpers', () => {
    it('renders raw request and response messages', () => {
        expect(rawMessage(base, 'request')).toBe(
            'POST /login?next=%2Fhome&x=1 HTTP/1.1\r\ncontent-type: application/x-www-form-urlencoded\r\ncookie: a=1; b=two=2\r\n\r\nuser=me&pass=p%26w'
        )
        expect(rawMessage(base, 'response')).toMatch(/^HTTP\/1\.1 302 Found\r\nset-cookie: /)
        expect(
            rawMessage({ ...base, requestBody: 'AAEC', requestBinary: true }, 'request')
        ).toContain('<3 bytes of binary data>')
    })
    it('parses query strings, cookies and forms', () => {
        expect(queryParams(base)).toEqual([
            { name: 'next', value: '/home' },
            { name: 'x', value: '1' }
        ])
        expect(cookies(base.requestHeaders, 'request')).toEqual([
            { name: 'a', value: '1' },
            { name: 'b', value: 'two=2' }
        ])
        expect(cookies(base.responseHeaders, 'response')).toEqual([
            { name: 'sid', value: 'abc (Path=/; HttpOnly)' }
        ])
        expect(formFields(base.requestHeaders, base.requestBody, false)).toEqual([
            { name: 'user', value: 'me' },
            { name: 'pass', value: 'p&w' }
        ])
        expect(formFields({ 'content-type': 'application/json' }, '{}', false)).toEqual([])
    })
    it('produces a hex dump with ascii gutter and cap', () => {
        const dump = hexDump(bodyBytes('Hello, Tapline!!!', false))
        expect(dump.split('\n')[0]).toBe(
            '00000000  48 65 6c 6c 6f 2c 20 54  61 70 6c 69 6e 65 21 21  |Hello, Tapline!!|'
        )
        expect(dump.split('\n')[1]).toMatch(/^00000010  21 /)
        expect(hexDump(new Uint8Array(40), 16)).toContain('… 24 more bytes')
        expect(bodyBytes('AAEC', true)).toEqual(new Uint8Array([0, 1, 2]))
    })
})
