import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import type { AgentClient } from '../../extension/client'
import { SettingsPanel, synchronizeVSCodeProxy } from '../../extension/panels/settingsPanel'
import type { PanelMessage, HostMessage } from '../../webview/types/messages'

const ui = vi.hoisted(() => ({
    receive: undefined as undefined | ((message: PanelMessage) => void),
    configuration: undefined as
        undefined | ((event: { affectsConfiguration(key: string): boolean }) => void),
    value: undefined as string | undefined,
    workspaceValue: undefined as string | undefined,
    post: vi.fn(),
    update: vi.fn(),
    dispose: vi.fn()
}))
vi.mock('../../extension/preferences', () => ({
    preferences: {
        onDidChange: () => ({ dispose() {} }),
        values: () => ({}),
        get: (key: string) => (key === 'ssl.noHosts' ? ['private.test'] : ['*'])
    }
}))
vi.mock('vscode', () => ({
    ConfigurationTarget: { Global: 1 },
    ViewColumn: { Active: 1 },
    ThemeIcon: class {},
    Uri: { joinPath: () => 'asset' },
    env: { language: 'en' },
    l10n: { t: (text: string) => text },
    workspace: {
        getConfiguration: (section: string) => {
            expect(section).toBe('http')
            return {
                inspect: () => ({ globalValue: ui.value, workspaceValue: ui.workspaceValue }),
                get: () => ui.workspaceValue ?? ui.value,
                update: ui.update
            }
        },
        onDidChangeConfiguration: (listener: typeof ui.configuration) => {
            ui.configuration = listener
            return { dispose: ui.dispose }
        }
    },
    window: {
        createWebviewPanel: () => ({
            webview: {
                onDidReceiveMessage: (listener: typeof ui.receive) => {
                    ui.receive = listener
                    return { dispose() {} }
                },
                postMessage: ui.post,
                asWebviewUri: () => 'asset'
            },
            onDidDispose() {},
            dispose: ui.dispose
        })
    }
}))

function setup(running = true, port = 43123) {
    let state!: () => void
    const client = {
        running,
        port,
        onEvent: (listener: (event: { type: string }) => void) => {
            state = () => listener({ type: 'state' })
            return { dispose: ui.dispose }
        }
    }
    const panel = new SettingsPanel({} as vscode.ExtensionContext, client as unknown as AgentClient)
    panel.show()
    return { panel, client, state }
}
const latest = () => ui.post.mock.lastCall![0] as Extract<HostMessage, { type: 'settings' }>

beforeEach(() => {
    vi.clearAllMocks()
    ui.value = undefined
    ui.workspaceValue = undefined
    ui.update.mockImplementation(async (_key, value) => {
        ui.value = value
    })
})

describe('VS Code proxy buttons', () => {
    it('sets only the global HTTP proxy to the current live port', async () => {
        const { panel, client } = setup()
        client.port = 45678
        ui.receive!({ type: 'setVSCodeProxy' })
        await vi.waitFor(() => expect(latest().saved).toBe('http.proxy'))
        expect(ui.update).toHaveBeenCalledExactlyOnceWith('proxy', 'http://127.0.0.1:45678', 1)
        expect(latest().vscodeProxy).toMatchObject({ configured: true, canSet: true })
        panel.dispose()
    })

    it.each([
        [false, 43123],
        [true, 0],
        [true, 65536]
    ] as const)('rejects stale actions when running=%s port=%s', async (running, port) => {
        const { panel } = setup(running, port)
        ui.receive!({ type: 'setVSCodeProxy' })
        await vi.waitFor(() => expect(latest().error).toContain('Start capture'))
        expect(ui.update).not.toHaveBeenCalled()
        panel.dispose()
    })

    it('removes the user override even when capture has stopped', async () => {
        ui.value = 'http://127.0.0.1:43123'
        const { panel } = setup(false, 0)
        ui.receive!({ type: 'removeVSCodeProxy' })
        await vi.waitFor(() => expect(latest().saved).toBe('http.proxy'))
        expect(ui.update).toHaveBeenCalledExactlyOnceWith('proxy', undefined, 1)
        expect(latest().vscodeProxy).toMatchObject({ configured: false, canSet: false })
        panel.dispose()
    })

    it('refreshes button availability on capture and external configuration changes', () => {
        const { panel, client, state } = setup(false, 0)
        ui.receive!({ type: 'loadSettings' })
        expect(latest().vscodeProxy).toMatchObject({ configured: false, canSet: false })
        expect(latest().target?.sslNoHosts).toEqual(['private.test'])
        client.running = true
        client.port = 43210
        state()
        expect(latest().target?.port).toBe(43210)
        expect(latest().vscodeProxy?.canSet).toBe(true)
        ui.value = 'http://other-proxy:8080'
        ui.configuration!({ affectsConfiguration: (key) => key === 'http.proxy' })
        expect(latest().vscodeProxy?.configured).toBe(true)
        panel.dispose()
    })

    it('follows port changes and restores the previous user proxy on stop', async () => {
        ui.value = 'http://original:8080'
        const { panel, client, state } = setup()
        ui.receive!({ type: 'setVSCodeProxy' })
        await vi.waitFor(() => expect(ui.value).toBe('http://127.0.0.1:43123'))
        client.port = 45678
        state()
        await vi.waitFor(() => expect(ui.value).toBe('http://127.0.0.1:45678'))
        client.running = false
        state()
        await vi.waitFor(() => expect(ui.value).toBe('http://original:8080'))
        panel.dispose()
    })

    it('cleans up on deactivation but preserves an external edit or another window proxy', async () => {
        const { panel, client } = setup()
        ui.receive!({ type: 'setVSCodeProxy' })
        await vi.waitFor(() => expect(ui.value).toBe('http://127.0.0.1:43123'))
        await synchronizeVSCodeProxy(client, true)
        expect(ui.value).toBeUndefined()
        ui.receive!({ type: 'setVSCodeProxy' })
        await vi.waitFor(() => expect(ui.value).toBe('http://127.0.0.1:43123'))
        ui.value = 'http://127.0.0.1:49999'
        await synchronizeVSCodeProxy(client, true)
        expect(ui.value).toBe('http://127.0.0.1:49999')
        panel.dispose()
    })

    it('shows the effective workspace override and its mismatch', () => {
        ui.workspaceValue = 'http://workspace:8080'
        const { panel } = setup()
        ui.receive!({ type: 'loadSettings' })
        expect(latest().vscodeProxy).toMatchObject({
            effective: ui.workspaceValue,
            scope: 'workspace',
            matches: false,
            configured: false
        })
        panel.dispose()
    })

    it('reports write failures without reporting success', async () => {
        const { panel } = setup()
        ui.update.mockRejectedValueOnce(new Error('Settings are read-only'))
        ui.receive!({ type: 'setVSCodeProxy' })
        await vi.waitFor(() => expect(latest().error).toContain('read-only'))
        expect(latest().saved).toBeUndefined()
        panel.dispose()
    })
})
