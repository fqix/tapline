// Minimal JSON tokenizer for syntax colouring; input is already pretty-printed.

export type Kind = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct' | 'space'

export interface Token {
    kind: Kind
    text: string
}

export function tokenize(json: string): Token[] {
    const tokens: Token[] = []
    const push = (kind: Kind, text: string) => {
        const last = tokens[tokens.length - 1]
        if (last && last.kind === kind && (kind === 'space' || kind === 'punct')) last.text += text
        else tokens.push({ kind, text })
    }
    let i = 0
    while (i < json.length) {
        const c = json[i]
        if (c === '"') {
            let j = i + 1
            while (j < json.length && json[j] !== '"') j += json[j] === '\\' ? 2 : 1
            const text = json.slice(i, j + 1)
            let k = j + 1
            while (k < json.length && (json[k] === ' ' || json[k] === '\t')) k++
            push(json[k] === ':' ? 'key' : 'string', text)
            i = j + 1
        } else if (c === '-' || (c >= '0' && c <= '9')) {
            const match = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(json.slice(i))!
            push('number', match[0])
            i += match[0].length
        } else if (json.startsWith('true', i) || json.startsWith('false', i)) {
            const text = c === 't' ? 'true' : 'false'
            push('boolean', text)
            i += text.length
        } else if (json.startsWith('null', i)) {
            push('null', 'null')
            i += 4
        } else if (c === ' ' || c === '\n' || c === '\t' || c === '\r') {
            push('space', c)
            i++
        } else {
            push('punct', c)
            i++
        }
    }
    return tokens
}
