// Parse a `curl` command line (as browsers' "Copy as cURL" or a shell history produce
// it) into a request the composer can edit. Browser-safe: no node imports.

export interface ParsedCurl {
    method: string
    url: string
    /** Ordered, duplicates kept, as `[name, value]`. */
    headers: [string, string][]
    body: string
    /** What could not be imported (file references, stray arguments), for a note. */
    warnings: string[]
}

/** Does the text look like a curl invocation (optionally after a `$ ` prompt)? */
export const looksLikeCurl = (text: string) => /^\s*(\$\s*)?curl(\.exe)?\s/i.test(text)

/** POSIX-shell-style word splitting: quotes, backslashes, `$'…'` and line continuations. */
export function tokenize(text: string): string[] {
    const tokens: string[] = []
    let current = ''
    let has = false
    let i = 0
    const push = () => {
        if (has) tokens.push(current)
        current = ''
        has = false
    }
    while (i < text.length) {
        const c = text[i]
        if (c === '\\' && (text[i + 1] === '\n' || text[i + 1] === '\r')) {
            i += text[i + 1] === '\r' && text[i + 2] === '\n' ? 3 : 2
            continue
        }
        if (c === '^' && (text[i + 1] === '\n' || text[i + 1] === '\r')) {
            // cmd.exe continuation
            i += text[i + 1] === '\r' && text[i + 2] === '\n' ? 3 : 2
            continue
        }
        if (/\s/.test(c)) {
            push()
            i++
            continue
        }
        has = true
        if (c === "'") {
            const end = text.indexOf("'", i + 1)
            current += text.slice(i + 1, end === -1 ? text.length : end)
            i = end === -1 ? text.length : end + 1
        } else if (c === '$' && text[i + 1] === "'") {
            i += 2
            while (i < text.length && text[i] !== "'") {
                if (text[i] === '\\') {
                    const n = text[i + 1]
                    const map: Record<string, string> = {
                        n: '\n',
                        t: '\t',
                        r: '\r',
                        "'": "'",
                        '"': '"',
                        '\\': '\\'
                    }
                    if (n === 'x' && /^[0-9a-f]{2}/i.test(text.slice(i + 2, i + 4))) {
                        current += String.fromCharCode(parseInt(text.slice(i + 2, i + 4), 16))
                        i += 4
                        continue
                    }
                    current += map[n] ?? n
                    i += 2
                } else current += text[i++]
            }
            i++
        } else if (c === '"') {
            i++
            while (i < text.length && text[i] !== '"') {
                if (text[i] === '\\' && ['"', '\\', '$', '`', '\n'].includes(text[i + 1])) {
                    if (text[i + 1] !== '\n') current += text[i + 1]
                    i += 2
                } else current += text[i++]
            }
            i++
        } else if (c === '\\') {
            if (i + 1 < text.length) current += text[i + 1]
            i += 2
        } else {
            current += c
            i++
        }
    }
    push()
    return tokens
}

/** UTF-8 aware base64 without Buffer, so the webview bundle can use it too. */
const base64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))

/** Options that take a value and are irrelevant to the request itself. */
const skipWithValue = new Set([
    '-o',
    '--output',
    '-w',
    '--write-out',
    '-m',
    '--max-time',
    '--connect-timeout',
    '--retry',
    '--retry-delay',
    '--retry-max-time',
    '--cacert',
    '--capath',
    '--cert',
    '--key',
    '--pass',
    '-x',
    '--proxy',
    '--proxy-user',
    '-U',
    '--resolve',
    '--interface',
    '--limit-rate',
    '--dns-servers',
    '-T',
    '--upload-file',
    '--unix-socket',
    '--abstract-unix-socket',
    '-c',
    '--cookie-jar',
    '--trace',
    '--trace-ascii',
    '-D',
    '--dump-header',
    '--stderr',
    '--config',
    '-K',
    '--max-redirs',
    '--speed-limit',
    '--speed-time',
    '--keepalive-time',
    '--ciphers',
    '--tls-max',
    '--tlsv1.2',
    '--http2',
    '--http1.1',
    '--range',
    '-r',
    '--output-dir',
    '--create-dirs',
    '--variable',
    '--expand-url'
])
/** Short options whose value may be attached (`-XPOST`, `-H'…'` after tokenizing). */
const shortWithValue = new Set([
    'X',
    'H',
    'd',
    'F',
    'u',
    'A',
    'e',
    'b',
    'o',
    'w',
    'm',
    'x',
    'U',
    'T',
    'c',
    'D',
    'K',
    'r'
])

