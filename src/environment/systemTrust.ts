import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Operating-system trust for the Tapline root CA. Per-process variables cover curl,
 * Node, Python and friends, but system frameworks and browsers only honour the OS
 * store, and capture refuses to start until the CA is trusted there.
 *
 * `trusted`   the OS validates certificates issued by the CA
 * `installed` the CA is in the store but not marked trusted (macOS distinguishes the two)
 * `missing`   the CA is not in the store
 */
export type TrustStatus = 'trusted' | 'installed' | 'missing'

export interface Executed {
    code: number
    stdout: string
    stderr: string
}

/** Process execution, abstracted so the command plans can be tested without a real store. */
export interface Runner {
    /** Run a program directly; native prompts (Keychain, certutil) appear on their own. */
    exec(file: string, args: string[]): Promise<Executed>
    /** Run in a terminal where the user can answer a `sudo` prompt; resolves to the exit code. */
    shell(title: string, file: string, args: string[]): Promise<number>
    platform: NodeJS.Platform
    uid?: number
}

export interface TrustStore {
    /** Where the certificate is installed, for messages. */
    readonly location: string
    /** Whether `install` and `trust` are distinct steps on this platform. */
    readonly separateTrustStep: boolean
    status(): Promise<TrustStatus>
    install(): Promise<void>
    trust(): Promise<void>
    uninstall(): Promise<void>
}

export const CERTIFICATE_NAME = 'Tapline Root CA'

/** Uppercase hex SHA-1 of the DER certificate: the key both `security` and `certutil` use. */
export function fingerprint(pem: string): string {
    const der = Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64')
    return createHash('sha1').update(der).digest('hex').toUpperCase()
}

function fail(step: string, result: Executed): never {
    const detail = (result.stderr || result.stdout).trim().split('\n').pop() ?? ''
    throw new Error(`${step} failed (exit ${result.code})${detail ? `: ${detail}` : ''}`)
}

/* Double quotes: the whole script is handed to the terminal inside single quotes. */
function quote(path: string) {
    return `"${path.replace(/[\\"$`]/g, '\\$&')}"`
}

/* macOS: the login keychain plus user trust settings. `add-trusted-cert` and
 * `remove-trusted-cert` raise the system authorization dialog on their own. */
function darwin(
    certificate: string,
    runner: Runner,
    home: string,
    exists: (path: string) => boolean
): TrustStore {
    const keychains = [
        join(home, 'Library', 'Keychains', 'login.keychain-db'),
        join(home, 'Library', 'Keychains', 'login.keychain')
    ]
    const keychain = keychains.find(exists) ?? keychains[0]
    const hash = () => fingerprint(readFileSync(certificate, 'utf8'))
    const security = (...args: string[]) => runner.exec('security', args)
    return {
        location: 'login keychain',
        separateTrustStep: true,
        async status() {
            if ((await security('verify-cert', '-c', certificate, '-L')).code === 0)
                return 'trusted'
            const found = await security('find-certificate', '-a', '-Z', '-c', CERTIFICATE_NAME)
            return found.stdout.toUpperCase().includes(hash()) ? 'installed' : 'missing'
        },
        async install() {
            const result = await security('add-certificates', '-k', keychain, certificate)
            // "already in <keychain>" (macOS 12+) or "already exists in the keychain".
            if (result.code !== 0 && !/already (in|exists)/i.test(result.stderr + result.stdout))
                fail('security add-certificates', result)
        },
        async trust() {
            const result = await security(
                'add-trusted-cert',
                '-r',
                'trustRoot',
                '-k',
                keychain,
                certificate
            )
            if (result.code !== 0) fail('security add-trusted-cert', result)
        },
        async uninstall() {
            // Trust settings live apart from the keychain item; drop both, tolerating absence.
            await security('remove-trusted-cert', certificate)
            const result = await security('delete-certificate', '-Z', hash(), '-t', keychain)
            if (result.code !== 0 && !/could not be found|not found/i.test(result.stderr))
                fail('security delete-certificate', result)
        }
    }
}

