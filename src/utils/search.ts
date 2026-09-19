// Host-side half of the filter query: terms over headers and bodies, which the table
// rows do not carry. Shares the parser with the webview.
import type { Transaction } from '../shared/model'
import { parseQuery, remoteKeys, type Term } from '../webview/lib/filter'

const headerText = (h: Record<string, string>) =>
    Object.entries(h)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')

function headerMatches(headers: Record<string, string>, value: string) {
    const [name, ...rest] = value.split('=')
    const wanted = rest.join('=').toLowerCase()
    const key = name.trim().toLowerCase()
    for (const [k, v] of Object.entries(headers))
        if (k.toLowerCase() === key || (!wanted && k.toLowerCase().includes(key)))
            if (!wanted || v.toLowerCase().includes(wanted)) return true
    return false
}

function holds(t: Transaction, term: Term): boolean {
    const needle = term.value.toLowerCase()
    let hit: boolean
    switch (term.key) {
        case 'body':
            hit =
                (!t.requestBinary && t.requestBody.toLowerCase().includes(needle)) ||
                (!t.responseBinary && t.responseBody.toLowerCase().includes(needle))
            break
        case 'header':
            hit =
                headerMatches(t.requestHeaders, term.value) ||
                headerMatches(t.responseHeaders, term.value) ||
                (!!t.responseTrailers && headerMatches(t.responseTrailers, term.value))
            break
        case 'req':
            hit =
                headerText(t.requestHeaders).toLowerCase().includes(needle) ||
                (!t.requestBinary && t.requestBody.toLowerCase().includes(needle))
            break
        case 'res':
            hit =
                headerText(t.responseHeaders).toLowerCase().includes(needle) ||
                (!t.responseBinary && t.responseBody.toLowerCase().includes(needle))
            break
        default:
            return true
    }
    return term.negate ? !hit : hit
}

/** Ids of the transactions satisfying every body/header term of `query`. */
export function searchTransactions(items: Iterable<Transaction>, query: string): string[] {
    const terms = parseQuery(query).filter((t) => remoteKeys.includes(t.key))
    if (!terms.length) return []
    const ids: string[] = []
    for (const t of items) if (terms.every((term) => holds(t, term))) ids.push(t.id)
    return ids
}
