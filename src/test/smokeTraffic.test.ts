import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Exercise the actual shell block with a CLI fixture, without public network access.
describe.skipIf(process.platform === 'win32')('WebSocket smoke process lifecycle', () => {
    let directory: string
    beforeAll(() => {
        directory = mkdtempSync(join(tmpdir(), 'tapline-smoke-'))
        writeFileSync(
            join(directory, 'wscat'),
            `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on('end', () => process.exit(0));
const publicEcho = process.argv.includes('wss://echo.websocket.org');
if (!process.env.TAPLINE_SMOKE_STALL || publicEcho) setTimeout(() => {
    if (publicEcho) console.log('Request served by test-server');
    if (!process.env.TAPLINE_SMOKE_MISMATCH) console.log(process.argv[process.argv.indexOf('-x') + 1]);
    process.exit(0);
}, 100);
`,
            { mode: 0o755 }
        )
        const script = readFileSync(
            new URL('../../examples/smoke-traffic.sh', import.meta.url),
            'utf8'
        )
        const block = script.slice(
            script.indexOf('echo "== WebSocket'),
            script.indexOf('echo "== gRPC')
        )
        writeFileSync(
            join(directory, 'smoke.sh'),
            `set -u\npass=0\nfail=0\n${block}\nexit "$fail"\n`
        )
    })
    afterAll(() => rmSync(directory, { recursive: true, force: true }))

    function run(stall = false, mismatch = false) {
        return new Promise<{ code: number; stdout: string }>((resolve, reject) => {
            const child = execFile(
                'bash',
                [join(directory, 'smoke.sh')],
                {
                    timeout: 35000,
                    env: {
                        ...process.env,
                        PATH: `${directory}:${process.env.PATH}`,
                        TAPLINE_SMOKE_STALL: stall ? '1' : '',
                        TAPLINE_SMOKE_MISMATCH: mismatch ? '1' : ''
                    }
                },
                (error, stdout) => {
                    if (error?.killed) reject(error)
                    else resolve({ code: error ? Number(error.code) : 0, stdout })
                }
            )
            child.stdin!.end()
        })
    }

    it('gets an echo even when the caller stdin is closed', async () => {
        const result = await run()
        expect(result.code).toBe(0)
        expect(result.stdout.match(/ ok/g)).toHaveLength(2)
        expect(result.stdout).toContain('wss://echo.websocket.org')
    })

    it('rejects a welcome message without the expected echo', async () => {
        const result = await run(false, true)
        expect(result.code).toBe(2)
        expect(result.stdout.match(/FAIL/g)).toHaveLength(2)
    })

    it('fails within the overall deadline when the CLI stalls before its wait timer', async () => {
        const result = await run(true)
        expect(result.code).toBe(1)
        expect(result.stdout).toContain('FAIL')
    }, 40000)
})
