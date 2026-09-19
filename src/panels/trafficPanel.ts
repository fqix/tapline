import * as vscode from 'vscode'
import { randomBytes } from 'node:crypto'
import type { AgentClient } from '../client/agentClient'
import type { BreakpointEdit, ComposeRequest, Rule, Transaction } from '../shared/model'
import { searchTransactions } from '../utils/search'
import {
    toRow,
    type ComposeDraft,
    type HostMessage,
    type Pane,
    type PanelMessage
} from '../webview/types/messages'

export interface PanelActions {
    compareOriginal(id: string): Promise<void>
    compare(ids: string[]): Promise<void>
    copyCurl(ids: string[]): Promise<void>
    replay(id: string): Promise<Transaction>
    compose(request: ComposeRequest): Promise<Transaction>
    openText(id: string): Promise<void>
    openBody(id: string, side: 'request' | 'response'): Promise<void>
    delete(ids: string[]): Promise<void>
    exportHar(ids: string[]): Promise<void>
    saveRules(rules: Rule[]): Promise<void>
    resume(id: string, edit: BreakpointEdit): Promise<void>
    abort(id: string): Promise<void>
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
    /** Transactions already revealed for a breakpoint, so updates do not steal focus twice. */
    private revealed = new Set<string>()

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
                    if (t.paused && !this.revealed.has(`${t.id}:${t.paused}`)) {
                        this.revealed.add(`${t.id}:${t.paused}`)
                        this.focus(t.id, vscode.ViewColumn.Active, true)
                    } else if (!t.paused && t.state !== 'pending') {
                        this.revealed.delete(`${t.id}:request`)
                        this.revealed.delete(`${t.id}:response`)
                    }
                } else if (event.type === 'state') this.postAll()
            }),
            vscode.workspace.onDidChangeConfiguration((change) => {
                if (change.affectsConfiguration('tapline.rules')) this.postRules()
            })
        )
    }

    /** Open the composer (optionally prefilled), the rules editor or the statistics. */
    showPane(pane: Pane, draft?: ComposeDraft, column = vscode.ViewColumn.Active) {
        this.ensure(column)
        this.post({ type: 'pane', pane, draft })
    }

    private postRules() {
        this.post({ type: 'rules', rules: this.client.rules() })
    }

    show(column = vscode.ViewColumn.Active) {
        this.ensure(column)
    }

    /** Select a request and scroll it into view; `reveal` also brings the panel forward. */
    focus(id: string, column = vscode.ViewColumn.Active, reveal = false) {
        this.ensure(column, reveal)
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

    private ensure(column: vscode.ViewColumn, reveal = false) {
        if (this.panel) {
            this.panel.reveal(column, !reveal)
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
                    this.postRules()
                    const queued = this.queued
                    this.queued = []
                    for (const message of queued) this.post(message)
                    return
                }
                case 'copy':
                    await vscode.env.clipboard.writeText(message.text)
                    void vscode.window.setStatusBarMessage(vscode.l10n.t('Copied'), 1500)
                    return
                case 'compareOriginal':
                    return await this.actions[message.type](message.id)
                case 'compare':
                    return await this.actions.compare(message.ids)
                case 'copyCurl':
                    return this.actions.copyCurl(message.ids)
                case 'replay': {
                    const replayed = await this.actions.replay(message.id)
                    this.focus(replayed.id)
                    return
                }
                case 'resendFrame': {
                    let error: string | undefined
                    try {
                        await this.client.call('resendFrame', {
                            transaction: message.id,
                            frame: message.frameId
                        })
                    } catch (caught) {
                        error = caught instanceof Error ? caught.message : String(caught)
                    }
                    this.post({
                        type: 'frameResent',
                        id: message.id,
                        frameId: message.frameId,
                        error
                    })
                    return
                }
                case 'compose': {
                    const sent = await this.actions.compose(message.request)
                    this.focus(sent.id)
                    return
                }
                case 'exportHar':
                    return this.actions.exportHar(message.ids)
                case 'saveRules':
                    return this.actions.saveRules(message.rules)
                case 'resume':
                    return this.actions.resume(message.id, message.edit)
                case 'abort':
                    return this.actions.abort(message.id)
                case 'search':
                    this.post({
                        type: 'search',
                        query: message.query,
                        ids: searchTransactions(this.client.transactions.values(), message.query)
                    })
                    return
                case 'pickFile': {
                    const picked = await vscode.window.showOpenDialog({
                        canSelectMany: false,
                        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
                        title: vscode.l10n.t('Choose the file to serve')
                    })
                    if (picked?.[0])
                        this.post({
                            type: 'pickedFile',
                            ruleId: message.ruleId,
                            path: picked[0].fsPath
                        })
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
        compareOriginal: vscode.l10n.t('Compare with Original Request'),
        compare: vscode.l10n.t('Compare Requests'),
        overview: vscode.l10n.t('Overview'),
        request: vscode.l10n.t('Request'),
        response: vscode.l10n.t('Response'),
        frames: vscode.l10n.t('Frames'),
        streamSearch: vscode.l10n.t('Search messages…'),
        streamClearSearch: vscode.l10n.t('Clear message search'),
        streamDirection: vscode.l10n.t('Message direction'),
        streamAll: vscode.l10n.t('Both directions'),
        streamSent: vscode.l10n.t('Sent'),
        streamReceived: vscode.l10n.t('Received'),
        streamCount: vscode.l10n.t('{0} / {1} messages'),
        streamPause: vscode.l10n.t('Pause display'),
        streamResume: vscode.l10n.t('Follow latest'),
        streamPaused: vscode.l10n.t('Display paused; capture continues.'),
        streamNew: vscode.l10n.t('{0} new messages retained'),
        streamNoMatches: vscode.l10n.t('No matching messages'),
        streamCopy: vscode.l10n.t('Copy message'),
        streamCopyBase64: vscode.l10n.t('Copy message as Base64'),
        streamResend: vscode.l10n.t('Resend on this WebSocket connection'),
        streamResent: vscode.l10n.t('Message resent'),
        streamClosed: vscode.l10n.t('WebSocket connection is closed'),
        streamReceiveOnly: vscode.l10n.t('Only outgoing messages can be resent'),
        streamTruncatedResend: vscode.l10n.t('Truncated messages cannot be resent'),
        streamTruncated: vscode.l10n.t('Payload truncated'),
        streamFramesTruncated: vscode.l10n.t(
            'Only the most recent 500 WebSocket messages are retained.'
        ),
        streamWaiting: vscode.l10n.t('Waiting for messages…'),
        streamEmpty: vscode.l10n.t('No messages were captured.'),
        streamSendTimeout: vscode.l10n.t('No resend confirmation received; delivery is unknown.'),
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
        'col.responseBytes': vscode.l10n.t('Size'),
        image: vscode.l10n.t('Image'),
        find: vscode.l10n.t('Find in body'),
        findPlaceholder: vscode.l10n.t('Find…'),
        previous: vscode.l10n.t('Previous match'),
        next: vscode.l10n.t('Next match'),
        close: vscode.l10n.t('Close'),
        jwtExpires: vscode.l10n.t('Expires'),
        jwtExpired: vscode.l10n.t('Expired'),
        sentTo: vscode.l10n.t('Sent to'),
        rulesApplied: vscode.l10n.t('Rules'),
        localResponse: vscode.l10n.t('answered by Tapline'),
        editResend: vscode.l10n.t('Edit & Resend'),
        pausedRequest: vscode.l10n.t('Request paused at a breakpoint — edit it, then continue'),
        pausedResponse: vscode.l10n.t('Response paused at a breakpoint — edit it, then continue'),
        continue: vscode.l10n.t('Continue'),
        abort: vscode.l10n.t('Abort'),
        binaryNotEditable: vscode.l10n.t('binary body is forwarded unchanged'),
        composer: vscode.l10n.t('Compose Request'),
        composeClear: vscode.l10n.t('Clear'),
        composeInvalidUrl: vscode.l10n.t('Enter an http:// or https:// URL'),
        send: vscode.l10n.t('Send'),
        sendHint: vscode.l10n.t(
            'Cmd/Ctrl+Enter sends through the proxy; the reply appears in the table'
        ),
        stats: vscode.l10n.t('Statistics'),
        statsScope: vscode.l10n.t('{0} requests shown (filters apply)'),
        byHost: vscode.l10n.t('By host'),
        slowest: vscode.l10n.t('Slowest responses'),
        largest: vscode.l10n.t('Largest responses'),
        rules: vscode.l10n.t('Rules'),
        rulesHint: vscode.l10n.t('applied in order · saved to tapline.rules'),
        addRule: vscode.l10n.t('Add rule'),
        noRules: vscode.l10n.t(
            'No rules yet. Rules pause, rewrite, mock, redirect, block or slow down matching requests.'
        ),
        ruleName: vscode.l10n.t('Name (optional)'),
        enabled: vscode.l10n.t('Enabled'),
        moveUp: vscode.l10n.t('Move up'),
        moveDown: vscode.l10n.t('Move down'),
        urlPattern: vscode.l10n.t('URL pattern'),
        urlPatternHint: vscode.l10n.t(
            '* matches anything; without * the pattern is a prefix; empty matches every URL'
        ),
        methods: vscode.l10n.t('Methods'),
        methodsHint: vscode.l10n.t('comma-separated; empty matches all'),
        breakRequest: vscode.l10n.t('Pause requests'),
        breakResponse: vscode.l10n.t('Pause responses'),
        keepOriginal: vscode.l10n.t('keep original'),
        urlRegex: vscode.l10n.t('URL replace'),
        regexHint: vscode.l10n.t('regular expression → replacement'),
        headerEditHint: vscode.l10n.t('Name: value sets, Name: alone removes'),
        bodyReplace: vscode.l10n.t('replace matches in the body'),
        bodySet: vscode.l10n.t('set the whole body'),
        file: vscode.l10n.t('File'),
        fileHint: vscode.l10n.t(
            'relative to the workspace or absolute; leave empty to use the inline body'
        ),
        browse: vscode.l10n.t('Browse…'),
        inlineBody: vscode.l10n.t('Inline body'),
        contentTypeHint: vscode.l10n.t('guessed from the file or body when empty'),
        mapTo: vscode.l10n.t('Send to'),
        mapToHint: vscode.l10n.t(
            'origin, optionally with a path prefix; the request path and query are kept'
        ),
        latency: vscode.l10n.t('Latency (ms)'),
        bandwidth: vscode.l10n.t('Bandwidth (kbps)'),
        'kind.breakpoint': vscode.l10n.t('Breakpoint'),
        'kind.rewrite': vscode.l10n.t('Rewrite'),
        'kind.mapLocal': vscode.l10n.t('Map Local'),
        'kind.mapRemote': vscode.l10n.t('Map Remote'),
        'kind.block': vscode.l10n.t('Block'),
        'kind.throttle': vscode.l10n.t('Throttle'),
        'kindHelp.breakpoint': vscode.l10n.t(
            'Pause matching requests or responses so you can edit them before they continue.'
        ),
        'kindHelp.rewrite': vscode.l10n.t(
            'Change the method, URL, status, headers or body on the way through.'
        ),
        'kindHelp.mapLocal': vscode.l10n.t(
            'Answer with a file from disk or an inline body; the server is never contacted.'
        ),
        'kindHelp.mapRemote': vscode.l10n.t(
            'Send the request to another origin, e.g. a local server instead of production.'
        ),
        'kindHelp.block': vscode.l10n.t('Refuse the request with an error status.'),
        'kindHelp.throttle': vscode.l10n.t(
            'Add latency and cap bandwidth to simulate slow networks.'
        ),
        filterHelp: vscode.l10n.t('Filter syntax'),
        filterHelpText: vscode.l10n.t(
            'Words match the URL, method or status. Use key:value terms to narrow down; prefix - to negate. body:, header:, req: and res: search headers and bodies.'
        ),
        selectedCount: vscode.l10n.t('{0} selected'),
        clearSelection: vscode.l10n.t('Clear selection'),
        exportHar: vscode.l10n.t('Export HAR'),
        pausedCount: vscode.l10n.t('{0} paused'),
        showPaused: vscode.l10n.t('Show paused requests')
    }
}
