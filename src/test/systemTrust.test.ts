import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { selfSigned } from './helpers'
import {
    fingerprint,
    systemTrustStore,
    type Executed,
    type Runner
} from '../environment/systemTrust'

const identity = selfSigned()
const directory = mkdtempSync(join(tmpdir(), 'tapline-trust-'))
const certificate = join(directory, 'ca.pem')
writeFileSync(certificate, identity.cert)
const hash = fingerprint(identity.cert)

type Reply = Partial<Executed> | ((args: string[]) => Partial<Executed>)

/** Runner that records every invocation and answers from a table keyed by subcommand. */
function fake(platform: NodeJS.Platform, replies: Record<string, Reply> = {}, uid = 501) {
    const calls: { file: string; args: string[] }[] = []
    const shells: { title: string; file: string; args: string[] }[] = []
    const runner: Runner = {
        platform,
        uid,
        async exec(file, args) {
            calls.push({ file, args })
            const reply = replies[args[0]] ?? {}
            const r = typeof reply === 'function' ? reply(args) : reply
            return { code: 0, stdout: '', stderr: '', ...r }
        },
        async shell(title, file, args) {
            shells.push({ title, file, args })
            const reply = replies.shell
            const r = typeof reply === 'function' ? reply(args) : reply
            return r?.code ?? 0
        }
    }
    return { runner, calls, shells }
}

describe('system trust store', () => {
    it('computes the SHA-1 fingerprint of the DER certificate', () => {
        expect(hash).toMatch(/^[0-9A-F]{40}$/)
        expect(fingerprint(identity.cert + '\n')).toBe(hash)
    })

    describe('macOS', () => {
        const home = join(directory, 'home')
        mkdirSync(join(home, 'Library', 'Keychains'), { recursive: true })
        const keychain = join(home, 'Library', 'Keychains', 'login.keychain-db')
        writeFileSync(keychain, '')

        it('reports trusted, installed and missing from security', async () => {
            const trusted = fake('darwin', { 'verify-cert': { code: 0 } })
            expect(await systemTrustStore(certificate, trusted.runner, home).status()).toBe(
                'trusted'
            )
            expect(trusted.calls[0]).toEqual({
                file: 'security',
                args: ['verify-cert', '-c', certificate, '-L']
            })
            const installed = fake('darwin', {
                'verify-cert': { code: 1, stderr: 'CSSMERR_TP_NOT_TRUSTED' },
                'find-certificate': {
                    stdout: `SHA-1 hash: ${hash}\n    "labl"<blob>="Tapline Root CA"`
                }
            })
            expect(await systemTrustStore(certificate, installed.runner, home).status()).toBe(
                'installed'
            )
            const missing = fake('darwin', {
                'verify-cert': { code: 1 },
                'find-certificate': { stdout: 'SHA-1 hash: 0000\n' }
            })
            expect(await systemTrustStore(certificate, missing.runner, home).status()).toBe(
                'missing'
            )
        })
        it('installs into the login keychain and trusts as a root', async () => {
            const { runner, calls } = fake('darwin')
            const store = systemTrustStore(certificate, runner, home)
            expect(store.separateTrustStep).toBe(true)
            await store.install()
            await store.trust()
            expect(calls.map((c) => c.args)).toEqual([
                ['add-certificates', '-k', keychain, certificate],
                ['add-trusted-cert', '-r', 'trustRoot', '-k', keychain, certificate]
            ])
        })
        it('tolerates an already-imported certificate but surfaces other failures', async () => {
            const dup = fake('darwin', {
                'add-certificates': {
                    code: 1,
                    stderr: 'The specified item already exists in the keychain.'
                }
            })
            await expect(
                systemTrustStore(certificate, dup.runner, home).install()
            ).resolves.toBeUndefined()
            const present = fake('darwin', {
                'add-certificates': {
                    code: 1,
                    stderr: `security: ${certificate}: already in ${keychain}`
                }
            })
            await expect(
                systemTrustStore(certificate, present.runner, home).install()
            ).resolves.toBeUndefined()
            const denied = fake('darwin', {
                'add-trusted-cert': { code: 1, stderr: 'User canceled the operation.' }
            })
            await expect(
                systemTrustStore(certificate, denied.runner, home).trust()
            ).rejects.toThrow(/add-trusted-cert failed \(exit 1\): User canceled/)
        })
        it('removes trust settings and the keychain item by fingerprint', async () => {
            const { runner, calls } = fake('darwin', {
                'remove-trusted-cert': { code: 1, stderr: 'no trust settings' }
            })
            await systemTrustStore(certificate, runner, home).uninstall()
            expect(calls.map((c) => c.args)).toEqual([
                ['remove-trusted-cert', certificate],
                ['delete-certificate', '-Z', hash, '-t', keychain]
            ])
        })
    })

    describe('Windows', () => {
        it('uses the current-user Root store via certutil', async () => {
            const { runner, calls } = fake('win32', {
                '-user': (args) => ({ code: args[1] === '-store' ? 0 : 0 })
            })
            const store = systemTrustStore(certificate, runner)
            expect(store.separateTrustStep).toBe(false)
            expect(await store.status()).toBe('trusted')
            await store.install()
            await store.trust()
            await store.uninstall()
            expect(calls.map((c) => [c.file, ...c.args])).toEqual([
                ['certutil', '-user', '-store', 'Root', hash],
                ['certutil', '-user', '-addstore', 'Root', certificate],
                ['certutil', '-user', '-addstore', 'Root', certificate],
                ['certutil', '-user', '-delstore', 'Root', hash]
            ])
        })
        it('reports missing when the store lookup fails', async () => {
            const { runner } = fake('win32', {
                '-user': { code: 1, stderr: 'CertUtil: -store command FAILED: 0x80070002' }
            })
            expect(await systemTrustStore(certificate, runner).status()).toBe('missing')
        })
    })

    describe('Linux', () => {
        it('runs the anchor install through sudo in a terminal', async () => {
            const { runner, shells } = fake('linux')
            // The script is quoted for sh, so use a path without backslashes even on Windows.
            const store = systemTrustStore('/tmp/ca.pem', runner, undefined, () => true)
            expect(store.location).toBe('/usr/local/share/ca-certificates/tapline-root-ca.crt')
            await store.trust()
            expect(shells[0].file).toBe('sudo')
            expect(shells[0].args.slice(0, 2)).toEqual(['sh', '-c'])
            expect(shells[0].args[2]).toContain('cp "/tmp/ca.pem"')
            expect(shells[0].args[2]).toMatch(
                /update-ca-certificates|update-ca-trust|trust extract-compat/
            )
            await store.uninstall()
            expect(shells[1].args[2]).toMatch(/^rm -f /)
        })
        it('skips sudo for root and fails on a non-zero exit', async () => {
            const { runner, shells } = fake('linux', { shell: { code: 1 } }, 0)
            const store = systemTrustStore(
                certificate,
                runner,
                undefined,
                (path) => path === '/etc/pki/ca-trust/source/anchors'
            )
            expect(store.location).toBe('/etc/pki/ca-trust/source/anchors/tapline-root-ca.pem')
            await expect(store.install()).rejects.toThrow(/exit 1/)
            expect(shells[0].file).toBe('sh')
        })
    })

    it('rejects unsupported platforms and Linux without an anchor directory', () => {
        expect(() => systemTrustStore(certificate, fake('freebsd').runner)).toThrow(/not supported/)
        expect(() =>
            systemTrustStore(certificate, fake('linux').runner, undefined, () => false)
        ).toThrow(/anchor directory/)
    })
})
