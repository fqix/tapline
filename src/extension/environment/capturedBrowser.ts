import * as vscode from 'vscode'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'
import type { AgentClient } from '../client'

export type Browser = 'chrome' | 'firefox' | 'edge' | 'brave' | 'chromium'

const BROWSERS: Browser[] = ['chrome', 'firefox', 'edge', 'brave', 'chromium']

const commands: Record<Browser, string[]> = {
    chrome: ['google-chrome', 'google-chrome-stable', 'chrome'],
    firefox: ['firefox'],
    edge: ['microsoft-edge', 'microsoft-edge-stable'],
    brave: ['brave-browser', 'brave'],
    chromium: ['chromium', 'chromium-browser']
}

const macApplications: Record<Browser, [app: string, binary: string]> = {
    chrome: ['Google Chrome', 'Google Chrome'],
    firefox: ['Firefox', 'firefox'],
    edge: ['Microsoft Edge', 'Microsoft Edge'],
    brave: ['Brave Browser', 'Brave Browser'],
    chromium: ['Chromium', 'Chromium']
}

const windowsPaths: Record<Browser, string[]> = {
    chrome: ['Google/Chrome/Application/chrome.exe'],
    firefox: ['Mozilla Firefox/firefox.exe'],
    edge: ['Microsoft/Edge/Application/msedge.exe'],
    brave: ['BraveSoftware/Brave-Browser/Application/brave.exe'],
    chromium: ['Chromium/Application/chrome.exe']
}

const labels: Record<Browser, string> = {
    chrome: 'Google Chrome',
    firefox: 'Firefox',
    edge: 'Microsoft Edge',
    brave: 'Brave',
    chromium: 'Chromium'
}

/** Executable locations to try, in order; bare names are resolved through PATH. */
export function browserCandidates(
    browser: Browser,
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env
): string[] {
    if (platform === 'darwin') {
        const [app, binary] = macApplications[browser]
        return [`/Applications/${app}.app/Contents/MacOS/${binary}`, ...commands[browser]]
    }
    if (platform === 'win32') {
        const roots = [env.LOCALAPPDATA, env.ProgramFiles, env['ProgramFiles(x86)']].filter(
            (root): root is string => !!root
        )
        return [
            ...roots.flatMap((root) => windowsPaths[browser].map((path) => join(root, path))),
            ...commands[browser].map((command) => `${command}.exe`)
        ]
    }
    return commands[browser]
}

export function browserExecutable(
    browser: Browser,
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env
): string | undefined {
    for (const candidate of browserCandidates(browser, platform, env)) {
        if (isAbsolute(candidate)) {
            if (existsSync(candidate)) return candidate
        } else {
            for (const directory of (env.PATH ?? '').split(delimiter)) {
                const found = join(directory, candidate)
                if (existsSync(found)) return found
            }
        }
    }
    return undefined
}

/** Arguments for a fresh browser process using its own profile and the capture proxy. */
export function browserArguments(browser: Browser, port: number, profile: string): string[] {
    const proxy = `http://127.0.0.1:${port}`
    return browser === 'firefox'
        ? ['-no-remote', '-profile', profile, 'about:blank']
        : [
              `--user-data-dir=${profile}`,
              `--proxy-server=${proxy}`,
              '--no-first-run',
              '--no-default-browser-check',
              'about:blank'
          ]
}

/** Firefox ignores proxy environment variables, so its isolated profile carries the settings. */
export function firefoxPreferences(port: number): string {
    return [
        'user_pref("network.proxy.type", 1);',
        'user_pref("network.proxy.http", "127.0.0.1");',
        `user_pref("network.proxy.http_port", ${port});`,
        'user_pref("network.proxy.ssl", "127.0.0.1");',
        `user_pref("network.proxy.ssl_port", ${port});`,
        'user_pref("network.proxy.no_proxies_on", "localhost, 127.0.0.1, ::1");',
        // Windows/macOS read user-installed roots from the OS store with this pref.
        'user_pref("security.enterprise_roots.enabled", true);',
        ''
    ].join('\n')
}

const SLOT_PARAMS =
    'slotParams=(1={slotFlags=[ECC,RSA,DSA,DH,RC2,RC4,DES,RANDOM,SHA1,MD5,MD2,SSL,TLS,AES,Camellia,SEED,SHA256,SHA512] askpw=any timeout=30})'

