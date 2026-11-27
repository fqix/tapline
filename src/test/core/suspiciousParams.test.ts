import { expect, it } from 'vitest'
import type { Transaction } from '../../shared/model'
import {
    paramCategories,
    paramCategoryLabel,
    suspiciousCategories
} from '../../shared/suspiciousParams'
import { matches, parseQuery } from '../../webview/lib/filter'
import { defaultFilters } from '../../webview/lib/filter'
import { toRow, type Row } from '../../webview/types/messages'

it('groups English and localized parameter names by category', () => {
    expect(paramCategories('dest')).toContain('ssrf')
    expect(paramCategories('redirect_uri')).toContain('redirect')
    expect(paramCategories('archivo')).toEqual(expect.arrayContaining(['ssrf', 'sqli', 'lfi']))
    expect(paramCategoryLabel('cmd')).toContain('RCE')
    expect(paramCategories('harmless')).toEqual([])
})

it('highlights matching query and form parameters of a request', () => {
    const request = {
        url: 'https://example.test/search?archivo=x&q=1',
        requestHeaders: { 'Content-Type': 'application/x-www-form-urlencoded' },
        requestBody: 'cmd=id',
        requestBinary: false
    } as unknown as Transaction
    expect(suspiciousCategories(request)).toEqual(
        expect.arrayContaining(['SSRF', 'SQLi', 'XSS', 'LFI', 'OpenRedirect', 'RCE'])
    )
    const row = toRow({
        ...request,
        id: '1',
        scheme: 'https',
        responseHeaders: {},
        frames: []
    }) as Row
    expect(row.paramHits).toContain('RCE')
    expect(matches(row, defaultFilters, parseQuery('param:rce'))).toBe(true)
    expect(matches(row, defaultFilters, parseQuery('param:xss'))).toBe(true)
    expect(matches(row, defaultFilters, parseQuery('-param:ssrf'))).toBe(false)
})
