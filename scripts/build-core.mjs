#!/usr/bin/env node
// Build the patched sing-box core for one or more targets.
//   node scripts/build-core.mjs                 # host platform/arch
//   node scripts/build-core.mjs --target linux-x64 --target win32-arm64
//   node scripts/build-core.mjs --test          # go test + vet of the patched packages
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PATCHES = join(ROOT, 'third_party/sing-box/patches')
const PIN = JSON.parse(readFileSync(join(ROOT, 'third_party/sing-box/pin.json'), 'utf8'))
const SOURCE = join(ROOT, '.build/sing-box')
const GO = process.env.TAPLINE_GO || 'go'
const UPSTREAM = 'https://github.com/SagerNet/sing-box.git'
const GOOS = { darwin: 'darwin', linux: 'linux', win32: 'windows' }
const GOARCH = { x64: 'amd64', arm64: 'arm64' }

const { values } = parseArgs({
    options: {
        target: { type: 'string', multiple: true },
        test: { type: 'boolean', default: false }
    }
})
const targets = values.target?.length ? values.target : [`${process.platform}-${process.arch}`]
const run = (command, args, options = {}) =>
    execFileSync(command, args, { stdio: 'inherit', ...options })
const output = (command, args, options = {}) =>
    execFileSync(command, args, {
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        ...options
    }).trim()
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const patches = ['0001', '0002', '0003', '0004', '0005', '0006'].map((prefix) => {
    const name = readFileSync(join(PATCHES, 'series'), 'utf8')
        .split('\n')
        .find((line) => line.startsWith(prefix))
    return { name, path: join(PATCHES, name), sha256: sha256(join(PATCHES, name)) }
})

function checkout() {
    const git = (...args) => output('git', args, { cwd: SOURCE })
    if (!existsSync(join(SOURCE, '.git'))) {
        mkdirSync(dirname(SOURCE), { recursive: true })
        console.log(`Cloning sing-box ${PIN.version} into ${SOURCE}`)
        run('git', [
            'clone',
            '--quiet',
            '--depth',
            '1',
            '--branch',
            `v${PIN.version}`,
            UPSTREAM,
            SOURCE
        ])
    }
    if (git('rev-parse', 'HEAD') !== PIN.revision) {
        run('git', ['fetch', '--quiet', '--depth', '1', 'origin', PIN.revision], { cwd: SOURCE })
        run('git', ['checkout', '--quiet', '--force', PIN.revision], { cwd: SOURCE })
    }
    // Always rebuild from the pristine revision, then apply the series in order.
    run('git', ['checkout', '--quiet', '--force', '--', '.'], { cwd: SOURCE })
    run('git', ['clean', '--quiet', '-fdx', '-e', '/go.work*'], { cwd: SOURCE })
    for (const patch of patches) {
        console.log(`Applying ${patch.name}`)
        run('git', ['apply', '--whitespace=nowarn', patch.path], { cwd: SOURCE })
    }
}

function environment(platform, arch) {
    return {
        ...process.env,
        GOTOOLCHAIN: PIN.toolchain + '+auto',
        GOWORK: 'off',
        GOENV: 'off',
        GOFLAGS: '',
        GOOS: GOOS[platform],
        GOARCH: GOARCH[arch],
        CGO_ENABLED: '0'
    }
}

function notices(env, tags) {
    const compiled = output(
        GO,
        ['list', '-mod=readonly', '-tags=' + tags, '-deps', '-json', './cmd/sing-box'],
        {
            cwd: SOURCE,
            env
        }
    )
        .split(/^}$/m)
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map((chunk) => JSON.parse(chunk + '}'))
    const modules = {}
    const seen = new Map()
    for (const entry of compiled) {
        const module = entry.Module
        if (!module) continue
        modules[module.Path] = module.Version || 'local'
        const dir = resolve((module.Replace || module).Dir)
        for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'NOTICE'])
            if (existsSync(join(dir, name)) && !seen.has(module.Path + '/' + name))
                seen.set(module.Path + '/' + name, readFileSync(join(dir, name), 'utf8'))
    }
    const text = [...seen.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, body]) => `${'='.repeat(78)}\n${name}\n${'='.repeat(78)}\n\n${body.trim()}\n`)
        .join('\n')
    return { modules, text }
}

checkout()
const tags = readFileSync(join(SOURCE, 'release/DEFAULT_BUILD_TAGS_OTHERS'), 'utf8').trim()
const ldflags = readFileSync(join(SOURCE, 'release/LDFLAGS'), 'utf8').trim()
if (values.test) {
    const env = { ...environment(process.platform, process.arch), CGO_ENABLED: '1' }
    const packages = ['./service/fluxyinspector/...', './include', './cmd/sing-box']
    run(
        GO,
        [
            'test',
            '-race',
            '-mod=readonly',
            `-tags=${tags},integration`,
            '-ldflags=' + ldflags,
            ...packages
        ],
        { cwd: SOURCE, env }
    )
    run(GO, ['vet', '-mod=readonly', `-tags=${tags},integration`, ...packages], {
        cwd: SOURCE,
        env
    })
    process.exit(0)
}
for (const target of targets) {
    const [platform, arch] = target.split('-')
    if (!GOOS[platform] || !GOARCH[arch]) throw new Error(`Unsupported target ${target}`)
    const env = environment(platform, arch)
    const directory = join(ROOT, 'core', target)
    rmSync(directory, { recursive: true, force: true })
    mkdirSync(directory, { recursive: true })
    const binary = join(directory, platform === 'win32' ? 'sing-box.exe' : 'sing-box')
    console.log(`Building sing-box ${PIN.version} for ${target}`)
    run(
        GO,
        [
            'build',
            '-mod=readonly',
            '-tags=' + tags,
            '-trimpath',
            '-buildvcs=false',
            '-ldflags=' +
                ldflags +
                ' -s -w -buildid= -X github.com/sagernet/sing-box/constant.Version=' +
                PIN.version,
            '-o',
            binary,
            './cmd/sing-box'
        ],
        { cwd: SOURCE, env }
    )
    const { modules, text } = notices(env, tags)
    writeFileSync(join(directory, 'sing-box.licenses.txt'), text)
    writeFileSync(
        join(directory, 'sing-box.build.json'),
        JSON.stringify(
            {
                version: PIN.version,
                revision: PIN.revision,
                toolchain: output(GO, ['version'], { env }),
                target,
                tags: tags.split(','),
                patches: patches.map(({ name, sha256 }) => ({ name, sha256 })),
                modules,
                sha256: sha256(binary)
            },
            null,
            2
        ) + '\n'
    )
    copyFileSync(join(SOURCE, 'LICENSE'), join(directory, 'LICENSE'))
    console.log(`Wrote ${binary}`)
}
