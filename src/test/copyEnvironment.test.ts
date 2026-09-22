import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import type { AgentClient } from '../client/agentClient'
import { CaptureEnvironment } from '../environment/captureEnvironment'

const ui = vi.hoisted(() => ({
    pick: vi.fn(),
    write: vi.fn(),
    info: vi.fn(),
    update: vi.fn(),
    get: vi.fn(),
    registerDebug: vi.fn(() => ({ dispose() {} })),
    onStart: vi.fn(() => ({ dispose() {} })),
    console: [] as string[]
}))
vi.mock('vscode', () => ({
    window: { showQuickPick: ui.pick, showInformationMessage: ui.info, showErrorMessage: vi.fn() },
    env: { clipboard: { writeText: ui.write } },
    workspace: {
        getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
        onDidChangeConfiguration: () => ({ dispose() {} })
    },
    debug: {
        registerDebugConfigurationProvider: ui.registerDebug,
        onDidStartDebugSession: ui.onStart,
        activeDebugConsole: { appendLine: (line: string) => ui.console.push(line) }
    },
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

describe('debug environment injection', () => {
    function resolve(config: vscode.DebugConfiguration) {
        setup()
        const provider = ui.registerDebug.mock.calls[0] as unknown as [
            string,
            vscode.DebugConfigurationProvider
        ]
        return provider[1].resolveDebugConfigurationWithSubstitutedVariables!(
            undefined,
            config,
            {} as vscode.CancellationToken
        ) as vscode.DebugConfiguration
    }

    it.each(['extensionHost', 'pwa-extensionHost'])(
        'avoids the Electron CA startup crash for %s while keeping proxy routing',
        (type) => {
            const config = resolve({ type, name: 'Extension', request: 'launch' })
            expect(config.env.NODE_EXTRA_CA_CERTS).toBeUndefined()
            expect(config.env.HTTPS_PROXY).toBe('http://127.0.0.1:3638')
            expect(config.env.NODE_USE_ENV_PROXY).toBe('1')
        }
    )

    it('keeps extra CA trust for normal Node debugging', () => {
        const config = resolve({ type: 'node', name: 'Node', request: 'launch' })
        expect(config.env.NODE_EXTRA_CA_CERTS).toBe('/tmp/test ca.pem')
    })

    it('lists the injected variables in the debug console when a session starts', () => {
        const config = resolve({ type: 'node', name: 'Node', request: 'launch' })
        const started = ui.onStart.mock.calls.at(-1)![0] as unknown as (
            session: vscode.DebugSession
        ) => void
        ui.console.length = 0
        started({ configuration: config } as vscode.DebugSession)
        expect(ui.console[0]).toContain('Tapline: capturing through')
        expect(ui.console).toContain('  NODE_EXTRA_CA_CERTS=/tmp/test ca.pem')
        expect(ui.console).toContain('  HTTPS_PROXY=http://127.0.0.1:3638')
        // A session Tapline did not touch stays quiet.
        ui.console.length = 0
        started({
            configuration: { type: 'node', name: 'x', request: 'launch' }
        } as vscode.DebugSession)
        expect(ui.console).toEqual([])
    })

    it('preserves explicit debug environment overrides', () => {
        const config = resolve({
            type: 'extensionHost',
            name: 'Extension',
            request: 'launch',
            env: { NODE_EXTRA_CA_CERTS: '/custom/ca.pem', HTTPS_PROXY: 'http://localhost:9999' }
        })
        expect(config.env.NODE_EXTRA_CA_CERTS).toBe('/custom/ca.pem')
        expect(config.env.HTTPS_PROXY).toBe('http://localhost:9999')
    })
})
