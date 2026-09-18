import * as vscode from 'vscode'
import { randomBytes } from 'node:crypto'
import type { AgentClient } from '../client/agentClient'
import type { Transaction } from '../shared/model'
import { toRow, type HostMessage, type PanelMessage } from '../webview/types/messages'

export interface PanelActions {
    copyCurl(id: string): Promise<void>
    replay(id: string): Promise<Transaction>
    openText(id: string): Promise<void>
    openBody(id: string, side: 'request' | 'response'): Promise<void>
    delete(ids: string[]): Promise<void>
}

/**
 * The single Tapline webview: a sequence table with an inspector for the selected
 * request. Rows arrive incrementally; the full record is pushed only for the selection.
 */
export class TrafficPanel implements vscode.Disposable {
    private panel?: vscode.WebviewPanel
    /** Messages sent before the page reported `ready` would be lost; they are replayed after it. */
    private queued: HostMessage[] = []
    private ready = false
    private selected?: string
    private dirty = new Set<string>()
    private rowsTimer?: NodeJS.Timeout
    private disposables: vscode.Disposable[] = []

    constructor(
        private context: vscode.ExtensionContext,
        private client: AgentClient,
        private actions: PanelActions
    ) {
        this.disposables.push(
            client.onEvent((event) => {
                if (!this.panel) return
                if (event.type === 'transaction') {
                    const t = event.transaction
                    this.dirty.add(t.id)
                    this.scheduleRows()
                    if (t.id === this.selected) this.post({ type: 'detail', transaction: t })
                } else if (event.type === 'state') this.postAll()
            })
        )
    }

    show(column = vscode.ViewColumn.Active) {
        this.ensure(column)
    }

    /** Select a request and scroll it into view. */
    focus(id: string, column = vscode.ViewColumn.Active) {
        this.ensure(column)
        this.selected = id
        this.post({ type: 'focus', id })
        this.postDetail()
    }

    /** Filter the table to one host and show its overview. */
    showHost(host: string, column = vscode.ViewColumn.Active) {
        this.ensure(column)
        this.post({ type: 'host', host })
    }

    private postAll() {
        clearTimeout(this.rowsTimer)
        this.rowsTimer = undefined
        this.dirty.clear()
        this.post({
            type: 'rows',
            rows: [...this.client.transactions.values()].map(toRow),
            reset: true
        })
        this.postDetail()
    }

    private postDetail() {
        const t = this.selected ? this.client.transactions.get(this.selected) : undefined
        if (t) this.post({ type: 'detail', transaction: t })
    }

    /** Coalesce bursts of transaction events into one batch of changed rows. */
    private scheduleRows() {
        if (this.rowsTimer) return
        this.rowsTimer = setTimeout(() => {
            this.rowsTimer = undefined
            const rows: HostMessage & { type: 'rows' } = { type: 'rows', rows: [], reset: false }
            for (const id of this.dirty) {
                const t = this.client.transactions.get(id)
                if (t) rows.rows.push(toRow(t))
            }
            this.dirty.clear()
            if (rows.rows.length) this.post(rows)
        }, 150)
    }

    private post(message: HostMessage) {
        if (!this.panel) return
        if (!this.ready) {
            if (message.type !== 'rows' && message.type !== 'detail') this.queued.push(message)
            return
        }
        void this.panel.webview.postMessage(message)
    }

    private ensure(column: vscode.ViewColumn) {
        if (this.panel) {
            this.panel.reveal(column, true)
            return
        }
        const panel = (this.panel = vscode.window.createWebviewPanel(
            'tapline.traffic.panel',
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
            clearTimeout(this.rowsTimer)
            this.rowsTimer = undefined
            this.dirty.clear()
            this.queued = []
            this.ready = false
            this.panel = undefined
        })
    }

