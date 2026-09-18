import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { Engine } from '../core/engine'
import { CORE, settled, startEngine } from './helpers'

const describeCore = existsSync(CORE) ? describe : describe.skip

/** Minimal RFC 6455 text frame (unmasked, server→client or masked client→server). */
function frame(text: string, mask: boolean) {
    const payload = Buffer.from(text)
    const header = Buffer.from([0x81, (mask ? 0x80 : 0) | payload.length])
    if (!mask) return Buffer.concat([header, payload])
    const key = randomBytes(4)
    const masked = Buffer.from(payload.map((b, i) => b ^ key[i % 4]))
    return Buffer.concat([header, key, masked])
}
/** Incremental parser for small frames (payload < 126 bytes); returns complete text payloads. */
class FrameParser {
    private buffer = Buffer.alloc(0)
    push(data: Buffer): string[] {
        this.buffer = Buffer.concat([this.buffer, data])
        const frames: string[] = []
        while (this.buffer.length >= 2) {
            const masked = (this.buffer[1] & 0x80) !== 0
            const length = this.buffer[1] & 0x7f
            const start = masked ? 6 : 2
            if (this.buffer.length < start + length) break
            const payload = this.buffer.subarray(start, start + length)
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
            const parser = new FrameParser()
            // The proxy may reset the upstream socket after the close handshake
            // (ECONNRESET on Windows); without a listener that is an uncaught exception.
            socket.on('error', () => undefined)
            socket.on('data', (data: Buffer) => {
                if ((data[0] & 0x0f) === 0x8) return socket.end()
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
        await new Promise<void>((r) => socket.once('connect', r))
        socket.write(
            `GET http://127.0.0.1:${port}/socket HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`
        )
        const received: string[] = []
        const parser = new FrameParser()
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
        socket.write(Buffer.from([0x88, 0x80, 0, 0, 0, 0]))
        socket.end()
        const t = await settled(engine, (t) => t.path === '/socket')
        expect(t.status).toBe(101)
        // Both directions interleave freely; only the per-direction order is fixed.
        expect(t.frames.filter((f) => f.direction === 'send').map((f) => f.data)).toEqual([
            'one',
            'two'
        ])
        expect(t.frames.filter((f) => f.direction === 'receive').map((f) => f.data)).toEqual([
            'echo:one',
            'echo:two'
        ])
        expect(t.frames.every((f) => !f.binary)).toBe(true)
        expect(t.state).toBe('completed')
    })
})
