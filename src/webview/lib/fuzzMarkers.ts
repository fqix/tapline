import { FUZZ_MARKER } from '../../shared/model'
import type { ComposeDraft } from '../types/messages'
import { parseAuth } from './auth'
import { parseFormBody } from './form'

/** One `$FUZZ$` occurrence as shown in the Fuzz tab's table. */
export interface MarkedLocation {
    location: string
    element: string
}

const marked = (value?: string) => !!value?.includes(FUZZ_MARKER)

function urlLocations(url: string): MarkedLocation[] {
    if (!marked(url)) return []
    try {
        const parsed = new URL(url)
        const rows: MarkedLocation[] = []
        for (const [name, value] of parsed.searchParams)
            if (marked(name) || marked(value))
                rows.push({ location: 'Params', element: name || '(name)' })
        if (marked(parsed.pathname)) rows.push({ location: 'URL', element: 'path' })
        if (marked(parsed.host)) rows.push({ location: 'URL', element: 'host' })
        if (marked(parsed.hash)) rows.push({ location: 'URL', element: 'fragment' })
        if (!rows.length && marked(url)) rows.push({ location: 'URL', element: 'URL' })
        return rows
    } catch {
        return [{ location: 'URL', element: 'URL' }]
    }
}

function headerLocations(headers: string): MarkedLocation[] {
    const rows: MarkedLocation[] = []
    for (const line of headers.split('\n')) {
        const at = line.indexOf(':')
        if (at <= 0) continue
        const name = line.slice(0, at).trim()
        const value = line.slice(at + 1).trim()
        if (marked(name)) rows.push({ location: 'Headers', element: name })
        if (!marked(value)) continue
        if (name.toLowerCase() === 'authorization') {
            const auth = parseAuth(value)
            const element =
                auth.type === 'basic'
                    ? marked(auth.username)
                        ? 'username'
                        : marked(auth.password)
                          ? 'password'
                          : 'value'
                    : auth.type === 'bearer'
                      ? 'token'
                      : 'value'
            rows.push({ location: 'Authorization', element })
        } else rows.push({ location: 'Headers', element: name })
    }
    return rows
}

function jsonLocations(value: unknown, path: string, rows: MarkedLocation[]) {
    if (typeof value === 'string') {
        if (marked(value)) rows.push({ location: 'Body', element: path || 'JSON value' })
    } else if (Array.isArray(value)) {
        value.forEach((item, index) => jsonLocations(item, `${path}[${index}]`, rows))
    } else if (value && typeof value === 'object') {
        for (const [name, item] of Object.entries(value)) {
            const child = path ? `${path}.${name}` : name
            if (marked(name)) rows.push({ location: 'Body', element: child })
            jsonLocations(item, child, rows)
        }
    }
}

function bodyLocations(draft: ComposeDraft, contentType: string): MarkedLocation[] {
    const body = draft.body ?? ''
    const mode =
        draft.bodyDraft?.mode ??
        (contentType === 'application/x-www-form-urlencoded'
            ? 'x-www-form-urlencoded'
            : body
              ? 'raw'
              : 'none')
    if (mode === 'GraphQL') {
        const rows: MarkedLocation[] = []
        if (marked(draft.bodyDraft?.query))
            rows.push({ location: 'Body', element: 'GraphQL query' })
        if (marked(draft.bodyDraft?.variables))
            rows.push({ location: 'Body', element: 'GraphQL variables' })
        if (marked(draft.bodyDraft?.operationName))
            rows.push({ location: 'Body', element: 'GraphQL operation name' })
        return rows
    }
    if (mode === 'form-data') {
        return (draft.bodyDraft?.parts ?? []).flatMap((part, index) => {
            const name = part.name || `field ${index + 1}`
            const rows: MarkedLocation[] = []
            if (marked(part.name)) rows.push({ location: 'Body', element: `${name} (name)` })
            if (marked(part.value)) rows.push({ location: 'Body', element: name })
            return rows
        })
    }
    if (mode === 'x-www-form-urlencoded') {
        return parseFormBody(body).flatMap((pair) => {
            const rows: MarkedLocation[] = []
            if (marked(pair.name)) rows.push({ location: 'Body', element: pair.name })
            if (marked(pair.value)) rows.push({ location: 'Body', element: pair.name || '(name)' })
            return rows
        })
    }
    if (!marked(body)) return []
    try {
        const rows: MarkedLocation[] = []
        jsonLocations(JSON.parse(body), '', rows)
        return rows.length ? rows : [{ location: 'Body', element: 'JSON value' }]
    } catch {
        return [{ location: 'Body', element: 'raw body' }]
    }
}

/** Table rows for every marked value in a (Re)Play request. */
export function fuzzMarkerLocations(draft: ComposeDraft): MarkedLocation[] {
    const contentType = draft.headers
        .split('\n')
        .find((line) => /^\s*content-type\s*:/i.test(line))
        ?.split(':')[1]
        ?.split(';')[0]
        .trim()
        .toLowerCase()
    const rows = [
        ...urlLocations(draft.url),
        ...headerLocations(draft.headers),
        ...bodyLocations(draft, contentType ?? '')
    ]
    return rows.filter(
        (row, index) =>
            rows.findIndex((r) => r.location === row.location && r.element === row.element) ===
            index
    )
}
