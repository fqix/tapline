import { describe, expect, it } from 'vitest'
import { SSEParser, type ParsedEvent } from '../../core/sse'

function parse(chunks: (string | Buffer)[], limit = 1024) {
    const events: ParsedEvent[] = []
    let truncated = 0
    const parser = new SSEParser(
        limit,
        (e) => events.push(e),
        () => truncated++
    )
    for (const chunk of chunks) parser.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    return { events, truncated }
}

describe('SSE parser', () => {
    it('dispatches events per the event-stream grammar', () => {
        const { events } = parse([
            '﻿: comment\r\n',
            'data: one\n\n',
            'event: tick\r\nid: 7\r\ndata: a\r\ndata:b\r\nretry: 250\r\n\r\n',
            'data\n\n',
            'id: bad\0id\ndata: last\n\n'
        ])
        expect(events).toEqual([
            { event: 'message', data: 'one', lastEventId: '', retry: undefined },
            { event: 'tick', data: 'a\nb', lastEventId: '7', retry: 250 },
            { event: 'message', data: '', lastEventId: '7', retry: 250 },
            { event: 'message', data: 'last', lastEventId: '7', retry: 250 }
        ])
    })
    it('reassembles lines and UTF-8 sequences split across chunks', () => {
        const text = Buffer.from('data: héllo wörld\n\n')
        const { events } = parse([text.subarray(0, 8), text.subarray(8, 9), text.subarray(9)])
        expect(events).toEqual([
            { event: 'message', data: 'héllo wörld', lastEventId: '', retry: undefined }
        ])
        expect(parse(['data: a', 'b', 'c\n', '\n']).events[0].data).toBe('abc')
    })
    it('never dispatches an unfinished event at EOF', () => {
        expect(parse(['data: pending\n']).events).toEqual([])
        expect(parse(['data: done\n\ndata: pending']).events).toHaveLength(1)
    })
    it('drops oversized events but keeps parsing the ones after', () => {
        const { events, truncated } = parse(
            ['data: ' + 'x'.repeat(40) + '\n\n', 'data: small\n\n'],
            16
        )
        expect(truncated).toBe(1)
        expect(events.map((e) => e.data)).toEqual(['small'])
    })
    it('ignores unknown fields and invalid retry values', () => {
        const { events } = parse(['foo: bar\nretry: soon\ndata: x\n\n'])
        expect(events).toEqual([{ event: 'message', data: 'x', lastEventId: '', retry: undefined }])
    })
})
