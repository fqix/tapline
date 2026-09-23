import { Duplex } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { Streams } from '../../core/streams'

describe('tunnel credit backpressure', () => {
    it.each(['credit', 'cancel', 'shutdown'] as const)(
        'releases an outstanding write on %s',
        async (action) => {
            const messages: Record<string, unknown>[] = []
            const streams = new Streams((message) => messages.push(message))
            const socket = Duplex.from({
                readable: streams.reader('tunnel:in'),
                writable: streams.writer('tunnel:out')
            })
            socket.on('error', () => {})
            socket.once('finish', () => socket.destroy())
            const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
            socket.end(Buffer.from('final bytes'))
            await vi.waitFor(() => expect(messages.some((m) => m.type === 'chunk')).toBe(true))
            expect(socket.writableFinished).toBe(false)
            expect(socket.destroyed).toBe(false)
            if (action === 'credit') streams.receive({ type: 'credit', stream: 'tunnel:out' })
            else if (action === 'cancel') streams.cancel('tunnel:')
            else streams.close()
            await closed
            expect(socket.destroyed).toBe(true)
            expect(messages.find((m) => m.type === 'chunk')?.data).toEqual(
                Buffer.from('final bytes')
            )
            streams.close()
        }
    )
})
