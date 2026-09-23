import { preferences } from '../preferences'
import * as vscode from 'vscode'
import type { AgentClient } from '../client'
import { SHELLS, shellEnvironment, type Shell } from '../../utils/shellEnvironment'
import {
    captureEnvironment,
    defaultDebugRuntimes,
    defaultTerminalProfiles,
    PROFILES,
    profileDescriptions,
    type CaptureTarget,
    type Profile
} from '../../utils/environment'

/**
 * Routes integrated terminals and debug sessions through the capture proxy while it
 * runs. The global terminal environment carries only generic profiles; runtime
 * specific variables go to debug sessions by type, or to terminals created with a
 * chosen runtime.
 */
export class CaptureEnvironment implements vscode.Disposable {
    private disposables: vscode.Disposable[]

    constructor(
        private context: vscode.ExtensionContext,
        private client: AgentClient
    ) {
        this.disposables = [
            client.onEvent((event) => {
                if (event.type === 'state') this.apply()
            }),
            preferences.onDidChange((change) => {
                if (
                    change.affectsConfiguration('tapline.terminal') ||
                    change.affectsConfiguration('tapline.debug') ||
                    change.affectsConfiguration('tapline.ssl')
                )
                    this.apply()
            }),
            vscode.debug.registerDebugConfigurationProvider('*', {
                resolveDebugConfigurationWithSubstitutedVariables: (_folder, config) =>
                    this.injectDebug(config)
            }),
            vscode.debug.onDidStartDebugSession((session) => this.announce(session))
        ]
        this.apply()
    }

    private target(): CaptureTarget {
        return {
            port: this.client.port,
            sslHosts: preferences.get<string[]>('ssl.hosts', []),
            sslNoHosts: preferences.get<string[]>('ssl.noHosts', []),
            certificatePath: this.client.certificatePath,
            truststorePath: this.client.truststorePath || undefined
        }
    }

    private valid(profiles: unknown): Profile[] {
        return Array.isArray(profiles)
            ? profiles.filter((p): p is Profile => PROFILES.includes(p))
            : []
    }

    /** Variables for the given profiles, or undefined when capture is not running. */
    environment(profiles: readonly Profile[], extraNoProxy?: readonly string[]) {
        const noProxy = extraNoProxy ?? preferences.get<string[]>('ssl.noProxy', [])
        return this.client.running
            ? captureEnvironment(this.target(), profiles, noProxy)
            : undefined
    }

    private apply() {
        const collection = this.context.environmentVariableCollection
        const config = preferences
        const env = this.environment(
            this.valid(config.get<Profile[]>('terminal.profiles', defaultTerminalProfiles))
        )
        if (!env) {
            collection.clear()
            return
        }
        collection.clear()
        collection.description = vscode.l10n.t(
            'Routes this terminal through Tapline (port {0})',
            this.client.port
        )
        for (const [name, value] of Object.entries(env)) collection.replace(name, value)
    }

    private injectDebug(config: vscode.DebugConfiguration) {
        if (!(config.type in defaultDebugRuntimes)) return config
        const env = this.environment(defaultDebugRuntimes[config.type])
        if (!env) return config
        // Electron's extension-host utility process can crash during startup when
        // NODE_EXTRA_CA_CERTS is supplied. Use the system-trusted CA there instead.
        if (config.type === 'extensionHost' || config.type === 'pwa-extensionHost')
            delete env.NODE_EXTRA_CA_CERTS
        return { ...config, env: { ...env, ...(config.env ?? {}) } }
    }

    /**
     * Print what was injected to the session's debug console, so a run that is or is
     * not being captured can be told apart without opening the settings.
     */
    private announce(session: vscode.DebugSession) {
        const injected = this.injectedFor(session.configuration)
        if (!injected) return
        const console = vscode.debug.activeDebugConsole
        console.appendLine(
            vscode.l10n.t(
                'Tapline: capturing through 127.0.0.1:{0}; environment injected into this session:',
                this.client.port
            )
        )
        for (const [name, value] of Object.entries(injected))
            console.appendLine(`  ${name}=${value}`)
    }

