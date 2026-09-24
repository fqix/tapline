import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { SequenceTable } from './SequenceTable'
import type { Row } from '../types/messages'

vi.mock('../lib/vscode', () => ({ state: () => ({}), saveState() {}, vscode: {} }))
afterEach(() => vi.unstubAllGlobals())

it.each([
    ['ws', undefined, 'WS'],
    ['wss', undefined, 'WSS'],
    ['wss', '1.1', 'WSS'],
    ['https', '2.0', 'HTTP/2.0'],
    ['http', '1.1', 'HTTP/1.1']
] as const)('renders %s (%s) in the protocol cell', (scheme, httpVersion, expected) => {
    vi.stubGlobal('window', { __strings: {} })
    vi.stubGlobal('document', { body: {} })
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '13px' }))
    const row = {
        id: 'test',
        scheme,
        httpVersion,
        timestamp: Date.now(),
        method: 'GET',
        url: `${scheme}://example.com`,
        state: 'completed',
        responseBytes: 0
    } as Row
    const html = renderToStaticMarkup(
        createElement(SequenceTable, {
            rows: [row],
            total: 1,
            selection: [],
            onSelect() {},
            sort: { column: 'timestamp', ascending: true },
            onSort() {},
            onClearFilters() {}
        })
    )
    expect(html).toContain(`class="mono ellipsis c-proto" title="${expected}">${expected}</span>`)
})
