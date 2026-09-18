// gRPC message decoding for the capture engine: frames, compression, gRPC-Web trailers,
// and protobuf decoding with the user's .proto schema or, failing that, by field number.
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { gunzipSync, inflateSync } from 'node:zlib'
import protobuf from 'protobufjs'
import type { GrpcInfo, GrpcMessage, Headers, Transaction } from '../shared/model'
import { decodeRaw, splitFrames } from '../shared/protoRaw'

const header = (headers: Headers, name: string) =>
    Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1]

export interface GrpcContentType {
    web: boolean
    /** gRPC-Web with a base64 body (`application/grpc-web-text`). */
    text: boolean
    json: boolean
}

/** Recognise the gRPC family of media types; `undefined` for anything else. */
export function grpcContentType(headers: Headers): GrpcContentType | undefined {
    const type = (header(headers, 'content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!type.startsWith('application/grpc')) return undefined
    const [family, format = 'proto'] = type.slice('application/'.length).split('+')
    if (!['grpc', 'grpc-web', 'grpc-web-text'].includes(family)) return undefined
    return { web: family !== 'grpc', text: family === 'grpc-web-text', json: format === 'json' }
}

const TRAILER_FLAG = 0x80
const COMPRESSED_FLAG = 0x01

function decompress(data: Uint8Array, encoding: string | undefined): Uint8Array {
    switch ((encoding ?? '').toLowerCase()) {
        case 'gzip':
            return gunzipSync(data)
        case 'deflate':
            return inflateSync(data)
        case '':
        case 'identity':
            throw new Error('frame is compressed but no grpc-encoding was sent')
        default:
            throw new Error(`unsupported grpc-encoding ${encoding}`)
    }
}

/** Trailer frame body: `key: value` lines like HTTP headers. */
function parseTrailers(data: Uint8Array): Headers {
    const trailers: Headers = {}
    for (const line of Buffer.from(data).toString('utf8').split(/\r?\n/)) {
        const at = line.indexOf(':')
        if (at > 0) trailers[line.slice(0, at).trim()] = line.slice(at + 1).trim()
    }
    return trailers
}

/**
 * Loads .proto files once per settings change and decorates transactions with
 * decoded gRPC messages as their bodies are sealed.
 */
export class GrpcDecoder {
    private root?: protobuf.Root
    private files: string[] = []

    constructor(private log: (message: string, level?: 'info' | 'warn' | 'error') => void) {}

    /** (Re)load the schema; a failing file keeps the previous schema and is reported. */
    async load(files: string[]) {
        const unique = [...new Set(files)].sort()
        if (!unique.length) {
            if (this.root) this.log('gRPC schema unloaded')
            this.root = undefined
            this.files = []
            return
        }
        const dirs = [...new Set(unique.map((f) => dirname(f)))]
        const root = new protobuf.Root()
        root.resolvePath = (origin, target) => {
            if (isAbsolute(target)) return target
            const candidates = [
                ...(origin ? [join(dirname(origin), target)] : []),
                ...dirs.map((d) => join(d, target))
            ]
            return candidates.find((c) => existsSync(c)) ?? candidates[0]
        }
        try {
            await root.load(unique, { keepCase: true, alternateCommentMode: true })
            root.resolveAll()
        } catch (error) {
            this.log(
                `gRPC schema not loaded: ${error instanceof Error ? error.message : error}`,
                'warn'
            )
            return
        }
        this.root = root
        this.files = unique
        const services = count(root, (o) => o instanceof protobuf.Service)
        this.log(`gRPC schema loaded: ${unique.length} files, ${services} services`)
    }

    private method(info: GrpcInfo) {
        if (!this.root) return undefined
        try {
            const service = this.root.lookupService(info.service)
            const method = service.methods[info.method]
            if (!method) return undefined
            method.resolve()
            return method
        } catch {
            return undefined
        }
    }

    /** Attach decoded messages for one side; called once the side's body is sealed. */
    decorate(t: Transaction, side: 'request' | 'response', body: Buffer) {
        const headers = side === 'request' ? t.requestHeaders : t.responseHeaders
        const content = grpcContentType(headers) ?? grpcContentType(t.requestHeaders)
        if (!content) return
        const [, service = '', method = ''] = /^\/([^/]+)\/([^/?]+)/.exec(t.path) ?? []
        const info: GrpcInfo = t.grpc ?? {
            service,
            method,
            web: content.web,
            request: [],
            response: []
        }
        t.grpc = info
        const encoding = header(headers, 'grpc-encoding')
        if (encoding) info.encoding = encoding
        const bytes = content.text ? Buffer.from(body.toString('latin1'), 'base64') : body
        const { frames } = splitFrames(bytes)
        const rpc = this.method(info)
        if (rpc) {
            info.requestType = rpc.resolvedRequestType?.fullName.replace(/^\./, '')
            info.responseType = rpc.resolvedResponseType?.fullName.replace(/^\./, '')
        }
        const type = side === 'request' ? rpc?.resolvedRequestType : rpc?.resolvedResponseType
        const messages: GrpcMessage[] = []
        for (const frame of frames) {
            if (frame.flags & TRAILER_FLAG) {
                t.responseTrailers = { ...t.responseTrailers, ...parseTrailers(frame.data) }
                continue
            }
            const message: GrpcMessage = {
                index: messages.length + 1,
                size: frame.data.length,
                compressed: (frame.flags & COMPRESSED_FLAG) !== 0
            }
            messages.push(message)
            let data = frame.data
            try {
                if (message.compressed) data = decompress(data, encoding)
                if (content.json) {
                    message.body = JSON.parse(Buffer.from(data).toString('utf8'))
                    continue
                }
                if (type) {
                    message.type = type.fullName.replace(/^\./, '')
                    message.body = type.toObject(type.decode(data), {
                        longs: String,
                        enums: String,
                        bytes: String,
                        oneofs: true
                    })
                    continue
                }
            } catch (error) {
                message.error = error instanceof Error ? error.message : String(error)
                message.type = undefined
            }
            if (message.body === undefined) message.body = decodeRaw(data)
        }
        info[side] = messages
        if (side === 'response') {
            const source = t.responseTrailers ?? t.responseHeaders
            const status = header(source, 'grpc-status') ?? header(t.responseHeaders, 'grpc-status')
            if (status !== undefined && /^\d+$/.test(status)) info.status = Number(status)
            const text = header(source, 'grpc-message') ?? header(t.responseHeaders, 'grpc-message')
            if (text) {
                try {
                    info.statusMessage = decodeURIComponent(text)
                } catch {
                    info.statusMessage = text
                }
            }
        }
    }
}

function count(root: protobuf.NamespaceBase, test: (o: protobuf.ReflectionObject) => boolean) {
    let n = 0
    const walk = (ns: protobuf.NamespaceBase) => {
        for (const child of ns.nestedArray) {
            if (test(child)) n++
            if (child instanceof protobuf.Namespace) walk(child)
        }
    }
    walk(root)
    return n
}
