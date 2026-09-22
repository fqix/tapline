import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import type { Transaction } from '../../shared/model'
import { renderComparison } from '../../utils/compare'

/** Immutable snapshots survive capture updates and deletion until their editors close. */
export class ComparisonDocuments implements vscode.TextDocumentContentProvider, vscode.Disposable {
    private readonly snapshots = new Map<string, string>()
    private readonly disposables = [
        vscode.workspace.registerTextDocumentContentProvider('tapline-diff', this),
        vscode.workspace.onDidCloseTextDocument((document) => {
            this.snapshots.delete(document.uri.toString())
        })
    ]

    provideTextDocumentContent(uri: vscode.Uri): string {
        return (
            this.snapshots.get(uri.toString()) ?? vscode.l10n.t('(comparison no longer available)')
        )
    }

    async compare(left: Transaction, right: Transaction): Promise<void> {
        const key = randomUUID()
        const snapshot = (t: Transaction, side: string) => {
            const uri = vscode.Uri.from({
                scheme: 'tapline-diff',
                path: `/${key}/${side}/request-${t.sequence}.taplinehttp`
            })
            this.snapshots.set(uri.toString(), renderComparison(t))
            return uri
        }
        const original = snapshot(left, 'left')
        const modified = snapshot(right, 'right')
        try {
            await vscode.commands.executeCommand(
                'vscode.diff',
                original,
                modified,
                vscode.l10n.t('Tapline: #{0} ↔ #{1}', left.sequence, right.sequence),
                { preview: false, viewColumn: vscode.ViewColumn.Active }
            )
        } catch (error) {
            this.snapshots.delete(original.toString())
            this.snapshots.delete(modified.toString())
            throw error
        }
    }

    dispose() {
        for (const disposable of this.disposables) disposable.dispose()
        this.snapshots.clear()
    }
}
