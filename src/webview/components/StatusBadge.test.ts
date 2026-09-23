import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StatusBadge } from './StatusBadge'

afterEach(() => vi.unstubAllGlobals())

describe('TLS status badge', () => {
    it.each(['completed'] as const)('marks a %s tunnel as undecrypted', (state) => {
        vi.stubGlobal('window', { __strings: { undecrypted: '未解密', tunnel: 'TLS tunnel' } })
        const html = renderToStaticMarkup(
            createElement(StatusBadge, { x: { scheme: 'connect', state } })
        )
        expect(html).toContain('未解密')
        expect(html).toContain('codicon-lock')
        expect(html).toContain('title="TLS tunnel"')
        expect(html).not.toContain('codicon-loading')
    })

    it('keeps pending tunnels spinning', () => {
        const html = renderToStaticMarkup(
            createElement(StatusBadge, { x: { scheme: 'connect', state: 'pending' } })
        )
        expect(html).toContain('codicon-loading')
        expect(html).not.toContain('codicon-lock')
    })

    it('shows tunnel failures as errors', () => {
        const html = renderToStaticMarkup(
            createElement(StatusBadge, { x: { scheme: 'connect', state: 'error' } })
        )
        expect(html).toContain('ERR')
        expect(html).toContain('status error')
        expect(html).not.toContain('codicon-lock')
    })

    it('keeps the HTTP status for decrypted HTTPS', () => {
        const html = renderToStaticMarkup(
            createElement(StatusBadge, { x: { scheme: 'https', state: 'completed', status: 201 } })
        )
        expect(html).toContain('201')
        expect(html).toContain('status s2')
        expect(html).not.toContain('codicon-lock')
    })
})
