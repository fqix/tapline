import * as vscode from 'vscode'
import type { AgentClient } from '../client'

/**
 * Hands the agent's MCP endpoint to AI clients: a one-click install for Cursor, a
 * snippet for mcp.json files and a `claude mcp add` command.
 */
export async function configureMcp(client: AgentClient) {
    if (!client.connected) await client.connect()
    const url = client.mcpUrl
    if (!url) {
        const choice = await vscode.window.showWarningMessage(
            vscode.l10n.t(
                'The Tapline MCP endpoint is disabled or its port is unavailable. Check MCP enabled and MCP port.'
            ),
            vscode.l10n.t('Open Settings'),
            vscode.l10n.t('Show Logs')
        )
        if (choice === vscode.l10n.t('Open Settings'))
            await vscode.commands.executeCommand('tapline.settings')
        else if (choice === vscode.l10n.t('Show Logs')) client.output.show()
        return
    }
    const definition = { url }
    const json = JSON.stringify({ mcpServers: { tapline: definition } }, null, 2)
    const claude = `claude mcp add --transport http tapline ${url}`
    const cursor = /cursor/i.test(vscode.env.appName)
    const picks: (vscode.QuickPickItem & { run: () => Thenable<unknown> })[] = [
        ...(cursor
            ? [
                  {
                      label: `$(cloud-download) ${vscode.l10n.t('Install in Cursor')}`,
                      detail: vscode.l10n.t('Opens the Cursor MCP install dialog'),
                      run: () =>
                          vscode.env.openExternal(
                              vscode.Uri.parse(
                                  `cursor://anysphere.cursor-deeplink/mcp/install?name=tapline&config=${Buffer.from(JSON.stringify(definition)).toString('base64')}`
                              )
                          )
                  }
              ]
            : []),
        {
            label: `$(link) ${vscode.l10n.t('Copy URL')}`,
            detail: url,
            run: () => vscode.env.clipboard.writeText(url)
        },
        {
            label: `$(json) ${vscode.l10n.t('Copy JSON configuration')}`,
            detail: vscode.l10n.t(
                'For mcp.json files (VS Code, Cursor, Claude Desktop, Windsurf, …)'
            ),
            run: () => vscode.env.clipboard.writeText(json)
        },
        {
            label: `$(terminal) ${vscode.l10n.t('Copy Claude Code command')}`,
            detail: claude,
            run: () => vscode.env.clipboard.writeText(claude)
        }
    ]
    const pick = await vscode.window.showQuickPick(picks, {
        title: vscode.l10n.t('Tapline MCP server'),
        placeHolder: url
    })
    if (!pick) return
    await pick.run()
    if (!pick.label.includes('Install'))
        void vscode.window.setStatusBarMessage(vscode.l10n.t('Copied'), 1500)
}
