export const bodyModes = [
    'none',
    'form-data',
    'x-www-form-urlencoded',
    'raw',
    'binary',
    'GraphQL'
] as const
export type BodyMode = (typeof bodyModes)[number]
export interface UploadPart {
    name: string
    value: string
    enabled: boolean
    type: 'text' | 'file'
    filename?: string
    contentType?: string
    base64?: string
}
export interface BodyDraft {
    mode: BodyMode
    parts?: UploadPart[]
    fileName?: string
    query?: string
    variables?: string
    operationName?: string
}

export function encodeBase64(bytes: Uint8Array): string {
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
    return btoa(binary)
}
export const decodeBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

/** Multipart uses CRLF framing while preserving each file's original bytes. */
export function multipartBody(parts: UploadPart[], boundary: string): string {
    const chunks: Uint8Array[] = []
    const text = (value: string) => chunks.push(new TextEncoder().encode(value))
    const quote = (value: string) =>
        value.replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/"/g, '%22')
    for (const part of parts) {
        if (!part.enabled || (!part.name && !part.value && !part.filename)) continue
        text(`--${boundary}\r\nContent-Disposition: form-data; name="${quote(part.name)}"`)
        if (part.type === 'file') {
            if (part.base64 === undefined) throw new Error(`Choose a file for "${part.name}"`)
            text(
                `; filename="${quote(part.filename ?? 'file')}"\r\nContent-Type: ${(part.contentType || 'application/octet-stream').replace(/[\r\n]/g, '')}`
            )
        }
        text('\r\n\r\n')
        if (part.type === 'file') chunks.push(decodeBase64(part.base64!))
        else text(part.value)
        text('\r\n')
    }
    text(`--${boundary}--\r\n`)
    const bytes = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0))
    let offset = 0
    for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.length
    }
    return encodeBase64(bytes)
}

export function graphqlBody(query: string, variables: string, operationName: string): string {
    const parsed: unknown = variables.trim() ? JSON.parse(variables) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('GraphQL variables must be a JSON object')
    return JSON.stringify({
        query,
        variables: parsed,
        ...(operationName.trim() ? { operationName: operationName.trim() } : {})
    })
}
