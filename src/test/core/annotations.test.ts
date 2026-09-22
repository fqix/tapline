import { describe, expect, it, vi } from 'vitest'
import { Engine } from '../../core/engine'
import { toRow } from '../../webview/types/messages'

async function setup() {
    const engine = new Engine('/unused', '/unused')
    await engine.request('a', {
        method: 'GET',
        url: 'http://localhost/test',
        headers: {},
        client: { remoteAddress: '127.0.0.1', remotePort: 1 },
        body: async () => Buffer.alloc(0)
    })
    return engine
}

describe('session annotations', () => {
    it('publishes independent note and mark changes and preserves them through completion', async () => {
        const engine = await setup()
        const listener = vi.fn()
        engine.on('event', listener)
        engine.annotate('a', { note: '关键请求 <script>', marked: true })
        engine.annotate('a', { note: '更新备注' })
        await engine.response('a', {
            status: 200,
            statusMessage: 'OK',
            headers: {},
            body: async () => Buffer.alloc(0)
        })
        engine.responseData('a', Buffer.from('hello'))
        engine.responseEnd('a', {})
        const t = engine.transactions.get('a')!
        expect(toRow(t)).toMatchObject({ note: '更新备注', marked: true })
        expect(listener).toHaveBeenCalledWith({ type: 'transaction', transaction: t })
        engine.annotate('a', { marked: false })
        expect(t.note).toBe('更新备注')
        engine.annotate('a', { note: '' })
        expect(t.note).toBeUndefined()
        expect(t.marked).toBe(false)
    })
    it('rejects invalid and missing records without partially changing annotations', async () => {
        const engine = await setup()
        expect(() => engine.annotate('a', { note: 'x'.repeat(2001), marked: true })).toThrow()
        expect(engine.transactions.get('a')?.marked).toBeUndefined()
        engine.clear()
        expect(() => engine.annotate('a', { note: 'lost' })).toThrow('no longer available')
    })
})
