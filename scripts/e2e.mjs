#!/usr/bin/env node
// Build the end-to-end tests and their scratch workspace, then run them in VS Code:
// `node scripts/e2e.mjs [--build-only]`. Requires `npm run build` and the core for
// this platform (`npm run core:build`) and Go 1.25+ for the HTTP/3 probe.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'out')
const tests = readdirSync(join(ROOT, 'src', 'e2e')).filter((f) => f.endsWith('.test.ts'))

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
// Build before launching VS Code so compilation is outside the test timeout.
// Fail explicitly if Go or its dependencies are missing; never silently skip H3.
execFileSync(
    process.env.TAPLINE_GO || 'go',
    [
        'build',
        '-mod=readonly',
        '-o',
        join(OUT, process.platform === 'win32' ? 'h3-probe.exe' : 'h3-probe'),
        '.'
    ],
    {
        cwd: join(ROOT, 'scripts', 'h3-probe'),
        stdio: 'inherit',
        env: { ...process.env, GOWORK: 'off' }
    }
)
await build({
    entryPoints: tests.map((f) => join(ROOT, 'src', 'e2e', f)),
    outdir: join(OUT, 'e2e'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['vscode', 'mocha'],
    sourcemap: 'inline',
    logLevel: 'info'
})

// Scratch workspace: fixed ports away from the defaults so a developer's own capture
// (3606/3607) never collides, and TLS decryption off so capture starts without a CA.
const workspace = join(OUT, 'e2e-workspace')
mkdirSync(join(workspace, '.vscode'), { recursive: true })
mkdirSync(join(workspace, 'mocks'), { recursive: true })
writeFileSync(
    join(workspace, '.vscode', 'settings.json'),
    JSON.stringify(
        {
            'tapline.port': 3626,
            'tapline.mcp.port': 3627,
            'tapline.ssl.enabled': false,
            'tapline.autoStart': false,
            'tapline.terminal.inject': false,
            'tapline.debug.inject': false,
            'tapline.rules': []
        },
        null,
        2
    )
)
writeFileSync(join(workspace, 'mocks', 'users.json'), '[{"id":1,"name":"mock"}]')

if (!process.argv.includes('--build-only'))
    execFileSync('npx', ['vscode-test'], { cwd: ROOT, stdio: 'inherit', shell: true })
