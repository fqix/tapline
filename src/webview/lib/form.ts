import type { Pair } from './http'

export interface FormPair extends Pair {
    enabled?: boolean
    /** Editor-only annotation; never included in the request. */
    description?: string
}

export const parseFormBody = (body: string): FormPair[] =>
    [...new URLSearchParams(body)].map(([name, value]) => ({ name, value, enabled: true }))

export function serializeFormBody(pairs: FormPair[]): string {
    const params = new URLSearchParams()
    for (const pair of pairs)
        if (pair.enabled !== false && (pair.name || pair.value))
            params.append(pair.name, pair.value)
    return params.toString()
}
