import * as vscode from 'vscode'
import type { Transaction } from '../shared/model'
import { pretty } from '../shared/model'
import type { AgentClient } from '../client/agentClient'
import { bodyExtension, renderTransaction } from '../utils/format'

export const SCHEME = 'tapline'

/** Read-only virtual documents: `tapline:/<id>/<kind>/<name>.<ext>`. */
export class TransactionDocuments implements vscode.TextDocumentContentProvider, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<vscode.Uri>()
    readonly onDidChange = this.changed.event
    private disposables: vscode.Disposable[]

    constructor(private client: AgentClient) {
        this.disposables = [
            vscode.workspace.registerTextDocumentContentProvider(SCHEME, this),
            client.onEvent((event) => {
                if (event.type !== 'transaction') return
                // Refresh any open document for the updated transaction.
                for (const document of vscode.workspace.textDocuments)
                    if (
                        document.uri.scheme === SCHEME &&
                        document.uri.path.split('/')[1] === event.transaction.id
                    )
                        this.changed.fire(document.uri)
            })
        ]
    }

    static uri(t: Transaction, kind: 'detail' | 'request-body' | 'response-body') {
        const safe =
            (t.path || '/')
                .replace(/[^\w.-]+/g, '_')
                .replace(/^_+|_+$/g, '')
                .slice(0, 60) || 'root'
        const name = `${t.method}_${safe}`
        const ext =
            kind === 'detail'
                ? 'taplinehttp'
                : kind === 'request-body'
                  ? bodyExtension(t.requestHeaders, t.requestBody, t.requestBinary)
                  : bodyExtension(t.responseHeaders, t.responseBody, t.responseBinary)
        return vscode.Uri.from({ scheme: SCHEME, path: `/${t.id}/${kind}/${name}.${ext}` })
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        const [, id, kind] = uri.path.split('/')
        const t = this.client.transactions.get(id)
        if (!t) return vscode.l10n.t('(transaction no longer available)')
        if (kind === 'detail') return renderTransaction(t)
        const [body, binary, size] =
            kind === 'request-body'
                ? [t.requestBody, t.requestBinary, t.requestBytes]
                : [t.responseBody, t.responseBinary, t.responseBytes]
        if (binary)
            return vscode.l10n.t(
                '(binary body, {0} bytes; export as HAR to save it base64-encoded)',
                size
            )
        return uri.path.endsWith('.json') ? pretty(body) : body
    }

    dispose() {
        for (const d of this.disposables) d.dispose()
        this.changed.dispose()
    }
}
