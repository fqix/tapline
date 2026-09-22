import { preferences } from '../preferences'
import * as vscode from 'vscode'
import { isAbsolute } from 'node:path'
import type { AgentClient } from '../client'

/**
 * Keeps the agent's gRPC schema in sync with the workspace: resolves the
 * `tapline.grpc.protoFiles` globs and re-pushes the settings whenever a .proto file
 * appears, changes or disappears.
 */
export class ProtoIndex implements vscode.Disposable {
    private disposables: vscode.Disposable[] = []
    private timer?: NodeJS.Timeout

    constructor(private client: AgentClient) {
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.proto')
        this.disposables.push(
            watcher,
            watcher.onDidCreate(() => this.schedule()),
            watcher.onDidChange(() => this.schedule()),
            watcher.onDidDelete(() => this.schedule()),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.schedule()),
            preferences.onDidChange((change) => {
                if (change.affectsConfiguration('tapline.grpc')) this.schedule()
            })
        )
    }

    /** Resolve the configured patterns to absolute paths and hand them to the client. */
    async refresh(): Promise<string[]> {
        const patterns = preferences.get<string[]>('grpc.protoFiles', ['**/*.proto'])
        const files = new Set<string>()
        for (const pattern of patterns) {
            if (!pattern.trim()) continue
            if (isAbsolute(pattern) && !/[*?{}[\]]/.test(pattern)) {
                files.add(pattern)
                continue
            }
            const found = await vscode.workspace.findFiles(
                pattern,
                '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**}'
            )
            for (const uri of found) if (uri.scheme === 'file') files.add(uri.fsPath)
        }
        const list = [...files].sort()
        const changed = list.join('\n') !== this.client.protoFiles.join('\n')
        this.client.protoFiles = list
        if (changed) this.client.output.info(`gRPC schema: ${list.length} .proto files`)
        return list
    }

    private schedule() {
        clearTimeout(this.timer)
        this.timer = setTimeout(() => {
            void this.refresh().then(() => this.client.pushSettings())
        }, 500)
    }

    dispose() {
        clearTimeout(this.timer)
        for (const d of this.disposables) d.dispose()
    }
}