/** Load the OS trust store on Linux when the distro has not wired p11-kit into NSS. */
export function p11KitTrustLibrary(
    platform: NodeJS.Platform = process.platform,
    arch: NodeJS.Architecture = process.arch,
    exists: (path: string) => boolean = existsSync
): string | undefined {
    if (platform !== 'linux') return undefined
    const gnu =
        arch === 'x64'
            ? 'x86_64-linux-gnu'
            : arch === 'arm64'
              ? 'aarch64-linux-gnu'
              : arch === 'arm'
                ? 'arm-linux-gnueabihf'
                : undefined
    return [
        ...(gnu
            ? [`/usr/lib/${gnu}/p11-kit-trust.so`, `/usr/lib/${gnu}/pkcs11/p11-kit-trust.so`]
            : []),
        '/usr/lib64/p11-kit-trust.so',
        '/usr/lib64/pkcs11/p11-kit-trust.so',
        '/usr/lib/p11-kit-trust.so',
        '/usr/lib/pkcs11/p11-kit-trust.so'
    ].find(exists)
}

/** Add p11-kit trust to the isolated profile's NSS modules without dropping existing ones. */
export function firefoxPkcs11Config(
    existing: string | undefined,
    library: string,
    profile: string
): string {
    if (existing && /p11-kit-(trust|proxy)\.so/.test(existing)) return existing
    const base =
        existing?.trimEnd() ??
        [
            'library=',
            'name=NSS Internal PKCS #11 Module',
            `parameters=configdir='sql:${profile}' certPrefix='' keyPrefix='' secmod='secmod.db' flags=optimizeSpace updatedir='' updateCertPrefix='' updateKeyPrefix='' updateid='' updateTokenDescription=''`,
            `NSS=Flags=internal,critical trustOrder=75 cipherOrder=100 ${SLOT_PARAMS}`
        ].join('\n')
    return `${base}\n\nlibrary=${library}\nname=Tapline System Roots\nNSS=trustOrder=100 cipherOrder=100 ${SLOT_PARAMS}\n`
}

/** Opens a browser instance whose traffic goes to Tapline, isolated from the default profile. */
export class CapturedBrowser {
    constructor(
        private readonly client: AgentClient,
        private readonly storagePath: string
    ) {}

    async open() {
        if (!this.client.running) {
            void vscode.window.showInformationMessage(
                vscode.l10n.t('Start capture before opening a browser.')
            )
            return
        }
        const picks = BROWSERS.flatMap((browser) => {
            const executable = browserExecutable(browser, process.platform, process.env)
            return executable
                ? [{ label: labels[browser], description: executable, browser, executable }]
                : []
        })
        if (!picks.length)
            throw new Error(vscode.l10n.t('No supported browser was found on this computer.'))
        const pick = await vscode.window.showQuickPick(picks, {
            title: vscode.l10n.t('Open a browser routed through Tapline'),
            placeHolder: vscode.l10n.t(
                'Choose a browser with its own profile and the Tapline proxy'
            )
        })
        if (!pick) return
        // Capture may stop or change ports while the picker is open.
        if (!this.client.running) {
            void vscode.window.showInformationMessage(
                vscode.l10n.t('Capture stopped; start it before opening a browser.')
            )
            return
        }
        const profile = join(this.storagePath, 'browser-profiles', pick.browser)
        await mkdir(profile, { recursive: true })
        let trusted = true
        if (pick.browser === 'firefox') {
            await writeFile(join(profile, 'user.js'), firefoxPreferences(this.client.port))
            trusted = await this.ensureFirefoxSystemRoots(profile)
        }
        const child = spawn(
            pick.executable,
            browserArguments(pick.browser, this.client.port, profile),
            { detached: true, stdio: 'ignore' }
        )
        child.once(
            'error',
            (error) =>
                void vscode.window.showErrorMessage(
                    vscode.l10n.t('Could not open {0}: {1}', pick.label, error.message)
                )
        )
        child.unref()
        void vscode.window.showInformationMessage(
            vscode.l10n.t(
                '{0} opened with an isolated profile using the Tapline proxy on 127.0.0.1:{1}.{2}',
                pick.label,
                this.client.port,
                !trusted
                    ? ' ' +
                          vscode.l10n.t(
                              'Import the root certificate into Firefox manually for HTTPS capture.'
                          )
                    : ''
            )
        )
    }

    /** Linux Firefox needs the p11-kit trust module to see the OS-installed root CA. */
    private async ensureFirefoxSystemRoots(profile: string): Promise<boolean> {
        const library = p11KitTrustLibrary()
        if (!library) return process.platform !== 'linux'
        const file = join(profile, 'pkcs11.txt')
        let existing: string | undefined
        try {
            existing = await readFile(file, 'utf8')
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false
        }
        await writeFile(file, firefoxPkcs11Config(existing, library, profile))
        return true
    }
}
