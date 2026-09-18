// Pure filtering and sorting for the sequence table; covered by src/test/webview.test.ts.
import type { Row } from '../types/messages'

export type Quick = 'all' | '2xx' | '3xx' | '4xx' | '5xx' | 'pending' | 'error'
export const quickFilters: Quick[] = ['all', '2xx', '3xx', '4xx', '5xx', 'pending', 'error']

export interface Filters {
    text: string
    quick: Quick
    host?: string
    hideTunnels: boolean
}

export const defaultFilters: Filters = { text: '', quick: 'all', hideTunnels: false }

export type Column =
    'status' | 'method' | 'host' | 'path' | 'timestamp' | 'duration' | 'responseBytes'
export const columns: Column[] = [
    'status',
    'method',
    'host',
    'path',
    'timestamp',
    'duration',
    'responseBytes'
]

export interface Sort {
    column: Column
    ascending: boolean
}

export const defaultSort: Sort = { column: 'timestamp', ascending: true }

function quickMatches(row: Row, quick: Quick): boolean {
    switch (quick) {
        case 'all':
            return true
        case 'pending':
            return row.state === 'pending'
        case 'error':
            return row.state === 'error' || (row.status ?? 0) >= 400
        default:
            return Math.floor((row.status ?? 0) / 100) === Number(quick[0])
    }
}

export function matches(row: Row, filters: Filters): boolean {
    if (filters.hideTunnels && row.scheme === 'connect') return false
    if (filters.host && row.host !== filters.host) return false
    if (!quickMatches(row, filters.quick)) return false
    const needle = filters.text.trim().toLowerCase()
    if (!needle) return true
    return (
        row.url.toLowerCase().includes(needle) ||
        row.method.toLowerCase().includes(needle) ||
        String(row.status ?? '').startsWith(needle) ||
        (row.error ?? '').toLowerCase().includes(needle)
    )
}

const key = (row: Row, column: Column): string | number =>
    column === 'timestamp' ? row.sequence : (row[column] ?? '')

/** Stable sort; ties fall back to capture order so live updates never shuffle rows. */
export function sortRows(rows: Row[], sort: Sort): Row[] {
    return [...rows].sort((a, b) => {
        const x = key(a, sort.column)
        const y = key(b, sort.column)
        const order =
            typeof x === 'number' && typeof y === 'number'
                ? x - y
                : String(x).localeCompare(String(y))
        return (sort.ascending ? order : -order) || a.sequence - b.sequence
    })
}

export function toggleSort(sort: Sort, column: Column): Sort {
    return {
        column,
        ascending: sort.column === column ? !sort.ascending : column !== 'responseBytes'
    }
}

export function isFiltered(filters: Filters): boolean {
    return !!filters.text.trim() || filters.quick !== 'all' || !!filters.host || filters.hideTunnels
}
