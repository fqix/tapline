import { describe, expect, it } from 'vitest'
import {
    eventSearchText,
    frameSize,
    grpcText,
    matchesMessage,
    resendUnavailable
} from '../../webview/lib/messages'
import type { Frame } from '../../shared/model'

const frame: Frame = { id: '1', time: 0, direction: 'send', binary: false, data: '你好' }

describe('stream message inspection', () => {
    it('searches literal Unicode text and punctuation without regex interpretation', () => {
        expect(matchesMessage('Hello 你好 [event]', ' HELLO ')).toBe(true)
        expect(matchesMessage('Hello 你好 [event]', '[event]')).toBe(true)
        expect(matchesMessage('Hello 你好 [event]', '你好')).toBe(true)
        expect(matchesMessage('Hello', '.*')).toBe(false)
    })
    it('includes SSE event names, IDs and retry values in searches', () => {
        const text = eventSearchText({
            id: '1',
            time: 0,
            event: 'delta',
            data: 'hello',
            lastEventId: 'cursor-9',
            retry: 1234
        })
        for (const query of ['DELTA', 'cursor-9', '1234', 'hello'])
            expect(matchesMessage(text, query)).toBe(true)
    })
    it('counts UTF-8 and padded Base64 bytes accurately, preserving original truncated size', () => {
        expect(frameSize(frame)).toBe(6)
        for (const [data, size] of [
            ['', 0],
            ['YQ==', 1],
            ['YWI=', 2],
            ['YWJj', 3]
        ] as const)
            expect(frameSize({ ...frame, binary: true, data })).toBe(size)
        expect(frameSize({ ...frame, size: 100, truncated: true })).toBe(100)
    })
    it('copies structured gRPC messages and decoding errors without losing falsy values', () => {
        const message = { index: 1, size: 0, compressed: false }
        expect(grpcText({ ...message, body: false })).toBe('false')
        expect(grpcText({ ...message, body: null })).toBe('null')
        expect(grpcText({ ...message, error: 'decode failed' })).toBe('decode failed')
    })
    it('only permits complete outgoing messages on an open connection', () => {
        expect(resendUnavailable(frame, true)).toBeUndefined()
        expect(resendUnavailable(frame, false)).toBe('streamClosed')
        expect(resendUnavailable({ ...frame, direction: 'receive' }, true)).toBe(
            'streamReceiveOnly'
        )
        expect(resendUnavailable({ ...frame, truncated: true }, true)).toBe('streamTruncatedResend')
        expect(resendUnavailable({ ...frame, binary: true, data: '' }, true)).toBeUndefined()
    })
})