    /** The variables this session received from Tapline (its own env wins on conflicts). */
    private injectedFor(config: vscode.DebugConfiguration): Record<string, string> | undefined {
        const env = config.env as Record<string, string> | undefined
        if (!env || !this.client.running) return undefined
        const proxy = `http://127.0.0.1:${this.client.port}`
        if (env.HTTP_PROXY !== proxy && env.http_proxy !== proxy) return undefined
        const ours = this.environment(defaultDebugRuntimes[config.type] ?? []) ?? {}
        const result: Record<string, string> = {}
        for (const name of Object.keys(ours)) if (name in env) result[name] = env[name]
        return Object.keys(result).length ? result : undefined
    }

    /** Copy commands for an existing terminal using the configured terminal profiles. */
    async copyEnvironment() {
        if (!this.client.running) {
            void vscode.window.showInformationMessage(
                vscode.l10n.t('Start capture before copying the proxy environment.')
            )
            return
        }
        const previous = this.context.globalState.get<Shell>(
            'copyEnvironment.shell',
            process.platform === 'win32' ? 'PowerShell' : 'Bash'
        )
        const pick = await vscode.window.showQuickPick(
            [...SHELLS]
                .sort((a, b) => Number(b === previous) - Number(a === previous))
                .map((shell) => ({
                    label: shell,
                    description: shell === 'Bash' ? 'Bash / Zsh / sh' : undefined,
                    shell
                })),
            {
                title: vscode.l10n.t('Copy Proxy Environment'),
                placeHolder: vscode.l10n.t('Choose the shell where you will paste the commands')
            }
        )
        if (!pick) return
        // Capture may stop or change ports while the picker is open.
        const config = preferences
        const env = this.environment(
            this.valid(config.get<Profile[]>('terminal.profiles', defaultTerminalProfiles))
        )
        if (!env) {
            void vscode.window.showInformationMessage(
                vscode.l10n.t('Start capture before copying the proxy environment.')
            )
            return
        }
        if (pick.shell === 'CMD' && Object.values(env).some((value) => /["%!]/.test(value))) {
            void vscode.window.showErrorMessage(
                vscode.l10n.t(
                    'These environment values contain characters that CMD cannot safely paste. Choose PowerShell instead.'
                )
            )
            return
        }
        await vscode.env.clipboard.writeText(shellEnvironment(env, pick.shell))
        await this.context.globalState.update('copyEnvironment.shell', pick.shell)
        void vscode.window.showInformationMessage(
            vscode.l10n.t(
                'Proxy environment copied for {0}. Paste into your terminal to apply.',
                pick.shell
            )
        )
    }

    /** Open a terminal with the proxy plus one runtime's variables. */
    async openTerminal() {
        const picks: (vscode.QuickPickItem & { profiles: Profile[] })[] = [
            {
                label: vscode.l10n.t('Generic'),
                description: vscode.l10n.t(
                    'Proxy plus curl/git/Go/Ruby trust (the default for new terminals)'
                ),
                profiles: defaultTerminalProfiles
            },
            ...PROFILES.filter((p) => !defaultTerminalProfiles.includes(p)).map((p) => ({
                label:
                    p === 'node'
                        ? 'Node.js'
                        : p === 'python'
                          ? 'Python'
                          : p === 'java'
                            ? 'Java'
                            : p === 'rust'
                              ? 'Rust'
                              : p === 'deno'
                                ? 'Deno'
                                : p === 'grpc'
                                  ? 'gRPC'
                                  : p,
                description: profileDescriptions[p],
                profiles: [...defaultTerminalProfiles, p] as Profile[]
            })),
            {
                label: vscode.l10n.t('Everything'),
                description: vscode.l10n.t(
                    'All profiles at once; JVMs print a "Picked up JAVA_TOOL_OPTIONS" line'
                ),
                profiles: PROFILES
            }
        ]
        const pick = await vscode.window.showQuickPick(picks, {
            title: vscode.l10n.t('Captured terminal: which runtime will you use?')
        })
        if (!pick) return
        const env = this.environment(pick.profiles)
        const terminal = vscode.window.createTerminal({
            name: `Tapline · ${pick.label}`,
            iconPath: new vscode.ThemeIcon('broadcast'),
            env
        })
        terminal.show()
    }

    dispose() {
        this.context.environmentVariableCollection.clear()
        for (const d of this.disposables) d.dispose()
    }
}
