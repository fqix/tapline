#!/usr/bin/env node
// Produce platform-specific VSIX files: `node scripts/package.mjs [--all | --target darwin-arm64 ...]`.
// Each VSIX carries only its own sing-box build under core/.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ALL = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64']
const { values } = parseArgs({
    options: {
        all: { type: 'boolean', default: false },
        target: { type: 'string', multiple: true }
    }
})
const targets = values.all
    ? ALL
    : values.target?.length
      ? values.target
      : [`${process.platform}-${process.arch}`]
const run = (command, args, options = {}) =>
    execFileSync(command, args, { cwd: ROOT, stdio: 'inherit', ...options })

run('node', ['esbuild.mjs'])
mkdirSync(join(ROOT, 'core'), { recursive: true })
for (const target of targets) {
    const source = join(ROOT, 'core', target)
    if (!existsSync(source)) run('node', ['scripts/build-core.mjs', '--target', target])
    const staged = []
    try {
        for (const name of readdirSync(source)) {
            copyFileSync(join(source, name), join(ROOT, 'core', name))
            staged.push(join(ROOT, 'core', name))
        }
        // npx on Windows is npx.cmd; Node 18.17+ refuses to spawn .cmd without
        // shell: true (CVE-2024-27980).
        run('npx', ['vsce', 'package', '--no-dependencies', '--target', target], {
            shell: true
        })
    } finally {
        for (const path of staged) rmSync(path, { force: true })
    }
}