export function parseCurl(text: string): ParsedCurl {
    const tokens = tokenize(text.trim())
    if (tokens[0] === '$') tokens.shift()
    if (/^curl(\.exe)?$/i.test(tokens[0] ?? '')) tokens.shift()
    const out: ParsedCurl = { method: '', url: '', headers: [], body: '', warnings: [] }
    const data: string[] = []
    const form: [string, string][] = []
    let get = false
    let json = false
    let explicitMethod = ''
    const addHeader = (line: string) => {
        if (line.startsWith('@')) {
            out.warnings.push(`header file ${line}`)
            return
        }
        const at = line.indexOf(':')
        if (at <= 0) {
            if (line.endsWith(';')) out.headers.push([line.slice(0, -1).trim(), ''])
            return
        }
        const name = line.slice(0, at).trim()
        const value = line.slice(at + 1).trim()
        if (value === '' && line.trim().endsWith(':')) {
            // `-H "Name:"` unsets the header curl would add; nothing to import.
            return
        }
        out.headers.push([name, value])
    }
    for (let i = 0; i < tokens.length; i++) {
        let token = tokens[i]
        let value: string | undefined
        const next = () => {
            if (value !== undefined) return value
            value = tokens[++i] ?? ''
            return value
        }
        if (token.startsWith('--') && token.includes('=')) {
            const at = token.indexOf('=')
            value = token.slice(at + 1)
            token = token.slice(0, at)
        } else if (/^-[A-Za-z]/.test(token) && !token.startsWith('--') && token.length > 2) {
            const letter = token[1]
            if (shortWithValue.has(letter)) {
                value = token.slice(2)
                token = token.slice(0, 2)
            } else {
                // Bundled boolean flags such as -sSL; nothing to import.
                continue
            }
        }
        switch (token) {
            case '-X':
            case '--request':
                explicitMethod = next().toUpperCase()
                break
            case '-H':
            case '--header':
                addHeader(next())
                break
            case '-d':
            case '--data':
            case '--data-raw':
            case '--data-binary':
            case '--data-ascii': {
                const v = next()
                if (v.startsWith('@') && token !== '--data-raw') out.warnings.push(`data file ${v}`)
                else data.push(token === '--data' || token === '-d' ? v.replace(/\r?\n/g, '') : v)
                break
            }
            case '--data-urlencode': {
                const v = next()
                const eq = v.indexOf('=')
                if (v.startsWith('@')) out.warnings.push(`data file ${v}`)
                else if (eq === -1) data.push(encodeURIComponent(v))
                else if (v[eq + 1] === '@') out.warnings.push(`data file ${v.slice(eq + 1)}`)
                else data.push(`${v.slice(0, eq)}=${encodeURIComponent(v.slice(eq + 1))}`)
                break
            }
            case '--json':
                data.push(next())
                json = true
                break
            case '-F':
            case '--form':
            case '--form-string': {
                const v = next()
                const eq = v.indexOf('=')
                const name = eq === -1 ? v : v.slice(0, eq)
                const val = eq === -1 ? '' : v.slice(eq + 1)
                if (token !== '--form-string' && /^[@<]/.test(val))
                    out.warnings.push(`form file ${val}`)
                else form.push([name, val])
                break
            }
            case '-u':
            case '--user':
                out.headers.push(['Authorization', `Basic ${base64(next())}`])
                break
            case '--oauth2-bearer':
                out.headers.push(['Authorization', `Bearer ${next()}`])
                break
            case '-A':
            case '--user-agent':
                out.headers.push(['User-Agent', next()])
                break
            case '-e':
            case '--referer':
                out.headers.push(['Referer', next().replace(/;auto$/, '')])
                break
            case '-b':
            case '--cookie': {
                const v = next()
                if (v.includes('=')) out.headers.push(['Cookie', v])
                else out.warnings.push(`cookie file ${v}`)
                break
            }
            case '--url':
                out.url = next()
                break
            case '-I':
            case '--head':
                explicitMethod = explicitMethod || 'HEAD'
                break
            case '-G':
            case '--get':
                get = true
                break
            case '--compressed':
                out.headers.push(['Accept-Encoding', 'gzip, deflate, br'])
                break
            default:
                if (skipWithValue.has(token)) next()
                else if (token.startsWith('-')) {
                    /* boolean flag (-s, -k, -L, -v, …) */
                } else if (!out.url) out.url = token
                else out.warnings.push(`extra argument ${token}`)
        }
    }
    if (out.url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(out.url)) out.url = `http://${out.url}`
    out.url = out.url.replace(/^<(.*)>$/, '$1')
    if (form.length) {
        const boundary = '----TaplineFormBoundary'
        out.body =
            form
                .map(
                    ([name, val]) =>
                        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${val}\r\n`
                )
                .join('') + `--${boundary}--\r\n`
        if (!out.headers.some(([n]) => n.toLowerCase() === 'content-type'))
            out.headers.push(['Content-Type', `multipart/form-data; boundary=${boundary}`])
    } else if (data.length) {
        const joined = data.join('&')
        if (get) {
            const sep = out.url.includes('?') ? '&' : '?'
            out.url += sep + joined
        } else {
            out.body = joined
            const hasType = out.headers.some(([n]) => n.toLowerCase() === 'content-type')
            if (json) {
                if (!hasType) out.headers.push(['Content-Type', 'application/json'])
                if (!out.headers.some(([n]) => n.toLowerCase() === 'accept'))
                    out.headers.push(['Accept', 'application/json'])
            } else if (!hasType)
                out.headers.push(['Content-Type', 'application/x-www-form-urlencoded'])
        }
    }
    out.method = explicitMethod || (out.body && !get ? 'POST' : 'GET')
    return out
}
