export interface JsonRow {
    name: string
    depth: number
    value: string
    kind: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array'
    count: number
    end: number
}

/** Flatten iteratively so deeply nested payloads do not exhaust the call stack. */
export function jsonTree(text: string): JsonRow[] | undefined {
    let root: unknown
    try {
        root = JSON.parse(text)
    } catch {
        return undefined
    }
    const rows: JsonRow[] = []
    const pending = [{ name: 'JSON', depth: 0, value: root }]
    while (pending.length) {
        const { name, depth, value } = pending.pop()!
        const kind: JsonRow['kind'] =
            value === null
                ? 'null'
                : Array.isArray(value)
                  ? 'array'
                  : (typeof value as JsonRow['kind'])
        const entries =
            kind === 'object' || kind === 'array'
                ? Object.entries(value as Record<string, unknown>)
                : []
        rows.push({
            name,
            depth,
            kind,
            count: entries.length,
            value: entries.length || kind === 'object' || kind === 'array' ? '' : String(value),
            end: rows.length
        })
        for (let i = entries.length - 1; i >= 0; i--) {
            const [key, child] = entries[i]
            pending.push({
                name: kind === 'array' ? `[${key}]` : key,
                depth: depth + 1,
                value: child
            })
        }
    }
    const parents: number[] = []
    rows.forEach((row, index) => {
        while (parents.length && rows[parents[parents.length - 1]].depth >= row.depth)
            rows[parents.pop()!].end = index - 1
        parents.push(index)
    })
    for (const index of parents) rows[index].end = rows.length - 1
    return rows
}
