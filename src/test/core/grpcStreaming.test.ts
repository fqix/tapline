import { afterEach, describe, expect, it, vi } from 'vitest'
import { Engine } from '../../core/engine'

const message = (text: string) => {
    const body = Buffer.from(JSON.stringify({ text }))
    const header = Buffer.alloc(5)
    header.writeUInt32BE(body.length, 1)
    return Buffer.concat([header, body])
}

async function setup() {
    const engine = new Engine('/unused', '/unused')
    await engine.request('stream', {
        method: 'POST',
        url: 'http://localhost/demo.Chat/Watch',
        headers: { 'content-type': 'application/grpc+json' },
        client: { remoteAddress: '127.0.0.1', remotePort: 1 },
        body: async () => Buffer.alloc(0)
    })
    await engine.response('stream', {
        status: 200,
        statusMessage: 'OK',
        headers: { 'content-type': 'application/grpc+json' },
        body: async () => Buffer.alloc(0)
    })
    return engine
}

describe('live gRPC messages', () => {
    afterEach(() => vi.useRealTimers())
    it('publishes complete messages before EOF, without decoding a partial tail', async () => {
        vi.useFakeTimers()
        const engine = await setup()
        const one = message('你好'),
            two = message('second')
        engine.requestData('stream', one)
        engine.responseData('stream', Buffer.concat([one, two.subarray(0, 7)]))
        await vi.advanceTimersByTimeAsync(100)
        const t = engine.transactions.get('stream')!
        expect(t.state).toBe('pending')
        expect(t.grpc?.request.map((m) => m.body)).toEqual([{ text: '你好' }])
        expect(t.grpc?.response.map((m) => m.body)).toEqual([{ text: '你好' }])
        engine.responseData('stream', two.subarray(7))
        await vi.advanceTimersByTimeAsync(100)
        expect(t.grpc?.response.map((m) => m.body)).toEqual([{ text: '你好' }, { text: 'second' }])
        engine.requestEnd('stream')
        engine.responseEnd('stream', { 'grpc-status': '0' })
        await vi.advanceTimersByTimeAsync(200)
        expect(t.grpc?.response).toHaveLength(2)
        expect(t.grpc?.status).toBe(0)
        expect(t.state).toBe('completed')
    })
    it('does not revive a cleared transaction or overwrite a sealed body', async () => {
        vi.useFakeTimers()
        const engine = await setup()
        engine.responseData('stream', message('last'))
        engine.responseEnd('stream', {})
        await vi.advanceTimersByTimeAsync(100)
        expect(engine.transactions.get('stream')?.grpc?.response[0].body).toEqual({ text: 'last' })
        engine.clear()
        await vi.advanceTimersByTimeAsync(100)
        expect(engine.transactions.size).toBe(0)
    })
})
