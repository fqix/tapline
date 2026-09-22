// Aggregates behind the statistics pane; pure so src/test/webview/webview.test.ts can cover them.
import type { Row } from '../types/messages'

export interface HostStats {
    host: string
    requests: number
    errors: number
    pending: number
    total: number
    max: number
    sent: number
    received: number
}

/** Per-host aggregates plus the slowest and largest responses; pure, for tests. */
export function aggregate(rows: Row[]) {
    const hosts = new Map<string, HostStats>()
    for (const row of rows) {
        let h = hosts.get(row.host)
        if (!h) {
            h = {
                host: row.host,
                requests: 0,
                errors: 0,
                pending: 0,
                total: 0,
                max: 0,
                sent: 0,
                received: 0
            }
            hosts.set(row.host, h)
        }
        h.requests++
        if (row.state === 'pending') h.pending++
        else {
            h.total += row.duration
            h.max = Math.max(h.max, row.duration)
        }
        if (row.state === 'error' || (row.status ?? 0) >= 400) h.errors++
        h.sent += row.requestBytes
        h.received += row.responseBytes
    }
    const done = rows.filter((r) => r.state !== 'pending' && r.scheme !== 'connect')
    return {
        hosts: [...hosts.values()].sort((a, b) => b.requests - a.requests),
        slowest: [...done].sort((a, b) => b.duration - a.duration).slice(0, 10),
        largest: [...done].sort((a, b) => b.responseBytes - a.responseBytes).slice(0, 10),
        requests: rows.length,
        errors: rows.filter((r) => r.state === 'error' || (r.status ?? 0) >= 400).length,
        sent: rows.reduce((n, r) => n + r.requestBytes, 0),
        received: rows.reduce((n, r) => n + r.responseBytes, 0),
        totalTime: done.reduce((n, r) => n + r.duration, 0)
    }
}
