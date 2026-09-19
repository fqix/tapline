import { type Headers, type Transaction } from '../shared/model'

/** Format JSON tokens without rounding large integers or changing numeric precision. */
function prettyJson(text: string): string {
    try {
        JSON.parse(text)
    } catch {
        return text
    }
    const tokens =
        text.match(
            /"(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\],:]/g
        ) ?? []
    let depth = 0
    let result = ''
    const newline = () => '\n' + '  '.repeat(depth)
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]
        if (token === '{' || token === '[') {
            result += token
            if (tokens[i + 1] === (token === '{' ? '}' : ']')) result += tokens[++i]
            else {
                depth++
                result += newline()
            }
        } else if (token === '}' || token === ']') {
            depth--
            result += newline() + token
        } else if (token === ',') result += ',' + newline()
        else if (token === ':') result += ': '
        else result += token
    }
    return result
}

/** Stable HTTP snapshot: omit capture metadata, preserve all captured header values. */
export function renderComparison(t: Transaction): string {
    const headers = (values: Headers) =>
        Object.entries(values)
            .map(([name, value]) => [name.toLowerCase(), value])
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([name, value]) => `${name}: ${value}`)
            .join('\n')
    const body = (value: string, binary: boolean) =>
        binary ? `(Base64)\n${value.match(/.{1,76}/g)?.join('\n') ?? ''}` : prettyJson(value)
    const version = `HTTP/${t.httpVersion || '1.1'}`
    const parts = [
        '### Request',
        `${t.method} ${t.url} ${version}`,
        headers(t.requestHeaders),
        '',
        body(t.requestBody, t.requestBinary),
        '',
        '### Response',
        `${version} ${t.status ?? '(no response)'} ${t.statusMessage ?? ''}`.trimEnd(),
        headers(t.responseHeaders),
        '',
        body(t.responseBody, t.responseBinary)
    ]
    if (t.responseTrailers && Object.keys(t.responseTrailers).length)
        parts.push('', '### Trailers', headers(t.responseTrailers))
    if (t.state === 'pending') parts.push('', '### Capture incomplete (request still pending)')
    if (t.truncated) parts.push('', '### Body truncated: comparing retained content only')
    if (t.scheme === 'connect') parts.push('', '### TLS tunnel: HTTP content was not decrypted')
    if (t.error) parts.push('', '### Error', t.error)
    return parts.join('\n') + '\n'
}