    private async receive(message: PanelMessage) {
        try {
            switch (message.type) {
                case 'ready': {
                    this.ready = true
                    this.postAll()
                    const queued = this.queued
                    this.queued = []
                    for (const message of queued) this.post(message)
                    return
                }
                case 'copy':
                    await vscode.env.clipboard.writeText(message.text)
                    void vscode.window.setStatusBarMessage(vscode.l10n.t('Copied'), 1500)
                    return
                case 'copyCurl':
                    return this.actions.copyCurl(message.id)
                case 'replay': {
                    const replayed = await this.actions.replay(message.id)
                    this.focus(replayed.id)
                    return
                }
                case 'openText':
                    return this.actions.openText(message.id)
                case 'openBody':
                    return this.actions.openBody(message.id, message.side)
                case 'select':
                    this.selected = message.id
                    this.postDetail()
                    return
                case 'delete':
                    return this.actions.delete(message.ids)
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
        const asset = (name: string) =>
            webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', name))
        const strings = JSON.stringify(panelStrings())
        return `<!DOCTYPE html>
<html lang="${vscode.env.language}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('webview.css')}">
<title>Tapline</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">window.__strings = ${strings};</script>
<script nonce="${nonce}" src="${asset('webview.js')}"></script>
</body>
</html>`
    }

    dispose() {
        clearTimeout(this.rowsTimer)
        this.panel?.dispose()
        for (const d of this.disposables) d.dispose()
    }
}

/** Localised strings handed to the webview; keys match `t()` calls in src/webview. */
function panelStrings(): Record<string, string> {
    return {
        overview: vscode.l10n.t('Overview'),
        request: vscode.l10n.t('Request'),
        response: vscode.l10n.t('Response'),
        frames: vscode.l10n.t('Frames'),
        events: vscode.l10n.t('SSE Events'),
        eventsWaiting: vscode.l10n.t('Waiting for events…'),
        eventsEmpty: vscode.l10n.t('No complete events were captured.'),
        eventsTruncated: vscode.l10n.t(
            'Only recent events within the capture limit are retained. Oversized events are omitted; all traffic is forwarded.'
        ),
        headers: vscode.l10n.t('Headers'),
        trailers: vscode.l10n.t('Trailers'),
        body: vscode.l10n.t('Body'),
        messages: vscode.l10n.t('Messages'),
        compressed: vscode.l10n.t('compressed'),
        grpcNoSchema: vscode.l10n.t(
            'Decoded by field number. Add the .proto files to the workspace (tapline.grpc.protoFiles) to see field names.'
        ),
        grpcUndecodable: vscode.l10n.t('Not a valid protobuf message'),
        pretty: vscode.l10n.t('Pretty'),
        text: vscode.l10n.t('Text'),
        hex: vscode.l10n.t('Hex'),
        query: vscode.l10n.t('Query String'),
        cookies: vscode.l10n.t('Cookies'),
        setCookies: 'Set-Cookie',
        form: vscode.l10n.t('Form'),
        copy: vscode.l10n.t('Copy'),
        copyUrl: vscode.l10n.t('Copy URL'),
        copyCurl: vscode.l10n.t('Copy as cURL'),
        replay: vscode.l10n.t('Replay'),
        delete: vscode.l10n.t('Delete'),
        openText: vscode.l10n.t('Open as Text'),
        openEditor: vscode.l10n.t('Open in Editor'),
        pending: vscode.l10n.t('Waiting for response…'),
        pendingShort: vscode.l10n.t('pending'),
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
        contentTypes: vscode.l10n.t('Content types'),
        protocols: vscode.l10n.t('Protocols'),
        durationSummary: vscode.l10n.t('Durations'),
        total: vscode.l10n.t('total'),
        average: vscode.l10n.t('average'),
        max: vscode.l10n.t('max'),
        totalReceived: vscode.l10n.t('Total received'),
        totalSent: vscode.l10n.t('Total sent'),
        replayOf: vscode.l10n.t('Replay of an earlier request'),
        showOriginal: vscode.l10n.t('Show original'),
        filterPlaceholder: vscode.l10n.t('Filter by URL, method or status…'),
        rowsCount: vscode.l10n.t('{0} of {1}'),
        selectRow: vscode.l10n.t('Select a request to see its details'),
        empty: vscode.l10n.t('No requests captured yet'),
        noMatch: vscode.l10n.t('No requests match the filter'),
        all: vscode.l10n.t('All'),
        errors: vscode.l10n.t('Errors'),
        hideTunnels: vscode.l10n.t('Hide CONNECT tunnels'),
        clearFilters: vscode.l10n.t('Clear filters'),
        layoutStacked: vscode.l10n.t('Inspector below'),
        layoutSide: vscode.l10n.t('Inspector to the right'),
        'col.sequence': '#',
        'col.status': vscode.l10n.t('Code'),
        'col.method': vscode.l10n.t('Method'),
        'col.host': vscode.l10n.t('Host'),
        'col.path': vscode.l10n.t('Path'),
        'col.timestamp': vscode.l10n.t('Start'),
        'col.duration': vscode.l10n.t('Duration'),
        'col.responseBytes': vscode.l10n.t('Size')
    }
}
