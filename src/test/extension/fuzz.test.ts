import { expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadWordlist, startFuzz, type FuzzReport, type Wordlist } from '../../extension/fuzzing'
import type { ComposeRequest, Transaction } from '../../shared/model'

const request: ComposeRequest = {
    url: 'https://example.test/search?q=old',
    method: 'GET',
    headers: { 'X-Test': 'one' },
    body: ''
}
const list: Wordlist = { path: 'words.txt', lines: 2, words: ['a', 'b'] }
const send = (sent: ComposeRequest[]) => async (value: ComposeRequest) => {
    sent.push(value)
    return { id: String(sent.length), status: 200 } as Transaction
}

it('reads one payload per non-empty line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tapline-fuzz-'))
    const path = join(dir, 'words.txt')
    writeFileSync(path, 'one\r\ntwo\n\nthree\n')
    try {
        expect(await loadWordlist(path)).toEqual({
            path,
            lines: 3,
            words: ['one', 'two', 'three']
        })
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

it('sends each payload at each insertion point and reports progress', async () => {
    const sent: ComposeRequest[] = []
    const reports: FuzzReport[] = []
    const run = startFuzz({
        lists: [list],
        targets: [{ kind: 'query', name: 'q' }, { kind: 'body' }],
        request,
        send: send(sent),
        report: (report) => reports.push(report)
    })
    await run.finished
    expect(sent).toHaveLength(4)
    expect(new URL(sent[0].url).searchParams.get('q')).toBe('a')
    expect(sent[2].body).toBe('a')
    expect(reports[0]).toMatchObject({ running: true, done: 0, total: 4, reset: true })
    expect(reports.at(-1)).toMatchObject({ running: false, done: 4, total: 4 })
    expect(reports.filter((r) => r.result)).toHaveLength(4)
})

it('stops after the request in flight', async () => {
    const sent: ComposeRequest[] = []
    const run = startFuzz({
        lists: [list],
        targets: [{ kind: 'body' }],
        request,
        send: send(sent),
        report: () => {}
    })
    run.stop()
    await run.finished
    expect(sent).toHaveLength(1)
})
