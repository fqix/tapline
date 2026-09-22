import { preferences } from '../preferences'
import * as vscode from 'vscode'
import { execFile } from 'node:child_process'
import type { AgentClient } from '../client'
import {
    systemTrustStore,
    type Executed,
    type Runner,
    type TrustStatus,
    type TrustStore
} from './systemTrust'

const runner: Runner = {
    platform: process.platform,
    uid: process.getuid?.(),
    exec: (file, args) =>
        new Promise<Executed>((resolve) =>
            execFile(
                file,
                args,
                { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
                (error, stdout, stderr) =>
                    resolve({
                        code:
                            error && typeof (error as { code?: unknown }).code === 'number'
                                ? (error as { code: number }).code
                                : error
                                  ? 1
                                  : 0,
                        stdout: String(stdout),
                        stderr: error && !stderr ? String(error.message) : String(stderr)
                    })
            )
        ),
    // A task keeps the sudo prompt visible and reports the exit code when it ends.
    async shell(title, file, args) {
        const task = new vscode.Task(
            { type: 'shell' },
            vscode.TaskScope.Global,
            title,
            'Tapline',
            new vscode.ShellExecution(
                file,
                args.map((value) => ({ value, quoting: vscode.ShellQuoting.Strong }))
            )
        )
        task.presentationOptions = {
            reveal: vscode.TaskRevealKind.Always,
            focus: true,
            panel: vscode.TaskPanelKind.Dedicated,
            clear: true,
            showReuseMessage: false
        }
        const execution = await vscode.tasks.executeTask(task)
        return new Promise<number>((resolve) => {
            const listener = vscode.tasks.onDidEndTaskProcess((event) => {
                if (event.execution !== execution) return
                listener.dispose()
                resolve(event.exitCode ?? 1)
            })
        })
    }
}

/**
 * Install/trust/uninstall the root CA in the operating system store and gate capture
 * on it: with TLS decryption on, `ensureTrusted` must pass before the proxy starts.
 */
export class CertificateTrust implements vscode.Disposable {
    /** Last observed status, `undefined` until the first check. */
    status?: TrustStatus
    private store?: TrustStore
    private storePath?: string
    private readonly changed = new vscode.EventEmitter<TrustStatus | undefined>()
    readonly onDidChange = this.changed.event
    private readonly focus: vscode.Disposable
    /** Store operations and status checks never interleave: a focus-triggered check
     *  during uninstall would otherwise observe (and publish) the half-removed state. */
    private chain: Promise<unknown> = Promise.resolve()

    constructor(private client: AgentClient) {
        this.publish()
        // The system password dialog and Keychain Access both take focus; re-check on
        // return so the tree reflects changes made outside the extension's own commands.
        this.focus = vscode.window.onDidChangeWindowState((state) => {
            if (state.focused && this.status !== undefined) void this.check().catch(() => undefined)
        })
    }

    private async open(): Promise<TrustStore> {
        // A connected socket may still be completing hello and preparing the CA.
        await this.client.connect()
        const path = this.client.certificatePath
        if (!path) throw new Error(vscode.l10n.t('The root certificate is not available yet.'))
        if (!this.store || this.storePath !== path) {
            this.store = systemTrustStore(path, runner)
            this.storePath = path
        }
        return this.store
    }

    private publish() {
        void vscode.commands.executeCommand(
            'setContext',
            'tapline.certificateStatus',
            this.status ?? ''
        )
        this.changed.fire(this.status)
    }

    private serial<T>(work: () => Promise<T>): Promise<T> {
        const next = this.chain.then(work, work)
        this.chain = next.catch(() => undefined)
        return next
    }

    private async refresh(store: TrustStore) {
        this.status = await store.status()
        this.client.output.info(`Root certificate: ${this.status} (${store.location})`)
        this.publish()
        return this.status
    }

    /** Query the OS store and update the `tapline.certificateStatus` context key. */
    check(): Promise<TrustStatus> {
        return this.serial(async () => this.refresh(await this.open()))
    }

    /** No host to decrypt means no certificate is involved. */
    private required() {
        return preferences.get<string[]>('ssl.hosts', ['*']).length > 0
    }

    /**
     * Resolve `true` when capture may start. Without TLS decryption no certificate is
     * involved; otherwise an untrusted CA prompts for installation first.
     */
    async ensureTrusted(modal = true): Promise<boolean> {
        if (!this.required()) return true
        let status: TrustStatus
        try {
            status = await this.check()
        } catch (error) {
            const choice = await vscode.window.showErrorMessage(
                vscode.l10n.t(
                    'Tapline could not check the root certificate: {0}',
                    error instanceof Error ? error.message : String(error)
                ),
                { modal },
                vscode.l10n.t('Reveal Root Certificate')
            )
            if (choice) await vscode.commands.executeCommand('tapline.revealCertificate')
            return false
        }
        if (status === 'trusted') return true
        const install = vscode.l10n.t('Install & Trust')
        const choice = await vscode.window.showWarningMessage(
            vscode.l10n.t(
                'Tapline needs its root certificate trusted by the operating system before capturing HTTPS.'
            ),
            {
                modal,
                detail: vscode.l10n.t(
                    'Installing prompts for your credentials. You can remove the certificate later with "Tapline: Uninstall Root Certificate".'
                )
            },
            install
        )
        if (choice !== install) return false
        await this.trust()
        return this.status === 'trusted'
    }

    private async run(
        title: string,
        step: (store: TrustStore) => Promise<void>,
        done: (status: TrustStatus, store: TrustStore) => string | undefined
    ) {
        const store = await this.open()
        const status = await this.serial(async () => {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title },
                () => step(store)
            )
            return this.refresh(store)
        })
        const message = done(status, store)
        if (message) void vscode.window.showInformationMessage(message)
    }

    install() {
        return this.run(
            vscode.l10n.t('Installing the Tapline root certificate…'),
            (store) => store.install(),
            (status, store) =>
                status === 'trusted'
                    ? vscode.l10n.t('Tapline root certificate installed and trusted.')
                    : vscode.l10n.t(
                          'Tapline root certificate added to the {0}. Run "Tapline: Trust Root Certificate" to mark it trusted.',
                          store.location
                      )
        )
    }

    trust() {
        return this.run(
            vscode.l10n.t('Trusting the Tapline root certificate…'),
            (store) => store.trust(),
            (status) =>
                status === 'trusted'
                    ? vscode.l10n.t('Tapline root certificate installed and trusted.')
                    : vscode.l10n.t('The operating system still does not trust the certificate.')
        )
    }

    async uninstall() {
        const remove = vscode.l10n.t('Uninstall')
        const choice = await vscode.window.showWarningMessage(
            vscode.l10n.t('Remove the Tapline root certificate from the operating system store?'),
            { modal: true },
            remove
        )
        if (choice !== remove) return
        if (this.client.running) await this.client.stop()
        await this.run(
            vscode.l10n.t('Removing the Tapline root certificate…'),
            (store) => store.uninstall(),
            (status) =>
                status === 'missing'
                    ? vscode.l10n.t('Tapline root certificate removed.')
                    : vscode.l10n.t(
                          'The certificate is still present in the operating system store.'
                      )
        )
    }

    /** Status line for quick picks and messages. */
    describe(): string {
        switch (this.status) {
            case 'trusted':
                return vscode.l10n.t('Root certificate trusted by the operating system')
            case 'installed':
                return vscode.l10n.t('Root certificate installed but not trusted')
            case 'missing':
                return vscode.l10n.t('Root certificate not installed')
            default:
                return vscode.l10n.t('Root certificate status unknown')
        }
    }

    dispose() {
        this.focus.dispose()
        this.changed.dispose()
    }
}
