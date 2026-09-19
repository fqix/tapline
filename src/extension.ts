import * as vscode from 'vscode'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { toCurl, toHAR, type ComposeRequest, type Transaction } from './shared/model'
import { AgentClient } from './client/agentClient'
import { ComparisonDocuments } from './providers/comparisonDocuments'
import { TransactionDocuments } from './providers/transactionDocuments'
import { CaptureEnvironment } from './environment/captureEnvironment'
import { CertificateTrust } from './environment/certificateTrust'
import { ProtoIndex } from './environment/protoIndex'
import { TrafficView, type TrafficNode } from './views/trafficView'
import { TrafficPanel, type PanelActions } from './panels/trafficPanel'
import { configureMcp } from './mcp/integration'

let client: AgentClient | undefined

/** What `activate` returns; the end-to-end tests drive the extension through it. */
export interface TaplineApi {
    client: AgentClient
}

export async function activate(context: vscode.ExtensionContext): Promise<TaplineApi> {
    client = new AgentClient(context)
    const view = new TrafficView(client)
    const documents = new TransactionDocuments(client)
    const comparisons = new ComparisonDocuments()
    const environment = new CaptureEnvironment(context, client)
    const certificate = new CertificateTrust(client)
    const protos = new ProtoIndex(client)
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
        return vscode.window.withProgress(
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
    }
    const compose = async (request: ComposeRequest) =>
        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: vscode.l10n.t('Sending {0} {1}', request.method, request.url)
            },
            () => client!.compose(request)
        )
    /** Write the given transactions (or all) to a HAR file chosen by the user. */
    const exportHar = async (selected: Transaction[]) => {
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
    }
    const compare = async (ids: string[]) => {
        if (ids.length !== 2 || ids[0] === ids[1])
            throw new Error(vscode.l10n.t('Select exactly two requests to compare.'))
        const [left, right] = ids.map(byId).sort((a, b) => a.sequence - b.sequence)
        await comparisons.compare(left, right)
    }
    const compareOriginal = async (id: string) => {
        const t = byId(id)
        if (!t.replayOf || !client!.transactions.has(t.replayOf))
            throw new Error(vscode.l10n.t('The original request is no longer available.'))
        await comparisons.compare(byId(t.replayOf), t)
    }
    const editNote = async (id: string) => {
        const t = byId(id)
        const note = await vscode.window.showInputBox({
            title: vscode.l10n.t('Request Note'),
            prompt: vscode.l10n.t('Add a note for this session. Leave empty to remove it.'),
            value: t.note ?? '',
            validateInput: (value) =>
                value.length > 2000
                    ? vscode.l10n.t('Notes must be at most 2000 characters.')
                    : undefined
        })
        if (note !== undefined) await client!.call('annotate', { transaction: id, note })
    }
    const toggleMark = async (id: string) => {
        await client!.call('annotate', { transaction: id, marked: !byId(id).marked })
    }
    const copyResponse = async (id: string) => {
        const t = byId(id)
        await vscode.env.clipboard.writeText(t.responseBody)
        const copied = t.responseBinary
            ? vscode.l10n.t('Response body copied as Base64')
            : vscode.l10n.t('Response body copied')
        void vscode.window.setStatusBarMessage(
            copied +
                (t.truncated || t.state === 'pending'
                    ? ' · ' + vscode.l10n.t('Capture may be incomplete')
                    : ''),
            3000
        )
    }
    const actions: PanelActions = {
        compareOriginal,
        editNote,
        toggleMark,
        copyResponse,
        compare,
        copyCurl: async (ids) => {
            await vscode.env.clipboard.writeText(ids.map((id) => toCurl(byId(id))).join('\n\n'))
            void vscode.window.setStatusBarMessage(vscode.l10n.t('cURL command copied'), 2000)
        },
        replay: (id) => replay(byId(id)),
        compose,
        openText: async (id) => void (await openText(byId(id))),
        openBody: async (id, side) =>
            void (await vscode.window.showTextDocument(
                TransactionDocuments.uri(byId(id), `${side}-body`),
                { preview: true, viewColumn: vscode.ViewColumn.Beside }
            )),
        delete: (ids) => client!.delete(ids),
        exportHar: (ids) => exportHar(ids.map(byId)),
        saveRules: (rules) => client!.saveRules(rules),
        resume: (id, edit) => client!.resume(id, edit),
        abort: (id) => client!.abort(id)
    }
    const panel = new TrafficPanel(context, client, actions)
    const status = vscode.window.createStatusBarItem(
        'tapline.status',
        vscode.StatusBarAlignment.Left,
        50
    )
    status.name = 'Tapline'
    status.command = 'tapline.status'
    context.subscriptions.push(
        client,
        view,
        documents,
        comparisons,
        environment,
        certificate,
        protos,
        panel,
        status
    )

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

    const started = async () => {
        const choice = await vscode.window.showInformationMessage(
            vscode.l10n.t(
                'Tapline is capturing on 127.0.0.1:{0}. New terminals and debug sessions are routed through it automatically.',
                client!.port
            ),
            vscode.l10n.t('New Captured Terminal'),
            vscode.l10n.t('Show Traffic')
        )
        if (choice === vscode.l10n.t('New Captured Terminal'))
            await vscode.commands.executeCommand('tapline.openTerminal')
        else if (choice === vscode.l10n.t('Show Traffic'))
            await vscode.commands.executeCommand('tapline.traffic.focus')
    }
    /** Start capture once the OS trusts the root CA; resolves `false` when it did not start. */
    const startCapture = async (modal = true) => {
        if (!(await certificate.ensureTrusted(modal))) return false
        try {
            await client!.start()
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const choice = await vscode.window.showErrorMessage(
                vscode.l10n.t('Tapline could not start capture: {0}', message),
                vscode.l10n.t('Show Logs'),
                ...(/port/i.test(message) ? [vscode.l10n.t('Change Port')] : [])
            )
            if (choice === vscode.l10n.t('Show Logs')) client!.output.show()
            else if (choice === vscode.l10n.t('Change Port'))
                await vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'tapline.port'
                )
            return false
        }
        return true
    }
    command('tapline.start', async () => {
        if (await startCapture()) void started()
    })
    command('tapline.stop', async () => {
        await client!.stop()
        void vscode.window.showInformationMessage(
            vscode.l10n.t(
                'Tapline capture stopped. Terminals opened from now on use the normal network.'
            )
        )
    })
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
                      run: () => startCapture()
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
            certificate.status === 'trusted'
                ? {
                      label: `$(shield) ${vscode.l10n.t('Uninstall Root Certificate')}`,
                      description: certificate.describe(),
                      run: () => certificate.uninstall()
                  }
                : {
                      label: `$(shield) ${vscode.l10n.t('Install Root Certificate')}`,
                      description: certificate.describe(),
                      run: () => certificate.trust()
                  },
            { label: `$(output) ${vscode.l10n.t('Show Logs')}`, run: () => client!.output.show() }
        ]
        const pick = await vscode.window.showQuickPick(picks, { title: 'Tapline' })
        await pick?.run()
    })
    command('tapline.open', (node?: TrafficNode) => {
        const t = one(node)
        if (t) panel.focus(t.id)
    })
    command('tapline.openHost', (node?: TrafficNode) => {
        if (node?.kind === 'host') panel.showHost(node.host)
    })
    for (const [name, action] of Object.entries({
        compareOriginal,
        editNote,
        toggleMark,
        copyResponse
    }))
        command(`tapline.${name}`, async (context?: { id?: string }) => {
            const id = context?.id ?? one()?.id
            if (id) await action(id)
        })
    command('tapline.compare', async (context?: { ids?: string[] }) => {
        if (Array.isArray(context?.ids)) return compare(context.ids)
        const picks = [...client!.transactions.values()]
            .sort((a, b) => b.sequence - a.sequence)
            .map((t) => ({ label: `#${t.sequence} ${t.method} ${t.url}`, id: t.id }))
        const selected = await vscode.window.showQuickPick(picks, {
            canPickMany: true,
            title: vscode.l10n.t('Compare Requests'),
            placeHolder: vscode.l10n.t('Select exactly two requests to compare.')
        })
        if (selected) await compare(selected.map((p) => p.id))
    })
    command('tapline.openText', async (node?: TrafficNode) => {
        const t = one(node)
        if (t) await openText(t)
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
        if (t) panel.focus((await replay(t)).id)
    })
    command('tapline.openSequence', () => panel.show())
    command('tapline.delete', async (node?: TrafficNode) => {
        const ids = view.selected(node).map((t) => t.id)
        if (ids.length) await client!.delete(ids)
    })
    command('tapline.exportHar', (node?: TrafficNode) =>
        exportHar(node ? view.selected(node) : [...client!.transactions.values()])
    )
    command('tapline.compose', (node?: TrafficNode) => {
        const t = one(node)
        panel.showPane(
            'composer',
            t && t.scheme !== 'connect'
                ? {
                      method: t.method,
                      url: t.url,
                      headers: Object.entries(t.requestHeaders)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join('\n'),
                      body: t.requestBinary ? '' : t.requestBody,
                      replayOf: t.id
                  }
                : undefined
        )
    })
    command('tapline.rules', () => panel.showPane('rules'))
    command('tapline.stats', () => panel.showPane('stats'))
    command('tapline.addBreakpoint', async (node?: TrafficNode) => {
        const t = one(node)
        const url = t ? new URL(t.url) : undefined
        const pattern = url ? `${url.origin}${url.pathname}` : ''
        const rules = client!.rules()
        await client!.saveRules([
            ...rules,
            {
                id: `bp${Date.now().toString(36)}`,
                enabled: true,
                kind: 'breakpoint',
                url: pattern,
                request: true,
                response: true
            }
        ])
        panel.showPane('rules')
    })
    command('tapline.openTerminal', async () => {
        if (!client!.running && !(await startCapture())) return
        await environment.openTerminal()
    })
    command('tapline.installCertificate', () => certificate.install())
    command('tapline.trustCertificate', () => certificate.trust())
    command('tapline.uninstallCertificate', () => certificate.uninstall())
    command('tapline.checkCertificate', async () => {
        await certificate.check()
        void vscode.window.showInformationMessage(`Tapline: ${certificate.describe()}`)
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
    command('tapline.configureMcp', () => configureMcp(client!))

    // Connect lazily so a broken core never blocks activation; autoStart opts in.
    void protos
        .refresh()
        .catch((error) => client!.output.warn(String(error)))
        .then(() => client!.connect())
        .then(() => certificate.check().catch((error) => client!.output.warn(String(error))))
        .then(() =>
            vscode.workspace.getConfiguration('tapline').get<boolean>('autoStart', false)
                ? startCapture(false)
                : undefined
        )
        .catch((error) => client!.output.error(String(error)))
    return { client }
}

export function deactivate() {
    // Closing the socket lets the shared agent stop sing-box once no window remains.
    client?.dispose()
    client = undefined
}
