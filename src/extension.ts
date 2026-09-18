import * as vscode from 'vscode'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { toCurl, toHAR, type Transaction } from './shared/model'
import { AgentClient } from './client/agentClient'
import { TransactionDocuments } from './providers/transactionDocuments'
import { CaptureEnvironment } from './environment/captureEnvironment'
import { TrafficView, type TrafficNode } from './views/trafficView'
import { DetailPanel } from './panels/detailPanel'

let client: AgentClient | undefined

export async function activate(context: vscode.ExtensionContext) {
    client = new AgentClient(context)
    const view = new TrafficView(client)
    const documents = new TransactionDocuments(client)
    const environment = new CaptureEnvironment(context, client)
    const byId = (id: string) => {
        const t = client!.transactions.get(id)
        if (!t) throw new Error(vscode.l10n.t('This request is no longer available.'))
        return t
    }
    const openText = (t: Transaction) =>
        vscode.window.showTextDocument(TransactionDocuments.uri(t, 'detail'), {
            preview: true,
            viewColumn: vscode.ViewColumn.Beside
        })
    const replay = async (t: Transaction) => {
        if (t.scheme === 'connect' || t.frames.length || t.status === 101 || t.requestBinary)
            throw new Error(vscode.l10n.t('Only HTTP requests with text bodies can be replayed'))
        const replayed = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: vscode.l10n.t('Replaying {0} {1}', t.method, t.path)
            },
            () =>
                client!.compose({
                    url: t.url,
                    method: t.method,
                    headers: t.requestHeaders,
                    body: t.requestBody,
                    replayOf: t.id
                })
        )
        panel.showTransaction(replayed.id)
    }
    const panel = new DetailPanel(context, client, {
        copyCurl: async (id) => {
            await vscode.env.clipboard.writeText(toCurl(byId(id)))
            void vscode.window.setStatusBarMessage(vscode.l10n.t('cURL command copied'), 2000)
        },
        replay: (id) => replay(byId(id)),
        openText: async (id) => void (await openText(byId(id))),
        openBody: async (id, side) =>
            void (await vscode.window.showTextDocument(
                TransactionDocuments.uri(byId(id), `${side}-body`),
                { preview: true, viewColumn: vscode.ViewColumn.Beside }
            ))
    })
    const status = vscode.window.createStatusBarItem(
        'tapline.status',
        vscode.StatusBarAlignment.Left,
        50
    )
    status.name = 'Tapline'
    status.command = 'tapline.status'
    context.subscriptions.push(client, view, documents, environment, panel, status)

    const sync = () => {
        void vscode.commands.executeCommand('setContext', 'tapline.running', client!.running)
        if (!client!.connected) {
            status.text = '$(circle-slash) Tapline'
            status.tooltip = vscode.l10n.t('Tapline capture agent is not connected')
        } else if (!client!.running) {
            status.text = '$(circle-outline) Tapline'
            status.tooltip = vscode.l10n.t('Capture stopped · click to start')
        } else if (!client!.recording) {
            status.text = `$(debug-pause) Tapline ${client!.port}`
            status.tooltip = vscode.l10n.t('Capturing on port {0}, recording paused', client!.port)
        } else {
            status.text = `$(broadcast) Tapline ${client!.port}`
            status.tooltip = vscode.l10n.t(
                'Capturing on port {0} · {1} requests',
                client!.port,
                client!.transactions.size
            )
        }
        status.show()
    }
    context.subscriptions.push(client.onEvent(sync))
    sync()

    const failure = (error: unknown) =>
        vscode.window.showErrorMessage(
            vscode.l10n.t('Tapline: {0}', error instanceof Error ? error.message : String(error))
        )
    const guarded =
        (fn: (...args: any[]) => unknown | Promise<unknown>) =>
        async (...args: any[]) => {
            try {
                await fn(...args)
            } catch (error) {
                void failure(error)
            }
        }
    const one = (node?: TrafficNode): Transaction | undefined => {
        const selected = view.selected(node)
        return selected.length === 1
            ? selected[0]
            : node?.kind === 'transaction'
              ? client!.transactions.get(node.id)
              : selected[0]
    }
    const command = (name: string, fn: (...args: any[]) => unknown) =>
        context.subscriptions.push(vscode.commands.registerCommand(name, guarded(fn)))

    command('tapline.start', async () => {
        await client!.start()
        void vscode.window.setStatusBarMessage(
            vscode.l10n.t('Tapline capturing on 127.0.0.1:{0}', client!.port),
            4000
        )
    })
    command('tapline.stop', () => client!.stop())
    command('tapline.toggleRecording', () => client!.setRecording(!client!.recording))
    command('tapline.clear', () => client!.clear())
    command('tapline.status', async () => {
        const running = client!.running
        const picks: (vscode.QuickPickItem & { run: () => unknown })[] = [
            running
                ? {
                      label: `$(debug-stop) ${vscode.l10n.t('Stop Capture')}`,
                      run: () => client!.stop()
                  }
                : {
                      label: `$(play) ${vscode.l10n.t('Start Capture')}`,
                      run: () => client!.start()
                  },
            ...(running
                ? [
                      {
                          label: client!.recording
                              ? `$(debug-pause) ${vscode.l10n.t('Pause Recording')}`
                              : `$(record) ${vscode.l10n.t('Resume Recording')}`,
                          run: () => client!.setRecording(!client!.recording)
                      },
                      {
                          label: `$(terminal) ${vscode.l10n.t('New Captured Terminal')}`,
                          run: () => vscode.commands.executeCommand('tapline.openTerminal')
                      }
                  ]
                : []),
            {
                label: `$(list-flat) ${vscode.l10n.t('Show Traffic')}`,
                run: () => vscode.commands.executeCommand('tapline.traffic.focus')
            },
            { label: `$(output) ${vscode.l10n.t('Show Logs')}`, run: () => client!.output.show() }
        ]
        const pick = await vscode.window.showQuickPick(picks, { title: 'Tapline' })
        await pick?.run()
    })
    command('tapline.open', async (node?: TrafficNode) => {
        const t = one(node)
        if (!t) return
        await vscode.window.showTextDocument(TransactionDocuments.uri(t, 'detail'), {
            preview: true,
            preserveFocus: false
        })
    })
    command('tapline.openRequestBody', async (node?: TrafficNode) => {
        const t = one(node)
        if (t)
            await vscode.window.showTextDocument(TransactionDocuments.uri(t, 'request-body'), {
                preview: true
            })
    })
    command('tapline.openResponseBody', async (node?: TrafficNode) => {
        const t = one(node)
        if (t)
            await vscode.window.showTextDocument(TransactionDocuments.uri(t, 'response-body'), {
                preview: true
            })
    })
    command('tapline.copyCurl', async (node?: TrafficNode) => {
        const t = one(node)
        if (!t) return
        await vscode.env.clipboard.writeText(toCurl(t))
        void vscode.window.setStatusBarMessage(vscode.l10n.t('cURL command copied'), 2000)
    })
    command('tapline.copyUrl', async (node?: TrafficNode) => {
        const t = one(node)
        if (t) await vscode.env.clipboard.writeText(t.url)
    })
    command('tapline.replay', async (node?: TrafficNode) => {
        const t = one(node)
        if (t) await replay(t)
    })
    command('tapline.delete', async (node?: TrafficNode) => {
        const ids = view.selected(node).map((t) => t.id)
        if (ids.length) await client!.delete(ids)
    })
    command('tapline.exportHar', async (node?: TrafficNode) => {
        const selected = node ? view.selected(node) : [...client!.transactions.values()]
        const items = selected.filter(
            (t) => t.state !== 'pending' && t.scheme !== 'connect' && t.status !== 101
        )
        if (!items.length) throw new Error(vscode.l10n.t('Nothing to export'))
        const target = await vscode.window.showSaveDialog({
            title: vscode.l10n.t('Export HAR'),
            defaultUri: vscode.Uri.joinPath(
                vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(homedir()),
                'tapline-session.har'
            ),
            filters: { 'HTTP Archive': ['har'] }
        })
        if (!target) return
        await writeFile(
            target.fsPath,
            JSON.stringify(toHAR(items.sort((a, b) => a.sequence - b.sequence)), null, 2)
        )
        void vscode.window.setStatusBarMessage(
            vscode.l10n.t('Exported {0} requests', items.length),
            3000
        )
    })
    command('tapline.openTerminal', async () => {
        if (!client!.running) await client!.start()
        const terminal = vscode.window.createTerminal({
            name: 'Tapline',
            iconPath: new vscode.ThemeIcon('broadcast')
        })
        terminal.show()
    })
    command('tapline.copyCertificatePath', async () => {
        if (!client!.connected) await client!.connect()
        await vscode.env.clipboard.writeText(client!.certificatePath)
        void vscode.window.setStatusBarMessage(vscode.l10n.t('Root certificate path copied'), 2000)
    })
    command('tapline.revealCertificate', async () => {
        if (!client!.connected) await client!.connect()
        await vscode.commands.executeCommand(
            'revealFileInOS',
            vscode.Uri.file(client!.certificatePath)
        )
    })
    command('tapline.showLogs', () => client!.output.show())
    command('tapline.viewStructure', () =>
        vscode.workspace
            .getConfiguration('tapline')
            .update('viewMode', 'structure', vscode.ConfigurationTarget.Global)
    )
    command('tapline.viewSequence', () =>
        vscode.workspace
            .getConfiguration('tapline')
            .update('viewMode', 'sequence', vscode.ConfigurationTarget.Global)
    )

    // Connect lazily so a broken core never blocks activation; autoStart opts in.
    void client
        .connect()
        .then(() =>
            vscode.workspace.getConfiguration('tapline').get<boolean>('autoStart', false)
                ? client!.start()
                : undefined
        )
        .catch((error) => client!.output.error(String(error)))
}

export function deactivate() {
    // Closing the socket lets the shared agent stop sing-box once no window remains.
    client?.dispose()
    client = undefined
}
