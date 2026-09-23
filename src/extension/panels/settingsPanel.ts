import * as vscode from 'vscode'
import { randomBytes } from 'node:crypto'
import type { AgentClient } from '../client'
import { preferences } from '../preferences'
import type { HostMessage, PanelMessage } from '../../webview/types/messages'

type ProxyClient = Pick<AgentClient, 'running' | 'port'>
const managed = new WeakMap<
    ProxyClient,
    { value?: string; previous?: string; queue: Promise<void> }
>()
function proxyOperation(
    client: ProxyClient,
    operation: (state: NonNullable<ReturnType<typeof managed.get>>) => Promise<void>
) {
    let state = managed.get(client)
    if (!state) managed.set(client, (state = { queue: Promise.resolve() }))
    const next = state.queue.then(() => operation(state!))
    state.queue = next.catch(() => {})
    return next
}

/** Change only the user override; retain its previous value for lifecycle cleanup. */
export function updateVSCodeProxy(client: ProxyClient, enabled: boolean) {
    return proxyOperation(client, async (state) => {
        if (
            enabled &&
            (!client.running ||
                !Number.isInteger(client.port) ||
                client.port < 1 ||
                client.port > 65535)
        )
            throw new Error(vscode.l10n.t('Start capture before setting the VS Code proxy.'))
        const config = vscode.workspace.getConfiguration('http')
        const current = config.inspect<string>('proxy')?.globalValue
        const next = enabled ? `http://127.0.0.1:${client.port}` : undefined
        const previous = current === state.value ? state.previous : current
        await config.update('proxy', next, vscode.ConfigurationTarget.Global)
        state.previous = enabled ? previous : undefined
        state.value = next
    })
}

/** Follow this window's port, restoring prior settings only while we still own the value. */
export function synchronizeVSCodeProxy(client: ProxyClient, closing = false) {
    return proxyOperation(client, async (state) => {
        if (!state.value) return
        const config = vscode.workspace.getConfiguration('http')
        if (config.inspect<string>('proxy')?.globalValue !== state.value) {
            state.value = state.previous = undefined
            return
        }
        const next =
            !closing && client.running && client.port > 0
                ? `http://127.0.0.1:${client.port}`
                : state.previous
        if (next !== state.value)
            await config.update('proxy', next, vscode.ConfigurationTarget.Global)
        state.value = !closing && client.running ? next : undefined
        if (!state.value) state.previous = undefined
    })
}

/** Settings owns an editor tab independently of the traffic view. */
export class SettingsPanel implements vscode.Disposable {
    private panel?: vscode.WebviewPanel
    private readonly changes = preferences.onDidChange(() => this.post())
    private readonly configurationChanges = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('http.proxy')) this.post()
    })
    private readonly stateChanges: vscode.Disposable

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly client: AgentClient
    ) {
        this.stateChanges = client.onEvent((event) => {
            if (event.type === 'state') {
                this.post()
                void synchronizeVSCodeProxy(client)
                    .then(() => this.post())
                    .catch((error) =>
                        this.post({ error: error instanceof Error ? error.message : String(error) })
                    )
            }
        })
    }

    show() {
        if (this.panel) {
            this.panel.reveal()
            return
        }
        const panel = vscode.window.createWebviewPanel(
            'tapline.settings.panel',
            `Tapline: ${vscode.l10n.t('Settings')}`,
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')]
            }
        )
        this.panel = panel
        panel.iconPath = new vscode.ThemeIcon('settings-gear')
        const messages = panel.webview.onDidReceiveMessage((message: PanelMessage) => {
            void this.receive(panel, message)
        })
        panel.onDidDispose(() => {
            messages.dispose()
            if (this.panel === panel) this.panel = undefined
        })
        panel.webview.html = this.html(panel.webview)
    }

    private post(result: { saved?: string; error?: string } = {}, panel = this.panel) {
        if (!panel) return
        const config = vscode.workspace.getConfiguration('http')
        const configured = config.inspect<string>('proxy')
        const effective = config.get<string>('proxy') || ''
        const current = `http://127.0.0.1:${this.client.port}`
        const message: HostMessage = {
            type: 'settings',
            values: preferences.values(),
            vscodeProxy: {
                configured:
                    vscode.workspace.getConfiguration('http').inspect('proxy')?.globalValue !==
                    undefined,
                canSet: this.client.running && this.client.port > 0,
                effective,
                scope:
                    configured?.workspaceFolderValue !== undefined
                        ? 'folder'
                        : configured?.workspaceValue !== undefined
                          ? 'workspace'
                          : 'user',
                matches: this.client.running && effective === current
            },
            target: {
                sslHosts: preferences.get<string[]>('ssl.hosts', []),
                sslNoHosts: preferences.get<string[]>('ssl.noHosts', []),
                // 0 while capture is stopped: the port is assigned when it starts.
                port: this.client.port || 0,
                certificatePath: this.client.certificatePath || '<tapline-ca.pem>',
                caBundlePath: this.client.caBundlePath || '<tapline-ca-bundle.pem>',
                truststorePath: this.client.truststorePath || '<tapline-truststore.p12>'
            },
            ...result
        }
        void panel.webview.postMessage(message)
    }

    private async receive(panel: vscode.WebviewPanel, message: PanelMessage) {
        switch (message.type) {
            case 'setVSCodeProxy':
            case 'removeVSCodeProxy':
                try {
                    await updateVSCodeProxy(this.client, message.type === 'setVSCodeProxy')
                    this.post({ saved: 'http.proxy' }, panel)
                } catch (error) {
                    this.post(
                        { error: error instanceof Error ? error.message : String(error) },
                        panel
                    )
                }
                return
            case 'loadSettings':
                this.post({}, panel)
                return
            case 'saveSetting':
                try {
                    await preferences.update(message.key, message.value)
                    this.post({ saved: message.key }, panel)
                } catch (error) {
                    this.post(
                        { error: error instanceof Error ? error.message : String(error) },
                        panel
                    )
                }
                return
            case 'closeSettings':
                panel.dispose()
                return
            case 'openRules':
                await vscode.commands.executeCommand('tapline.rules')
        }
    }

    private html(webview: vscode.Webview) {
        const nonce = randomBytes(16).toString('hex')
        const asset = (name: string) =>
            webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', name))
        return `<!DOCTYPE html>
<html lang="${vscode.env.language}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('webview.css')}">
<title>Tapline Settings</title>
</head>
<body data-view="settings">
<div id="root"></div>
<script nonce="${nonce}" src="${asset('webview.js')}"></script>
</body>
</html>`
    }

    dispose() {
        this.changes.dispose()
        this.configurationChanges.dispose()
        this.stateChanges.dispose()
        this.panel?.dispose()
    }
}
