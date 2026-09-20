import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Transaction } from '../../shared/model'
import { Frames, ServerEvents } from './Frames'

vi.mock('../lib/vscode', () => ({ vscode: { postMessage() {} } }))

afterEach(() => vi.unstubAllGlobals())

describe('stream timestamps', () => {
    it.each([
        ['WebSocket', Frames],
        ['SSE', ServerEvents]
    ] as const)(
        '%s displays local time with milliseconds and preserves the ISO instant',
        (_name, Component) => {
            vi.stubGlobal('window', { __strings: {} })
            const iso = '2026-09-20T03:10:40.759Z'
            const time = Date.parse(iso)
            const transaction = {
                id: 'stream',
                state: 'completed',
                frames: [{ id: 'f', time, direction: 'receive', binary: false, data: 'hello' }],
                events: [{ id: 'e', time, event: 'message', data: 'hello', lastEventId: '' }]
            } as Transaction
            const html = renderToStaticMarkup(createElement(Component, { x: transaction }))
            // Use the same local clock as the request table; the visible time must not be UTC.
            const local = new Intl.DateTimeFormat(undefined, {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                fractionalSecondDigits: 3,
                hour12: false
            }).format(time)
            expect(html).toContain(`dateTime="${iso}">${local}</time>`)
        }
    )
})
