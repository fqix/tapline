import * as vscode from 'vscode'
import { randomBytes } from 'node:crypto'
import type { AgentClient } from '../client/agentClient'
import type { HostMessage, PanelMessage } from '../webview/vscode'

/**
 * One reusable webview showing either a transaction (Overview / Request /
 * Response) or a host summary, kept live from agent events.
 */
export class DetailPanel implements vscode.Disposable {
    private panel?: vscode.WebviewPanel
    private current?: { kind: 'transaction'; id: string } | { kind: 'host'; host: string }
    private disposables: vscode.Disposable[] = []

    constructor(
        private context: vscode.ExtensionContext,
        private client: AgentClient,
        private actions: {
            copyCurl(id: string): Promise<void>
            replay(id: string): Promise<void>
            openText(id: string): Promise<void>
            openBody(id: string, side: 'request' | 'response'): Promise<void>
        }
    ) {
        this.disposables.push(
            client.onEvent((event) => {
                if (!this.panel || !this.current) return
                if (event.type === 'transaction') {
                    if (
                        this.current.kind === 'transaction' &&
                        event.transaction.id === this.current.id
                    )
                        this.post({ type: 'transaction', transaction: event.transaction })
                    else if (
                        this.current.kind === 'host' &&
                        event.transaction.host === this.current.host
                    )
                        this.postHost(this.current.host)
                } else if (event.type === 'state') this.replay()
            })
        )
    }

    showTransaction(id: string, column = vscode.ViewColumn.Active) {
        this.current = { kind: 'transaction', id }
        this.ensure(column)
        this.replay()
    }

    showHost(host: string, column = vscode.ViewColumn.Active) {
        this.current = { kind: 'host', host }
        this.ensure(column)
        this.replay()
    }

    private replay() {
        if (!this.current) return
        if (this.current.kind === 'transaction') {
            const t = this.client.transactions.get(this.current.id)
            if (t) {
                this.panel!.title = `${t.method} ${t.host}${t.path.split('?')[0]}`.slice(0, 80)
                this.post({ type: 'transaction', transaction: t })
            } else this.post({ type: 'gone' })
        } else this.postHost(this.current.host)
    }

    private postHost(host: string) {
        this.panel!.title = host
        const transactions = [...this.client.transactions.values()]
            .filter((t) => t.host === host)
            .sort((a, b) => b.sequence - a.sequence)
        this.post({ type: 'host', summary: { host, transactions } })
    }

    private post(message: HostMessage) {
        void this.panel?.webview.postMessage(message)
    }

    private ensure(column: vscode.ViewColumn) {
        if (this.panel) {
            this.panel.reveal(column, true)
            return
        }
        const panel = (this.panel = vscode.window.createWebviewPanel(
            'tapline.detail',
            'Tapline',
            { viewColumn: column, preserveFocus: true },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')]
            }
        ))
        panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'activity.svg')
        panel.webview.html = this.html(panel.webview)
        panel.webview.onDidReceiveMessage((message: PanelMessage) => void this.receive(message))
        panel.onDidDispose(() => {
            this.panel = undefined
            this.current = undefined
        })
    }

    private async receive(message: PanelMessage) {
        try {
            switch (message.type) {
                case 'ready':
                    this.replay()
                    return
                case 'copy':
                    await vscode.env.clipboard.writeText(message.text)
                    void vscode.window.setStatusBarMessage(vscode.l10n.t('Copied'), 1500)
                    return
                case 'copyCurl':
                    return this.actions.copyCurl(message.id)
                case 'replay':
                    return this.actions.replay(message.id)
                case 'openText':
                    return this.actions.openText(message.id)
                case 'openBody':
                    return this.actions.openBody(message.id, message.side)
                case 'open':
                    return this.showTransaction(message.id)
            }
        } catch (error) {
            void vscode.window.showErrorMessage(
                vscode.l10n.t(
                    'Tapline: {0}',
                    error instanceof Error ? error.message : String(error)
                )
            )
        }
    }

    private html(webview: vscode.Webview) {
        const nonce = randomBytes(16).toString('hex')
        const script = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js')
        )
        const style = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css')
        )
        const strings = JSON.stringify({
            overview: vscode.l10n.t('Overview'),
            request: vscode.l10n.t('Request'),
            response: vscode.l10n.t('Response'),
            frames: vscode.l10n.t('Frames'),
            headers: vscode.l10n.t('Headers'),
            body: vscode.l10n.t('Body'),
            raw: vscode.l10n.t('Raw'),
            pretty: vscode.l10n.t('Pretty'),
            copy: vscode.l10n.t('Copy'),
            copyCurl: vscode.l10n.t('Copy as cURL'),
            replay: vscode.l10n.t('Replay'),
            openText: vscode.l10n.t('Open as Text'),
            openEditor: vscode.l10n.t('Open in Editor'),
            pending: vscode.l10n.t('Waiting for response…'),
            noBody: vscode.l10n.t('No body'),
            binary: vscode.l10n.t('Binary body ({0} bytes)'),
            truncated: vscode.l10n.t(
                'Body truncated to the retained limit; the full body was forwarded.'
            ),
            tunnel: vscode.l10n.t('TLS was not decrypted for this host (see tapline.ssl.hosts).'),
            gone: vscode.l10n.t('This request is no longer available.'),
            url: vscode.l10n.t('URL'),
            method: vscode.l10n.t('Method'),
            status: vscode.l10n.t('Status'),
            protocol: vscode.l10n.t('Protocol'),
            client: vscode.l10n.t('Client'),
            time: vscode.l10n.t('Time'),
            duration: vscode.l10n.t('Duration'),
            sizes: vscode.l10n.t('Size'),
            sent: vscode.l10n.t('sent'),
            received: vscode.l10n.t('received'),
            timing: vscode.l10n.t('Timing'),
            error: vscode.l10n.t('Error'),
            requests: vscode.l10n.t('Requests'),
            hostTitle: vscode.l10n.t('Host overview'),
            statusCodes: vscode.l10n.t('Status codes'),
            totalReceived: vscode.l10n.t('Total received'),
            totalSent: vscode.l10n.t('Total sent'),
            replayOf: vscode.l10n.t('Replay of an earlier request')
        })
        return `<!DOCTYPE html>
<html lang="${vscode.env.language}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>Tapline</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">window.__strings = ${strings};</script>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`
    }

    dispose() {
        this.panel?.dispose()
        for (const d of this.disposables) d.dispose()
    }
}
