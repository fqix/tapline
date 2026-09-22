import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { Engine } from '../../core/engine'
import { CORE, settled, startEngine } from '../helpers/helpers'

const describeCore = existsSync(CORE) ? describe : describe.skip

/** Minimal RFC 6455 text frame (unmasked, server→client or masked client→server). */
function frame(text: string | Buffer, mask: boolean, binary = false) {
    const payload = Buffer.from(text)
    const header = Buffer.from([binary ? 0x82 : 0x81, (mask ? 0x80 : 0) | payload.length])
    if (!mask) return Buffer.concat([header, payload])
    const key = randomBytes(4)
    const masked = Buffer.from(payload.map((b, i) => b ^ key[i % 4]))
    return Buffer.concat([header, key, masked])
}
/** Incremental parser for small frames (payload < 126 bytes); returns complete text payloads. */
class FrameParser {
    private buffer = Buffer.alloc(0)
    constructor(private readonly onClose: () => void = () => {}) {}
    push(data: Buffer): string[] {
        this.buffer = Buffer.concat([this.buffer, data])
        const frames: string[] = []
        while (this.buffer.length >= 2) {
            const opcode = this.buffer[0] & 0x0f
            const masked = (this.buffer[1] & 0x80) !== 0
            const length = this.buffer[1] & 0x7f
            const start = masked ? 6 : 2
            if (this.buffer.length < start + length) break
            const payload = this.buffer.subarray(start, start + length)
            if (opcode === 8) {
                this.buffer = this.buffer.subarray(start + length)
                this.onClose()
                continue
            }
            if (masked) {
                const key = this.buffer.subarray(2, 6)
                frames.push(Buffer.from(payload.map((b, i) => b ^ key[i % 4])).toString())
            } else frames.push(payload.toString())
            this.buffer = this.buffer.subarray(start + length)
        }
        return frames
    }
}

describeCore('websocket relay', () => {
    let engine: Engine
    let server: http.Server
    let port: number

    beforeAll(async () => {
        server = http.createServer()
        server.on('upgrade', (req, socket) => {
            const accept = createHash('sha1')
                .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
                .digest('base64')
            socket.write(
                `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
            )
            const parser = new FrameParser(() => socket.end(Buffer.from([0x88, 0])))
            // The proxy may reset the upstream socket after the close handshake
            // (ECONNRESET on Windows); without a listener that is an uncaught exception.
            socket.on('error', () => undefined)
            socket.on('data', (data: Buffer) => {
                for (const text of parser.push(data)) socket.write(frame(`echo:${text}`, false))
            })
        })
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
        port = (server.address() as net.AddressInfo).port
        engine = await startEngine()
    }, 60000)
    afterAll(async () => {
        await engine?.stop()
        server?.close()
    })

    it('records both directions of a WebSocket session', async () => {
        const socket = net.connect(engine.settings.port, '127.0.0.1')
        const cleanup = () => socket.destroy()
        try {
            await new Promise<void>((r) => socket.once('connect', r))
            socket.write(
                `GET http://127.0.0.1:${port}/socket HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`
            )
            const received: string[] = []
            // Wait for the peer's Close frame before ending TCP.
            const parser = new FrameParser(() => socket.end())
            await new Promise<void>((resolve, reject) => {
                let buffer = Buffer.alloc(0)
                let upgraded = false
                let sentTwo = false
                socket.on('data', (data: Buffer) => {
                    if (upgraded) {
                        received.push(...parser.push(data))
                        if (received.length >= 1 && !sentTwo) {
                            sentTwo = true
                            socket.write(frame('two', true))
                        }
                        if (received.length >= 2) resolve()
                        return
                    }
                    buffer = Buffer.concat([buffer, data])
                    const end = buffer.indexOf('\r\n\r\n')
                    if (end < 0) return
                    if (!/^HTTP\/1\.1 101/.test(buffer.toString('latin1', 0, end)))
                        return reject(new Error(buffer.toString('latin1', 0, end)))
                    upgraded = true
                    const rest = buffer.subarray(end + 4)
                    if (rest.length) received.push(...parser.push(rest))
                    socket.write(frame('one', true))
                })
                socket.once('error', reject)
            })
            expect(received).toEqual(['echo:one', 'echo:two'])
            const live = [...engine.transactions.values()].find((t) => t.path === '/socket')!
            const original = live.frames.find((f) => f.direction === 'send' && f.data === 'one')!
            await engine.resendFrame(live.id, original.id)
            await vi.waitFor(() => expect(received).toContain('echo:one'), { timeout: 3000 })
            await vi.waitFor(() => expect(received.length).toBe(3), { timeout: 3000 })
            expect(live.frames.find((f) => f.replayOf === original.id)?.data).toBe('one')
            // A server message is not a client command and must never be resent upstream.
            await expect(
                engine.resendFrame(live.id, live.frames.find((f) => f.direction === 'receive')!.id)
            ).rejects.toThrow('Only outgoing')
            await expect(engine.resendFrame(live.id, 'expired')).rejects.toThrow(
                'no longer retained'
            )

            const binary = Buffer.from([0, 1, 255])
            socket.write(frame(binary, true, true))
            await vi.waitFor(() =>
                expect(live.frames.some((f) => f.binary && f.direction === 'send')).toBe(true)
            )
            const binaryFrame = live.frames.find((f) => f.binary && f.direction === 'send')!
            await engine.resendFrame(live.id, binaryFrame.id)
            await vi.waitFor(() => expect(received.length).toBe(5))
            expect(live.frames.find((f) => f.replayOf === binaryFrame.id)).toMatchObject({
                binary: true,
                data: binary.toString('base64'),
                size: 3
            })

            engine.settings.maxBodyBytes = 2
            socket.write(frame('oversized', true))
            await vi.waitFor(() => expect(live.frames.some((f) => f.truncated)).toBe(true))
            const truncated = live.frames.find((f) => f.direction === 'send' && f.truncated)!
            expect(truncated).toMatchObject({ data: 'ov', size: 9 })
            await expect(engine.resendFrame(live.id, truncated.id)).rejects.toThrow('Truncated')
            engine.settings.maxBodyBytes = 512 * 1024
            await vi.waitFor(() => expect(received.length).toBe(6))

            socket.write(frame('', true))
            await vi.waitFor(() =>
                expect(live.frames.some((f) => f.direction === 'send' && f.data === '')).toBe(true)
            )
            await engine.resendFrame(
                live.id,
                live.frames.find((f) => f.direction === 'send' && f.data === '')!.id
            )
            await vi.waitFor(() => expect(received.length).toBe(8))
            socket.write(Buffer.from([0x88, 0x80, 0, 0, 0, 0]))
            const t = await settled(engine, (t) => t.path === '/socket')
            expect(t.status).toBe(101)
            // Both directions interleave freely; only the per-direction order is fixed.
            expect(
                t.frames
                    .filter((f) => f.direction === 'send')
                    .slice(0, 3)
                    .map((f) => f.data)
            ).toEqual(['one', 'two', 'one'])
            expect(
                t.frames
                    .filter((f) => f.direction === 'receive')
                    .slice(0, 3)
                    .map((f) => f.data)
            ).toEqual(['echo:one', 'echo:two', 'echo:one'])
            expect(t.state, t.error).toBe('completed')
            await expect(engine.resendFrame(t.id, original.id)).rejects.toThrow('closed')
        } finally {
            cleanup()
        }
    })
})
