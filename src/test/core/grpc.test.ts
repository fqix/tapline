import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import protobuf from 'protobufjs'
import { GrpcDecoder, grpcContentType } from '../../core/grpc'
import type { Transaction } from '../../shared/model'
import { decode, decodeRaw, splitFrames } from '../../shared/protoRaw'

const PROTO = `
syntax = "proto3";
package demo;
import "google/protobuf/timestamp.proto";
enum Kind { PLAIN = 0; FANCY = 1; }
message Tag { string name = 1; int32 weight = 2; }
message HelloRequest { string greeting = 1; repeated Tag tags = 2; Kind kind = 3; bytes blob = 4; }
message HelloReply { string reply = 1; int64 big = 2; google.protobuf.Timestamp at = 3; }
service Hello { rpc SayHello (HelloRequest) returns (HelloReply); }
`

const frame = (data: Uint8Array, flags = 0) => {
    const head = Buffer.alloc(5)
    head[0] = flags
    head.writeUInt32BE(data.length, 1)
    return Buffer.concat([head, data])
}

const dir = mkdtempSync(join(tmpdir(), 'tapline-proto-'))
writeFileSync(join(dir, 'hello.proto'), PROTO)
/** Encoder-side schema; `loadSync` supplies the bundled google/protobuf imports. */
const root = protobuf.loadSync(join(dir, 'hello.proto'))

const transaction = (path: string, extra: Partial<Transaction> = {}): Transaction => ({
    id: 'g1',
    sequence: 1,
    timestamp: 0,
    method: 'POST',
    url: `https://grpc.example.com${path}`,
    host: 'grpc.example.com',
    path,
    scheme: 'https',
    httpVersion: '2',
    client: '127.0.0.1:1',
    state: 'pending',
    status: 200,
    requestHeaders: { 'content-type': 'application/grpc' },
    responseHeaders: { 'content-type': 'application/grpc' },
    requestBody: '',
    responseBody: '',
    requestBinary: true,
    responseBinary: true,
    requestBytes: 0,
    responseBytes: 0,
    truncated: false,
    duration: 0,
    tls: true,
    frames: [],
    ...extra
})

describe('protobuf raw decoding', () => {
    it('decodes varints, strings, nested messages, fixed fields and repeats', () => {
        const Request = root.lookupType('demo.HelloRequest')
        const bytes = Request.encode(
            Request.create({
                greeting: 'hi',
                tags: [
                    { name: 'a', weight: 1 },
                    { name: 'b', weight: 300 }
                ],
                kind: 1,
                blob: Buffer.from([0, 255, 1])
            })
        ).finish()
        expect(decode(bytes)).toEqual({
            '1': 'hi',
            '2': [
                { '1': 'a', '2': 1 },
                { '1': 'b', '2': 300 }
            ],
            '3': 1,
            '4': { bytes: Buffer.from([0, 255, 1]).toString('base64') }
        })
        // fixed64 / fixed32 wire types
        const fixed = Buffer.from([0x09, 1, 0, 0, 0, 0, 0, 0, 0, 0x15, 2, 0, 0, 0])
        expect(decode(fixed)).toEqual({ '1': 1, '2': 2 })
        expect(decodeRaw(Buffer.from('not protobuf at all'))).toBeUndefined()
        expect(decodeRaw(Buffer.from([0x08]))).toBeUndefined()
    })

    it('splits length-prefixed frames and reports a partial tail', () => {
        const a = Buffer.from([1, 2, 3])
        const b = Buffer.from([4])
        const whole = Buffer.concat([frame(a), frame(b, 1)])
        expect(splitFrames(whole)).toEqual({
            frames: [
                { flags: 0, data: a },
                { flags: 1, data: b }
            ],
            incomplete: false
        })
        expect(splitFrames(whole.subarray(0, whole.length - 1)).incomplete).toBe(true)
        expect(splitFrames(whole.subarray(0, whole.length - 1)).frames).toHaveLength(1)
    })

    it('recognises the gRPC media types', () => {
        expect(grpcContentType({ 'Content-Type': 'application/grpc' })).toEqual({
            web: false,
            text: false,
            json: false
        })
        expect(grpcContentType({ 'content-type': 'application/grpc+proto' })?.web).toBe(false)
        expect(grpcContentType({ 'content-type': 'application/grpc-web-text+proto' })).toEqual({
            web: true,
            text: true,
            json: false
        })
        expect(grpcContentType({ 'content-type': 'application/grpc+json' })?.json).toBe(true)
        expect(grpcContentType({ 'content-type': 'application/json' })).toBeUndefined()
        expect(grpcContentType({})).toBeUndefined()
    })
})

