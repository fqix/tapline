import * as vscode from 'vscode'
import type { AgentClient } from '../client/agentClient'
import {
    captureEnvironment,
    defaultDebugRuntimes,
    defaultTerminalProfiles,
    PROFILES,
    profileDescriptions,
    type CaptureTarget,
    type Profile
} from '../utils/environment'

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
            vscode.workspace.onDidChangeConfiguration((change) => {
                if (
                    change.affectsConfiguration('tapline.terminal') ||
                    change.affectsConfiguration('tapline.debug')
                )
                    this.apply()
            }),
            vscode.debug.registerDebugConfigurationProvider('*', {
                resolveDebugConfigurationWithSubstitutedVariables: (_folder, config) =>
                    this.injectDebug(config)
            })
        ]
        this.apply()
    }

    private target(): CaptureTarget {
        return {
            port: this.client.port,
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
    environment(profiles: readonly Profile[]) {
        return this.client.running ? captureEnvironment(this.target(), profiles) : undefined
    }

    private apply() {
        const collection = this.context.environmentVariableCollection
        const config = vscode.workspace.getConfiguration('tapline')
        const env = config.get<boolean>('terminal.inject', true)
            ? this.environment(
                  this.valid(config.get<Profile[]>('terminal.profiles', defaultTerminalProfiles))
              )
            : undefined
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
        const settings = vscode.workspace.getConfiguration('tapline')
        if (!settings.get<boolean>('debug.inject', true)) return config
        const runtimes = {
            ...defaultDebugRuntimes,
            ...settings.get<Record<string, Profile[]>>('debug.runtimes', {})
        }
        if (!(config.type in runtimes)) return config
        const env = this.environment(this.valid(runtimes[config.type]))
        if (!env) return config
        return { ...config, env: { ...env, ...(config.env ?? {}) } }
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
