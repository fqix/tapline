// Turn a curl command into a composer draft with curlconverter: its HTTP generator
// renders exactly the request curl would send (query merged by -G, Basic auth from -u,
// cookies, multipart from -F), and its JSON generator supplies the absolute URL.
import { toHTTPWarn } from 'curlconverter/dist/src/generators/http.js'
import { toJsonObjectWarn } from 'curlconverter/dist/src/generators/json.js'
import { parse, type Request } from 'curlconverter/dist/src/parse.js'
import type { Warnings } from 'curlconverter/dist/src/Warnings.js'
import parser, { ready } from './curlParser'

/** Reads a file named on the command line (`-d @file`), or undefined when it cannot. */
export type FileReader = (name: string) => Promise<Buffer | undefined>

export interface CurlImport {
    method: string
    url: string
    /** `Name: value` per line, as the composer stores them. */
    headers: string
    body: string
    warnings: string[]
}

/** Does the text look like a curl invocation (optionally after a `$ ` prompt)? */
export const looksLikeCurl = (text: string) => /^\s*(\$\s*)?curl(\.exe)?\s/i.test(text)

/** Options curl accepts that do not change the request; their warnings are noise. */
const harmless = new Set([
    'silent',
    'show-error',
    'verbose',
    'location',
    'insecure',
    'output',
    'remote-name',
    'include',
    'fail',
    'max-time',
    'connect-timeout',
    'retry',
    'progress-bar',
    'no-progress-meter',
    'write-out',
    'globoff',
    'http1.1',
    'http2',
    'compressed'
])

function describe(warnings: Warnings): string[] {
    return warnings.filter(([code]) => !harmless.has(code)).map(([, message]) => message)
}

/** Accept a standalone Markdown URL copied from documentation, outside shell strings. */
function unwrapUrlLines(command: string): string {
    const tree = parser.parse(command)
    if (!tree) return command
    try {
        const starts = new Set(tree.rootNode.namedChildren.map((node) => node.startIndex))
        return command.replace(
            /^([\t ]*)\[[^\]\r\n]+\]\((https?:\/\/[^\s]+)\)[\t ]*\r?$/gm,
            (line, indent: string, url: string, offset: number) => {
                if (!starts.has(offset + indent.length)) return line
                // Quote the destination so URL query characters stay literal shell data.
                return indent + "'" + url.replace(/'/g, "'\\''") + "'"
            }
        )
    } finally {
        tree.delete()
    }
}

/** ReqBin wraps options and URLs without shell continuations. Join only top-level
 * commands; the bash syntax tree keeps quoted body newlines and shell syntax intact. */
function joinOptionLines(command: string): string {
    const tree = parser.parse(command)
    if (!tree) return command
    try {
        const nodes = tree.rootNode.namedChildren
        const gaps: [number, number][] = []
        let inCurl = false
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i]
            const previous = nodes[i - 1]
            if (
                inCurl &&
                previous &&
                node.type === 'command' &&
                /^(?:--?[a-zA-Z]|['"]?https?:\/\/)/.test(node.text) &&
                /^[\t \r\n]*\n[\t \r\n]*$/.test(command.slice(previous.endIndex, node.startIndex))
            ) {
                gaps.push([previous.endIndex, node.startIndex])
            } else {
                inCurl = node.type === 'command' && looksLikeCurl(node.text)
            }
        }
        for (const [start, end] of gaps.reverse())
            command = command.slice(0, start) + ' ' + command.slice(end)
        return command
    } finally {
        tree.delete()
    }
}

/**
 * curl's `@file` data options, resolved through `readFile`: `-d` drops CR/LF from the
 * file, `--data-binary` / `--json` send it as is, `--data-urlencode` encodes it
 * (prefixed with `name=` when given). The parts already carry curl's `&` joins. Returns
 * undefined when the command reads no file, so the generator's body stands.
 */
async function fileBody(
    request: Request | undefined,
    readFile: FileReader | undefined,
    warnings: string[]
): Promise<string | undefined> {
    const params = request?.dataArray
    if (!params || !params.some((p) => typeof p === 'object' && 'filetype' in p)) return undefined
    const parts: string[] = []
    for (const param of params) {
        if (!(typeof param === 'object' && 'filetype' in param)) {
            parts.push(param.toString())
            continue
        }
        const name = param.filename.toString()
        const bytes = readFile ? await readFile(name) : undefined
        if (!bytes) {
            warnings.push(`could not read "${name}"; sent literally`)
            parts.push(`${param.name ? `${param.name}=` : ''}@${name}`)
            continue
        }
        let content = bytes.toString('utf8')
        if (Buffer.from(content, 'utf8').length !== bytes.length || content.includes('\uFFFD'))
            warnings.push(`"${name}" is not UTF-8 text; its bytes may not survive the editor`)
        if (param.filetype === 'data') content = content.replace(/[\r\n]/g, '')
        if (param.filetype === 'urlencode')
            content = `${param.name ? `${param.name}=` : ''}${encodeURIComponent(content)}`
        parts.push(content)
    }
    return parts.join('')
}

export async function importCurl(text: string, readFile?: FileReader): Promise<CurlImport> {
    await ready
    const command = joinOptionLines(unwrapUrlLines(text.replace(/^\s*\$\s*/, '')))
    const request = parse(command)[0]
    const [http, httpWarnings] = toHTTPWarn(command)
    const [json] = toJsonObjectWarn(command)
    const separator = http.indexOf('\n\n')
    const head = http.slice(0, separator)
    const lines = head.split(/\r?\n/)
    const method = lines[0].split(' ')[0]
    const headers: string[] = []
    for (const line of lines.slice(1)) {
        const at = line.indexOf(':')
        if (at <= 0) continue
        const name = line.slice(0, at).trim()
        const value = line.slice(at + 1).trim()
        // The HTTP generator adds a synthetic user agent even when curl explicitly
        // removed it (-H 'User-Agent:'). Only import a user agent present in the request.
        if (name.toLowerCase() === 'user-agent' && !request.headers.has('User-Agent')) continue
        // The agent sets Content-Length itself; keep everything else curl would send.
        if (name.toLowerCase() !== 'content-length') headers.push(`${name}: ${value}`)
    }
    // Remove only the generator's final newline. A supplied Content-Length can be
    // stale, and splitting the body would alter embedded CRLF paragraph breaks.
    let body = http.slice(separator + 2, -1)
    const url = String(
        (json as { raw_url?: string }).raw_url ?? (json as { url?: string }).url ?? ''
    )
    const warnings = describe(httpWarnings)
    for (const part of request.multipartUploads ?? []) {
        if ('contentFile' in part)
            warnings.push(
                `multipart file "${part.contentFile}" was not imported; replace the placeholder before sending`
            )
    }
    const fromFiles = await fileBody(request, readFile, warnings)
    if (fromFiles !== undefined) {
        body = fromFiles
        // The generator's warning about the literal "@file" no longer applies.
        const literal = /means read the file/
        for (let i = warnings.length - 1; i >= 0; i--)
            if (literal.test(warnings[i])) warnings.splice(i, 1)
    }
    return { method, url, headers: headers.join('\n'), body, warnings }
}