describe('GrpcDecoder', () => {
    const Request = root.lookupType('demo.HelloRequest')
    const Reply = root.lookupType('demo.HelloReply')
    const request = Request.encode(Request.create({ greeting: 'hi', kind: 1 })).finish()
    const reply = Reply.encode(
        Reply.fromObject({ reply: 'hello', big: '9007199254740993' })
    ).finish()

    it('decodes by field number without a schema', () => {
        const decoder = new GrpcDecoder(() => {})
        const t = transaction('/demo.Hello/SayHello')
        decoder.decorate(t, 'request', frame(request))
        t.responseTrailers = { 'grpc-status': '0' }
        decoder.decorate(t, 'response', Buffer.concat([frame(reply), frame(reply)]))
        expect(t.grpc).toMatchObject({
            service: 'demo.Hello',
            method: 'SayHello',
            web: false,
            status: 0,
            request: [{ index: 1, compressed: false, body: { '1': 'hi', '3': 1 } }]
        })
        expect(t.grpc!.response).toHaveLength(2)
        expect(t.grpc!.response[1].body).toEqual({ '1': 'hello', '2': '9007199254740993' })
        expect(t.grpc!.request[0].type).toBeUndefined()
    })

    it('decodes with names and enums once the schema is loaded', async () => {
        const logs: string[] = []
        const decoder = new GrpcDecoder((m) => logs.push(m))
        await decoder.load([join(dir, 'hello.proto')])
        expect(logs[0]).toContain('1 files, 1 services')
        const t = transaction('/demo.Hello/SayHello', {
            responseHeaders: { 'content-type': 'application/grpc', 'grpc-encoding': 'gzip' }
        })
        decoder.decorate(t, 'request', frame(request))
        t.responseTrailers = { 'grpc-status': '5', 'grpc-message': 'no%20such%20user' }
        decoder.decorate(t, 'response', frame(gzipSync(reply), 1))
        expect(t.grpc).toMatchObject({
            requestType: 'demo.HelloRequest',
            responseType: 'demo.HelloReply',
            encoding: 'gzip',
            status: 5,
            statusMessage: 'no such user',
            request: [{ type: 'demo.HelloRequest', body: { greeting: 'hi', kind: 'FANCY' } }],
            response: [
                {
                    compressed: true,
                    type: 'demo.HelloReply',
                    body: { reply: 'hello', big: '9007199254740993' }
                }
            ]
        })
    })

    it('falls back to field numbers for unknown methods and keeps a broken schema out', async () => {
        const logs: string[] = []
        const decoder = new GrpcDecoder((m) => logs.push(m))
        await decoder.load([join(dir, 'hello.proto')])
        writeFileSync(join(dir, 'broken.proto'), 'syntax = "proto3"; message {')
        await decoder.load([join(dir, 'hello.proto'), join(dir, 'broken.proto')])
        expect(logs.at(-1)).toContain('gRPC schema not loaded')
        const t = transaction('/demo.Other/Nope')
        decoder.decorate(t, 'request', frame(request))
        expect(t.grpc!.request[0]).toMatchObject({ body: { '1': 'hi', '3': 1 } })
        // The earlier schema still decodes known methods.
        const known = transaction('/demo.Hello/SayHello')
        decoder.decorate(known, 'request', frame(request))
        expect(known.grpc!.request[0].type).toBe('demo.HelloRequest')
    })

    it('reads gRPC-Web trailers from the body', () => {
        const decoder = new GrpcDecoder(() => {})
        const t = transaction('/demo.Hello/SayHello', {
            requestHeaders: { 'content-type': 'application/grpc-web-text' },
            responseHeaders: { 'content-type': 'application/grpc-web-text' }
        })
        const body = Buffer.concat([
            frame(reply),
            frame(Buffer.from('grpc-status: 3\r\ngrpc-message: bad\r\n'), 0x80)
        ])
        decoder.decorate(t, 'response', Buffer.from(body.toString('base64')))
        expect(t.responseTrailers).toEqual({ 'grpc-status': '3', 'grpc-message': 'bad' })
        expect(t.grpc).toMatchObject({ web: true, status: 3, statusMessage: 'bad' })
        expect(t.grpc!.response).toHaveLength(1)
    })
})
