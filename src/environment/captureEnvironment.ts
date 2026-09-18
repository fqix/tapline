import * as vscode from 'vscode'
import type { AgentClient } from '../client/agentClient'
import { captureEnvironment } from '../utils/format'

/**
 * Routes integrated terminals and debug sessions through the capture proxy while it
 * runs. Terminals pick the variables up on creation; debug sessions get them merged
 * into the launch configuration's `env`.
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

    private variables() {
        return captureEnvironment(
            this.client.port,
            this.client.certificatePath,
            this.client.truststorePath
        )
    }

    private apply() {
        const collection = this.context.environmentVariableCollection
        const config = vscode.workspace.getConfiguration('tapline')
        if (this.client.running && config.get<boolean>('terminal.inject', true)) {
            collection.description = vscode.l10n.t(
                'Routes this terminal through Tapline (port {0})',
                this.client.port
            )
            for (const [name, value] of Object.entries(this.variables()))
                collection.replace(name, value)
        } else collection.clear()
    }

    private injectDebug(config: vscode.DebugConfiguration) {
        const settings = vscode.workspace.getConfiguration('tapline')
        if (!this.client.running || !settings.get<boolean>('debug.inject', true)) return config
        if (!settings.get<string[]>('debug.types', []).includes(config.type)) return config
        return { ...config, env: { ...this.variables(), ...(config.env ?? {}) } }
    }

    dispose() {
        this.context.environmentVariableCollection.clear()
        for (const d of this.disposables) d.dispose()
    }
}
