import * as vscode from 'vscode'
import type { Transaction } from '../shared/model'
import type { AgentClient } from '../client/agentClient'
import { bytes, duration, statusLabel } from '../utils/format'

/** Charles-style structure view: host → path folders → requests. */
export type TrafficNode =
    | { kind: 'host'; host: string }
    | { kind: 'folder'; host: string; prefix: string }
    | { kind: 'transaction'; id: string }

const segments = (t: Transaction) => {
    const path = t.scheme === 'connect' ? '' : t.path.split('?')[0]
    return path.split('/').filter(Boolean)
}

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
            client.onEvent(() => this.refresh())
        )
        this.refresh()
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

    forHost(host: string): Transaction[] {
        return this.ordered().filter((t) => t.host === host)
    }

    getChildren(node?: TrafficNode): TrafficNode[] {
        if (!node) {
            const hosts = new Set<string>()
            for (const t of this.ordered()) hosts.add(t.host)
            return [...hosts].sort().map((host) => ({ kind: 'host', host }))
        }
        if (node.kind === 'transaction') return []
        const prefix = node.kind === 'host' ? [] : node.prefix.split('/').filter(Boolean)
        const folders = new Set<string>()
        const leaves: TrafficNode[] = []
        for (const t of this.forHost(node.host).sort((a, b) => a.sequence - b.sequence)) {
            const parts = segments(t)
            if (parts.length < prefix.length || prefix.some((p, i) => parts[i] !== p)) continue
            if (parts.length === prefix.length) leaves.push({ kind: 'transaction', id: t.id })
            else folders.add(parts[prefix.length])
        }
        return [
            ...[...folders].sort().map((name) => ({
                kind: 'folder' as const,
                host: node.host,
                prefix: [...prefix, name].join('/')
            })),
            ...leaves
        ]
    }

    getTreeItem(node: TrafficNode): vscode.TreeItem {
        if (node.kind === 'host') {
            const items = this.forHost(node.host)
            const item = new vscode.TreeItem(node.host, vscode.TreeItemCollapsibleState.Collapsed)
            item.id = `host:${node.host}`
            item.description = String(items.length)
            item.iconPath = new vscode.ThemeIcon(
                items.some((t) => t.tls || t.scheme === 'connect') ? 'lock' : 'globe'
            )
            item.contextValue = 'host'
            item.tooltip = vscode.l10n.t(
                '{0} requests · {1} received',
                items.length,
                bytes(items.reduce((n, t) => n + t.responseBytes, 0))
            )
            item.command = { command: 'tapline.openHost', title: 'Open', arguments: [node] }
            return item
        }
        if (node.kind === 'folder') {
            const item = new vscode.TreeItem(
                node.prefix.split('/').pop()!,
                vscode.TreeItemCollapsibleState.Collapsed
            )
            item.id = `folder:${node.host}/${node.prefix}`
            item.iconPath = vscode.ThemeIcon.Folder
            item.contextValue = 'folder'
            return item
        }
        const t = this.client.transactions.get(node.id)
        if (!t) return new vscode.TreeItem('…')
        const query = t.path.includes('?') ? '?' + t.path.split('?')[1] : ''
        const leaf = t.scheme === 'connect' ? t.path : (segments(t).pop() ?? '/')
        const item = new vscode.TreeItem(`${leaf}${query}`)
        item.id = t.id
        item.description = `${t.method} · ${statusLabel(t)}${t.state === 'pending' ? '' : ` · ${duration(t.duration)}`}`
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
        if (node.kind === 'host') return undefined
        if (node.kind === 'folder') {
            const parts = node.prefix.split('/')
            return parts.length > 1
                ? { kind: 'folder', host: node.host, prefix: parts.slice(0, -1).join('/') }
                : { kind: 'host', host: node.host }
        }
        const t = this.client.transactions.get(node.id)
        if (!t) return undefined
        const parts = segments(t)
        return parts.length
            ? { kind: 'folder', host: t.host, prefix: parts.join('/') }
            : { kind: 'host', host: t.host }
    }

    /** Transactions covered by a context-menu invocation: the clicked node plus the selection. */
    selected(node?: TrafficNode): Transaction[] {
        const nodes = new Map<string, TrafficNode>()
        for (const n of [...(node ? [node] : []), ...this.view.selection])
            nodes.set(JSON.stringify(n), n)
        const ids = new Set<string>()
        for (const n of nodes.values()) {
            if (n.kind === 'transaction') ids.add(n.id)
            else if (n.kind === 'host') for (const t of this.forHost(n.host)) ids.add(t.id)
            else {
                const prefix = n.prefix.split('/')
                for (const t of this.forHost(n.host)) {
                    const parts = segments(t)
                    if (parts.length >= prefix.length && prefix.every((p, i) => parts[i] === p))
                        ids.add(t.id)
                }
            }
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
    if (t.frames.length || t.scheme.startsWith('ws') || t.status === 101)
        return new vscode.ThemeIcon('plug')
    if (t.scheme === 'connect') return new vscode.ThemeIcon('lock')
    const status = t.status ?? 0
    if (status >= 500)
        return new vscode.ThemeIcon('flame', new vscode.ThemeColor('list.errorForeground'))
    if (status >= 400)
        return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'))
    if (status >= 300) return new vscode.ThemeIcon('arrow-right')
    return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'))
}