/* Windows: the current user's Trusted Root store. `certutil -user -addstore Root`
 * shows the standard confirmation dialog; membership implies trust. */
function windows(certificate: string, runner: Runner): TrustStore {
    const hash = () => fingerprint(readFileSync(certificate, 'utf8'))
    const certutil = (...args: string[]) => runner.exec('certutil', args)
    const stepsInstall = async () => {
        const result = await certutil('-user', '-addstore', 'Root', certificate)
        if (result.code !== 0) fail('certutil -addstore', result)
    }
    return {
        location: 'current user Trusted Root Certification Authorities',
        separateTrustStep: false,
        async status() {
            return (await certutil('-user', '-store', 'Root', hash())).code === 0
                ? 'trusted'
                : 'missing'
        },
        install: stepsInstall,
        trust: stepsInstall,
        async uninstall() {
            const result = await certutil('-user', '-delstore', 'Root', hash())
            if (result.code !== 0 && !/not found|cannot find/i.test(result.stderr + result.stdout))
                fail('certutil -delstore', result)
        }
    }
}

/** Distribution anchor directories, in detection order. */
export const LINUX_ANCHORS = [
    {
        directory: '/usr/local/share/ca-certificates',
        file: 'tapline-root-ca.crt',
        update: 'update-ca-certificates'
    },
    {
        directory: '/etc/pki/ca-trust/source/anchors',
        file: 'tapline-root-ca.pem',
        update: 'update-ca-trust'
    },
    {
        directory: '/etc/ca-certificates/trust-source/anchors',
        file: 'tapline-root-ca.pem',
        update: 'trust extract-compat'
    }
] as const

/* Linux: a system anchor plus the distribution's bundle refresh, which needs root.
 * The command runs in a terminal so the user can answer the sudo prompt. */
function linux(certificate: string, runner: Runner, exists: (path: string) => boolean): TrustStore {
    const anchor = LINUX_ANCHORS.find((a) => exists(a.directory))
    if (!anchor)
        throw new Error(
            `No system CA anchor directory found (${LINUX_ANCHORS.map((a) => a.directory).join(', ')}); import ${certificate} manually.`
        )
    const target = join(anchor.directory, anchor.file)
    const run = async (title: string, script: string) => {
        const argv = ['sh', '-c', script]
        const code =
            runner.uid === 0
                ? await runner.shell(title, argv[0], argv.slice(1))
                : await runner.shell(title, 'sudo', argv)
        if (code !== 0) throw new Error(`${title} failed (exit ${code})`)
    }
    const install = () =>
        run(
            'Install Tapline root certificate',
            `cp ${quote(certificate)} ${quote(target)} && chmod 644 ${quote(target)} && ${anchor.update}`
        )
    return {
        location: target,
        separateTrustStep: false,
        async status() {
            try {
                return readFileSync(target, 'utf8').trim() ===
                    readFileSync(certificate, 'utf8').trim()
                    ? 'trusted'
                    : 'missing'
            } catch {
                return 'missing'
            }
        },
        install,
        trust: install,
        uninstall: () =>
            run('Uninstall Tapline root certificate', `rm -f ${quote(target)} && ${anchor.update}`)
    }
}

/** The OS trust store for this platform; throws when none is supported. */
export function systemTrustStore(
    certificate: string,
    runner: Runner,
    home = homedir(),
    exists: (path: string) => boolean = existsSync
): TrustStore {
    switch (runner.platform) {
        case 'darwin':
            return darwin(certificate, runner, home, exists)
        case 'win32':
            return windows(certificate, runner)
        case 'linux':
            return linux(certificate, runner, exists)
        default:
            throw new Error(`Certificate installation is not supported on ${runner.platform}`)
    }
}
