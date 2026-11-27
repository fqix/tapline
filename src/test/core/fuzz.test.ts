import { expect, it } from 'vitest'
import { applyFuzz, fuzzTargets, hasFuzzMarker } from '../../shared/model'

const request = {
    url: 'https://example.test/search?q=old&lang=en',
    method: 'GET',
    headers: { Host: 'example.test', 'X-Test': 'one' },
    body: '{"a":1}'
}

it('offers query parameters, headers and the body as insertion points', () => {
    expect(fuzzTargets(request)).toEqual([
        { kind: 'query', name: 'q' },
        { kind: 'query', name: 'lang' },
        { kind: 'header', name: 'X-Test' },
        { kind: 'body' }
    ])
})

it('offers top-level form and JSON body fields when the content type says so', () => {
    const form = fuzzTargets({
        ...request,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'user=admin&remember=1'
    })
    expect(form).toContainEqual({ kind: 'form', name: 'user' })
    expect(form).toContainEqual({ kind: 'form', name: 'remember' })
    expect(form.at(-1)).toEqual({ kind: 'body' })

    const json = fuzzTargets({
        ...request,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: '{"user":"admin","remember":true}'
    })
    expect(json).toContainEqual({ kind: 'json', name: 'user' })
    expect(json).toContainEqual({ kind: 'json', name: 'remember' })

    expect(fuzzTargets({ ...request, bodyEncoding: 'base64' })).not.toContainEqual({
        kind: 'body'
    })
})

it('offers and fills a marked substring verbatim', () => {
    const marked = {
        ...request,
        url: 'https://example.test/search?q=before$FUZZ$after',
        body: 'token="$FUZZ$"'
    }
    expect(hasFuzzMarker(request)).toBe(false)
    expect(hasFuzzMarker(marked)).toBe(true)
    expect(
        hasFuzzMarker({ ...request, headers: { ...request.headers, 'X-Test': '$FUZZ$' } })
    ).toBe(true)
    expect(hasFuzzMarker({ ...request, headers: { 'X-$FUZZ$': 'one' } })).toBe(true)
    expect(fuzzTargets(marked)).toContainEqual({ kind: 'marker' })
    const result = applyFuzz(marked, { kind: 'marker' }, 'a b&c')
    expect(result.url).toBe('https://example.test/search?q=beforea b&cafter')
    expect(result.body).toBe('token="a b&c"')

    const auth = applyFuzz(
        { ...request, headers: { Authorization: 'Basic user:$FUZZ$' } },
        { kind: 'marker' },
        'p@ss:word'
    )
    expect(auth.headers.Authorization).toBe(`Basic ${btoa('user:p@ss:word')}`)

    const name = applyFuzz(
        { ...request, headers: { 'X-$FUZZ$': 'one' } },
        { kind: 'marker' },
        'Token'
    )
    expect(name.headers['X-Token']).toBe('one')
})

it('replaces one body field and leaves the other fields alone', () => {
    const form = applyFuzz(
        {
            ...request,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'user=admin&remember=1'
        },
        { kind: 'form', name: 'user' },
        'a b'
    )
    expect(form.body).toBe('user=a+b&remember=1')

    const json = applyFuzz(
        {
            ...request,
            headers: { 'Content-Type': 'application/json' },
            body: '{"user":"admin","remember":true}'
        },
        { kind: 'json', name: 'user' },
        'payload'
    )
    expect(JSON.parse(json.body)).toEqual({ user: 'payload', remember: true })
})

it('replaces one value and leaves the rest of the request alone', () => {
    const query = applyFuzz(request, { kind: 'query', name: 'q' }, 'a b')
    expect([...new URL(query.url).searchParams]).toEqual([
        ['q', 'a b'],
        ['lang', 'en']
    ])
    expect(query.body).toBe(request.body)

    const header = applyFuzz(request, { kind: 'header', name: 'x-test' }, 'two')
    expect(header.headers).toEqual({ Host: 'example.test', 'X-Test': 'two' })

    const body = applyFuzz(request, { kind: 'body' }, 'payload')
    expect(body.body).toBe('payload')
    expect(body.url).toBe(request.url)
})
