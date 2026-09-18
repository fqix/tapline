import * as vscode from 'vscode'
import type { Transaction } from '../shared/model'
import type { AgentClient } from './client'
import { bytes, duration, shortPath, statusLabel } from './format'

export type TrafficNode = { kind: 'host'; host: string } | { kind: 'transaction'; id: string }

export class TrafficView implements vscode.TreeDataProvider<TrafficNode>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<TrafficNode | undefined>()
    readonly onDidChangeTreeData = this.changed.event
    readonly view: vscode.TreeView<TrafficNode>
    private timer?: NodeJS.Timeout
    private disposables: vscode.Disposable[] = []

    constructor(private client: AgentClient) {
        this.view = vscode.window.createTreeView('tapline.traffic', {
            treeDataProvider: this,
            showCollapseAll: true,
            canSelectMany: true
        })
        this.disposables.push(
            this.view,
            client.onEvent(() => this.refresh()),
            vscode.workspace.onDidChangeConfiguration((change) => {
                if (change.affectsConfiguration('tapline.groupByHost')) this.refresh()
            })
        )
        this.refresh()
    }

    private get groupByHost() {
        return vscode.workspace.getConfiguration('tapline').get<boolean>('groupByHost', false)
    }

    /** Coalesce bursts of transaction events into one repaint. */
    refresh() {
        if (this.timer) return
        this.timer = setTimeout(() => {
            this.timer = undefined
            this.changed.fire(undefined)
            const count = this.client.transactions.size
            this.view.description = this.client.running
                ? vscode.l10n.t('{0} requests · port {1}', count, this.client.port)
                : count
                  ? vscode.l10n.t('{0} requests', count)
                  : ''
        }, 120)
    }

    private ordered(): Transaction[] {
        return [...this.client.transactions.values()].sort((a, b) => b.sequence - a.sequence)
    }

    getChildren(node?: TrafficNode): TrafficNode[] {
        if (!node) {
            if (!this.groupByHost)
                return this.ordered().map((t) => ({ kind: 'transaction', id: t.id }))
            const hosts = new Map<string, number>()
            for (const t of this.ordered()) hosts.set(t.host, (hosts.get(t.host) ?? 0) + 1)
            return [...hosts.keys()].sort().map((host) => ({ kind: 'host', host }))
        }
        if (node.kind === 'host')
            return this.ordered()
                .filter((t) => t.host === node.host)
                .map((t) => ({ kind: 'transaction', id: t.id }))
        return []
    }

    getTreeItem(node: TrafficNode): vscode.TreeItem {
        if (node.kind === 'host') {
            const count = this.ordered().filter((t) => t.host === node.host).length
            const item = new vscode.TreeItem(node.host, vscode.TreeItemCollapsibleState.Expanded)
            item.description = String(count)
            item.iconPath = new vscode.ThemeIcon('globe')
            item.contextValue = 'host'
            item.id = `host:${node.host}`
            return item
        }
        const t = this.client.transactions.get(node.id)
        if (!t) return new vscode.TreeItem('…')
        const item = new vscode.TreeItem(
            `${statusLabel(t)}  ${t.method}  ${this.groupByHost ? shortPath(t) : t.host + shortPath(t, 60)}`
        )
        item.id = t.id
        item.description =
            t.state === 'pending' ? '' : `${duration(t.duration)} · ${bytes(t.responseBytes)}`
        item.tooltip = new vscode.MarkdownString(
            `**${t.method}** ${t.url}\n\n` +
                `${t.status ?? ''} ${t.statusMessage ?? ''} · ${t.scheme}${t.httpVersion ? ' HTTP/' + t.httpVersion : ''}\n\n` +
                `${t.client} · ${new Date(t.timestamp).toLocaleTimeString()}` +
                (t.error ? `\n\n$(error) ${t.error}` : ''),
            true
        )
        item.iconPath = icon(t)
        item.contextValue = 'transaction'
        item.command = { command: 'tapline.open', title: 'Open', arguments: [node] }
        return item
    }

    getParent(node: TrafficNode): TrafficNode | undefined {
        if (node.kind === 'transaction' && this.groupByHost) {
            const t = this.client.transactions.get(node.id)
            return t ? { kind: 'host', host: t.host } : undefined
        }
        return undefined
    }

    /** Transactions covered by a context-menu invocation: the clicked node plus the selection. */
    selected(node?: TrafficNode): Transaction[] {
        const nodes = new Map<string, TrafficNode>()
        for (const n of [...(node ? [node] : []), ...this.view.selection])
            nodes.set(JSON.stringify(n), n)
        const ids = new Set<string>()
        for (const n of nodes.values()) {
            if (n.kind === 'transaction') ids.add(n.id)
            else
                for (const t of this.client.transactions.values())
                    if (t.host === n.host) ids.add(t.id)
        }
        return [...ids].map((id) => this.client.transactions.get(id)!).filter(Boolean)
    }

    dispose() {
        clearTimeout(this.timer)
        for (const d of this.disposables) d.dispose()
        this.changed.dispose()
    }
}

function icon(t: Transaction): vscode.ThemeIcon {
    if (t.state === 'pending') return new vscode.ThemeIcon('sync~spin')
    if (t.state === 'error')
        return new vscode.ThemeIcon('error', new vscode.ThemeColor('list.errorForeground'))
    if (t.frames.length || t.scheme.startsWith('ws')) return new vscode.ThemeIcon('plug')
    if (t.scheme === 'connect') return new vscode.ThemeIcon('lock')
    const status = t.status ?? 0
    if (status >= 500)
        return new vscode.ThemeIcon('flame', new vscode.ThemeColor('list.errorForeground'))
    if (status >= 400)
        return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'))
    if (status >= 300) return new vscode.ThemeIcon('arrow-right')
    return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'))
}
