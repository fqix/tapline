import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentClient } from '../../extension/client'
import {
    browserArguments,
    browserCandidates,
    browserExecutable,
    CapturedBrowser,
    firefoxPkcs11Config,
    firefoxPreferences,
    p11KitTrustLibrary
} from '../../extension/environment/capturedBrowser'

const ui = vi.hoisted(() => ({
    pick: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    spawn: vi.fn()
}))
vi.mock('vscode', () => ({
    window: {
        showQuickPick: ui.pick,
        showInformationMessage: ui.info,
        showErrorMessage: ui.error
    },
    l10n: {
        t: (text: string, ...args: unknown[]) =>
            text.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)]))
    }
}))
vi.mock('node:child_process', () => ({ spawn: ui.spawn }))

beforeEach(() => {
    vi.resetAllMocks()
    ui.spawn.mockReturnValue({ once: vi.fn(), unref: vi.fn() })
})
afterEach(() => vi.unstubAllEnvs())

describe('captured browser', () => {
    it('resolves browser executables per platform', () => {
        expect(browserCandidates('firefox', 'darwin')).toEqual([
            '/Applications/Firefox.app/Contents/MacOS/firefox',
            'firefox'
        ])
        expect(browserCandidates('edge', 'win32', { ProgramFiles: 'C:\\Program Files' })).toContain(
            join('C:\\Program Files', 'Microsoft/Edge/Application/msedge.exe')
        )
        expect(browserCandidates('chrome', 'linux')).toContain('google-chrome')

        const dir = mkdtempSync(join(tmpdir(), 'tapline-browser-bin-'))
        writeFileSync(join(dir, 'google-chrome'), '')
        expect(browserExecutable('chrome', 'linux', { PATH: dir })).toBe(join(dir, 'google-chrome'))
    })

    it('configures an isolated profile with the active proxy port', () => {
        expect(browserArguments('chrome', 3638, '/tmp/profile')).toEqual(
            expect.arrayContaining([
                '--user-data-dir=/tmp/profile',
                '--proxy-server=http://127.0.0.1:3638'
            ])
        )
        expect(browserArguments('firefox', 3638, '/tmp/profile')).toEqual([
            '-no-remote',
            '-profile',
            '/tmp/profile',
            'about:blank'
        ])
        const prefs = firefoxPreferences(3638)
        expect(prefs).toContain('network.proxy.http_port", 3638')
        expect(prefs).toContain('network.proxy.ssl_port", 3638')
        expect(prefs).toContain('security.enterprise_roots.enabled", true')
        expect(prefs).not.toContain('toolkit.policies.perUserDir')
    })

    it('finds the Linux p11-kit trust module and adds it to Firefox NSS config', () => {
        const library = '/usr/lib64/pkcs11/p11-kit-trust.so'
        expect(p11KitTrustLibrary('linux', 'x64', (path) => path === library)).toBe(library)
        expect(p11KitTrustLibrary('darwin', 'x64', () => true)).toBeUndefined()

        const config = firefoxPkcs11Config(undefined, library, '/profile')
        expect(config).toContain("configdir='sql:/profile'")
        expect(config).toContain(`library=${library}`)
        expect(firefoxPkcs11Config(config, library, '/profile')).toBe(config)
        const existing = 'library=/custom/module.so\nname=Custom\n'
        expect(firefoxPkcs11Config(existing, library, '/profile')).toContain(
            'library=/custom/module.so'
        )
    })

    it('launches the chosen browser with its proxy profile', async () => {
        const bin = mkdtempSync(join(tmpdir(), 'tapline-browser-bin-'))
        writeFileSync(join(bin, process.platform === 'win32' ? 'firefox.exe' : 'firefox'), '')
        vi.stubEnv('PATH', bin)
        ui.pick.mockImplementation(async (items: { label: string }[]) =>
            items.find((item) => item.label === 'Firefox')
        )
        const storage = mkdtempSync(join(tmpdir(), 'tapline-browser-storage-'))
        const client = { running: true, port: 4001 } as unknown as AgentClient

        await new CapturedBrowser(client, storage).open()

        const profile = join(storage, 'browser-profiles', 'firefox')
        expect(readFileSync(join(profile, 'user.js'), 'utf8')).toContain(
            'network.proxy.http_port", 4001'
        )
        const library = p11KitTrustLibrary()
        if (library)
            expect(readFileSync(join(profile, 'pkcs11.txt'), 'utf8')).toContain(
                `library=${library}`
            )
        expect(ui.spawn).toHaveBeenCalledWith(
            expect.stringContaining('firefox'),
            ['-no-remote', '-profile', profile, 'about:blank'],
            expect.objectContaining({ detached: true })
        )
    })

    it('does not launch anything when capture is stopped or the picker is cancelled', async () => {
        const bin = mkdtempSync(join(tmpdir(), 'tapline-browser-bin-'))
        const name = process.platform === 'win32' ? 'firefox.exe' : 'firefox'
        writeFileSync(join(bin, name), '')
        vi.stubEnv('PATH', bin)
        let running = false
        const client = {
            get running() {
                return running
            },
            port: 4001
        } as unknown as AgentClient
        const browser = new CapturedBrowser(client, '/tmp/profile')
        await browser.open()
        expect(ui.pick).not.toHaveBeenCalled()

        running = true
        ui.pick.mockResolvedValue(undefined)
        await browser.open()
        expect(ui.spawn).not.toHaveBeenCalled()
    })
})
