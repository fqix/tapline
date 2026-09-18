// Schema-less protobuf wire-format decoder (like `protoc --decode_raw`). Browser-safe.

export type RawValue = number | string | RawMessage | RawValue[] | { bytes: string }
export interface RawMessage {
    [field: string]: RawValue
}

const decoder = new TextDecoder('utf-8', { fatal: true })

class Reader {
    pos = 0
    constructor(private bytes: Uint8Array) {}
    get done() {
        return this.pos >= this.bytes.length
    }
    varint(): bigint {
        let result = 0n
        let shift = 0n
        for (;;) {
            if (this.pos >= this.bytes.length) throw new Error('truncated varint')
            const byte = this.bytes[this.pos++]
            result |= BigInt(byte & 0x7f) << shift
            if (!(byte & 0x80)) return result
            shift += 7n
            if (shift > 63n) throw new Error('varint too long')
        }
    }
    take(n: number): Uint8Array {
        if (this.pos + n > this.bytes.length) throw new Error('truncated field')
        const slice = this.bytes.subarray(this.pos, this.pos + n)
        this.pos += n
        return slice
    }
}

// Node Buffers share a pool, so the view must honour the byte offset.
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

const number = (value: bigint): number | string =>
    value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString()

/** Text that a human would recognise as text: valid UTF-8 without control characters. */
function printable(bytes: Uint8Array): string | undefined {
    if (bytes.length === 0) return ''
    let text: string
    try {
        text = decoder.decode(bytes)
    } catch {
        return undefined
    }
    // eslint-disable-next-line no-control-regex
    return /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) ? undefined : text
}

const base64 = (bytes: Uint8Array) =>
    typeof Buffer !== 'undefined'
        ? Buffer.from(bytes).toString('base64')
        : btoa(String.fromCharCode(...bytes))

function bytesValue(bytes: Uint8Array): RawValue {
    const text = printable(bytes)
    if (text !== undefined) return text
    const nested = tryDecode(bytes)
    if (nested) return nested
    return { bytes: base64(bytes) }
}

function tryDecode(bytes: Uint8Array): RawMessage | undefined {
    try {
        const message = decode(bytes)
        return Object.keys(message).length ? message : undefined
    } catch {
        return undefined
    }
}

/** Decodes one message; throws when the bytes are not a well-formed message. */
export function decode(bytes: Uint8Array): RawMessage {
    const reader = new Reader(bytes)
    const message: RawMessage = {}
    const add = (field: bigint, value: RawValue) => {
        const key = field.toString()
        const existing = message[key]
        if (existing === undefined) message[key] = value
        else if (Array.isArray(existing)) existing.push(value)
        else message[key] = [existing, value]
    }
    while (!reader.done) {
        const tag = reader.varint()
        const field = tag >> 3n
        const wire = Number(tag & 7n)
        if (field < 1n || field > 536870911n) throw new Error(`bad field number ${field}`)
        switch (wire) {
            case 0:
                add(field, number(reader.varint()))
                break
            case 1: {
                add(field, number(view(reader.take(8)).getBigUint64(0, true)))
                break
            }
            case 2: {
                const length = Number(reader.varint())
                add(field, bytesValue(reader.take(length)))
                break
            }
            case 5:
                add(field, view(reader.take(4)).getUint32(0, true))
                break
            default:
                throw new Error(`unsupported wire type ${wire}`)
        }
    }
    return message
}

/** `decode` that never throws: an invalid message yields `undefined`. */
export function decodeRaw(bytes: Uint8Array): RawMessage | undefined {
    try {
        return decode(bytes)
    } catch {
        return undefined
    }
}

export interface Frame {
    flags: number
    data: Uint8Array
}

/** Split a gRPC body into its length-prefixed frames; a partial final frame is dropped. */
export function splitFrames(body: Uint8Array): { frames: Frame[]; incomplete: boolean } {
    const frames: Frame[] = []
    let offset = 0
    while (offset + 5 <= body.length) {
        const flags = body[offset]
        const length =
            ((body[offset + 1] << 24) |
                (body[offset + 2] << 16) |
                (body[offset + 3] << 8) |
                body[offset + 4]) >>>
            0
        if (offset + 5 + length > body.length) break
        frames.push({ flags, data: body.subarray(offset + 5, offset + 5 + length) })
        offset += 5 + length
    }
    return { frames, incomplete: offset < body.length }
}
