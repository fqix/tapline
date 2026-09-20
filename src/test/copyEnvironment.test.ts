import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import type { AgentClient } from '../client/agentClient'
import { CaptureEnvironment } from '../environment/captureEnvironment'

const ui = vi.hoisted(() => ({
    pick: vi.fn(),
    write: vi.fn(),
    info: vi.fn(),
    update: vi.fn(),
    get: vi.fn()
}))
vi.mock('vscode', () => ({
    window: { showQuickPick: ui.pick, showInformationMessage: ui.info, showErrorMessage: vi.fn() },
    env: { clipboard: { writeText: ui.write } },
    workspace: {
        getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
        onDidChangeConfiguration: () => ({ dispose() {} })
    },
    debug: { registerDebugConfigurationProvider: () => ({ dispose() {} }) },
    l10n: { t: (text: string) => text }
}))

function setup() {
    const client = {
        running: true,
        port: 3638,
        certificatePath: '/tmp/test ca.pem',
        onEvent: () => ({ dispose() {} })
    }
    const context = {
        globalState: { get: ui.get, update: ui.update },
        environmentVariableCollection: { clear() {}, replace() {} }
    }
    return {
        client,
        environment: new CaptureEnvironment(
            context as unknown as vscode.ExtensionContext,
            client as unknown as AgentClient
        )
    }
}

beforeEach(() => vi.resetAllMocks())
describe('copy environment command', () => {
    it('offers all shells, uses the current port and remembers the choice', async () => {
        const { client, environment } = setup()
        ui.get.mockReturnValue('Fish')
        ui.pick.mockImplementation(async (items) => {
            expect(items.map((item: { shell: string }) => item.shell)).toEqual([
                'Fish',
                'Bash',
                'Nushell',
                'CMD',
                'PowerShell'
            ])
            client.port = 4000
            return { shell: 'Fish' }
        })
        await environment.copyEnvironment()
        expect(ui.write).toHaveBeenCalledWith(
            expect.stringContaining("set -gx HTTP_PROXY 'http://127.0.0.1:4000'")
        )
        expect(ui.write).toHaveBeenCalledWith(
            expect.stringContaining("set -gx SSL_CERT_FILE '/tmp/test ca.pem'")
        )
        expect(ui.update).toHaveBeenCalledWith('copyEnvironment.shell', 'Fish')
    })
    it('leaves the clipboard untouched when the picker is cancelled', async () => {
        await setup().environment.copyEnvironment()
        expect(ui.write).not.toHaveBeenCalled()
        expect(ui.update).not.toHaveBeenCalled()
    })
    it('does not offer stale settings while capture is stopped', async () => {
        const { client, environment } = setup()
        client.running = false
        await environment.copyEnvironment()
        expect(ui.pick).not.toHaveBeenCalled()
        expect(ui.write).not.toHaveBeenCalled()
    })
    it('rechecks capture after the shell picker closes', async () => {
        const { client, environment } = setup()
        ui.pick.mockImplementation(async () => {
            client.running = false
            return { shell: 'Bash' }
        })
        await environment.copyEnvironment()
        expect(ui.write).not.toHaveBeenCalled()
        expect(ui.info).toHaveBeenCalled()
    })
})
