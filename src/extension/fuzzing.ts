import { readFile, stat } from 'node:fs/promises'
import {
    applyFuzz,
    fuzzTargetLabel,
    type ComposeRequest,
    type FuzzTarget,
    type Transaction
} from '../shared/model'
import type { FuzzFile, FuzzResult } from '../webview/types/messages'

const MAX_BYTES = 5 * 1024 * 1024
const MAX_LINES = 20000

export interface Wordlist extends FuzzFile {
    words: string[]
}

export interface FuzzReport {
    running: boolean
    done: number
    total: number
    reset?: boolean
    result?: FuzzResult
    error?: string
}

export interface FuzzRun {
    stop(): void
    finished: Promise<void>
}

/** Read a wordlist chosen in a native file dialog, one payload per non-empty line. */
export async function loadWordlist(path: string): Promise<Wordlist> {
    const file: Wordlist = { path, words: [], lines: 0 }
    try {
        const info = await stat(path)
        if (!info.isFile()) return { ...file, error: 'Not a file' }
        if (info.size > MAX_BYTES)
            return { ...file, error: `File too large (limit ${MAX_BYTES / 1024 / 1024} MB)` }
        const words = (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean)
        return {
            ...file,
            words: words.slice(0, MAX_LINES),
            lines: Math.min(words.length, MAX_LINES),
            ...(words.length > MAX_LINES ? { error: `Only the first ${MAX_LINES} lines used` } : {})
        }
    } catch (error) {
        return { ...file, error: error instanceof Error ? error.message : String(error) }
    }
}

/**
 * Send one request per payload × target through the proxy. Runs to completion
 * unless `stop()` is called; reports progress after each send and never rejects.
 */
export function startFuzz({
    lists,
    targets,
    request,
    send,
    report
}: {
    lists: Wordlist[]
    targets: FuzzTarget[]
    request: ComposeRequest
    send(request: ComposeRequest): Promise<Transaction>
    report(report: FuzzReport): void
}): FuzzRun {
    const words = lists.flatMap((list) => list.words)
    const total = words.length * targets.length
    let stopped = false
    let done = 0
    const finished = (async () => {
        if (!words.length || !targets.length) {
            report({
                running: false,
                done: 0,
                total: 0,
                error: 'Add a wordlist and insert $FUZZ$ in the request first'
            })
            return
        }
        report({ running: true, done: 0, total, reset: true })
        for (const target of targets) {
            for (const payload of words) {
                if (stopped) break
                const result: FuzzResult = { target: fuzzTargetLabel(target), payload }
                try {
                    const sent = await send(applyFuzz(request, target, payload))
                    result.id = sent.id
                    result.status = sent.status
                    result.error = sent.error
                } catch (error) {
                    result.error = error instanceof Error ? error.message : String(error)
                }
                done++
                report({ running: true, done, total, result })
            }
            if (stopped) break
        }
        report({ running: false, done, total })
    })()
    return { stop: () => (stopped = true), finished }
}
