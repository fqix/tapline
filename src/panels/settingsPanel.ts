import * as vscode from 'vscode'
import { randomBytes } from 'node:crypto'
import type { AgentClient } from '../client/agentClient'
import { preferences } from '../preferences'
import type { HostMessage, PanelMessage } from '../webview/types/messages'

/** Settings owns an editor tab independently of the traffic view. */
export class SettingsPanel implements vscode.Disposable {
    private panel?: vscode.WebviewPanel
    private readonly changes = preferences.onDidChange(() => this.post())

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly client: AgentClient
    ) {}

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
        const message: HostMessage = {
            type: 'settings',
            values: preferences.values(),
            target: {
                // 0 while capture is stopped: the port is assigned when it starts.
                port: this.client.port || 0,
                certificatePath: this.client.certificatePath || '<tapline-ca.pem>',
                truststorePath: this.client.truststorePath || '<tapline-truststore.p12>'
            },
            ...result
        }
        void panel.webview.postMessage(message)
    }

    private async receive(panel: vscode.WebviewPanel, message: PanelMessage) {
        switch (message.type) {
            case 'loadSettings':
                this.post({}, panel)
                return
            case 'saveSetting':
                try {
                    await preferences.update(message.key, message.value)
                    this.post({ saved: message.key }, panel)
                } catch (error) {
                    this.post({ error: String(error) }, panel)
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
        this.panel?.dispose()
    }
}
