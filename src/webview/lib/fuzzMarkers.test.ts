import { expect, it } from 'vitest'
import type { ComposeDraft } from '../types/messages'
import { fuzzMarkerLocations } from './fuzzMarkers'

const draft = (patch: Partial<ComposeDraft> = {}): ComposeDraft => ({
    method: 'POST',
    url: 'https://example.test/api?token=$FUZZ$',
    headers: 'X-Test: one\nAuthorization: Bearer $FUZZ$',
    body: '',
    ...patch
})

it('lists marked URL, header and authorization values', () => {
    expect(fuzzMarkerLocations(draft())).toEqual([
        { location: 'Params', element: 'token' },
        { location: 'Authorization', element: 'token' }
    ])
    expect(
        fuzzMarkerLocations(draft({ headers: 'X-$FUZZ$: one', url: 'https://example.test/api' }))
    ).toEqual([{ location: 'Headers', element: 'X-$FUZZ$' }])
})

it('lists a path marker and a basic-auth credential', () => {
    expect(
        fuzzMarkerLocations(
            draft({
                url: 'https://example.test/$FUZZ$/item',
                headers: 'Authorization: Basic user:$FUZZ$'
            })
        )
    ).toEqual([
        { location: 'URL', element: 'path' },
        { location: 'Authorization', element: 'password' }
    ])
})

it('lists marked form, JSON and structured body fields', () => {
    expect(
        fuzzMarkerLocations(
            draft({
                url: 'https://example.test/api',
                headers: 'Content-Type: application/x-www-form-urlencoded',
                body: 'user=$FUZZ$&remember=1'
            })
        )
    ).toEqual([{ location: 'Body', element: 'user' }])

    expect(
        fuzzMarkerLocations(
            draft({
                url: 'https://example.test/api',
                headers: 'Content-Type: application/json',
                body: '{"user":{"name":"$FUZZ$"}}'
            })
        )
    ).toEqual([{ location: 'Body', element: 'user.name' }])

    expect(
        fuzzMarkerLocations(
            draft({
                url: 'https://example.test/api',
                headers: 'Content-Type: application/json',
                body: '{"query":"$FUZZ$","variables":"{}"}',
                bodyDraft: { mode: 'GraphQL', query: '$FUZZ$', variables: '{}' }
            })
        )
    ).toEqual([{ location: 'Body', element: 'GraphQL query' }])
})

it('returns nothing when no value is marked', () => {
    expect(
        fuzzMarkerLocations(draft({ url: 'https://example.test/api', headers: '', body: '' }))
    ).toEqual([])
})
