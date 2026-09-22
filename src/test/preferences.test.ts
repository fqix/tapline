import { describe, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import { Preferences, validatePreference } from '../preferences'
import { preferenceSchema } from '../shared/preferences'
vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: () => ({
            inspect: (key: string) => ({
                globalValue: key === 'port' ? 4123 : undefined,
                workspaceValue: 4999
            })
        })
    }
}))
function setup(data = new Map<string, unknown>()) {
    const subscriptions: { dispose(): void }[] = []
    const context = {
        globalState: {
            get: (key: string) => data.get(key),
            update: async (key: string, value: unknown) => {
                data.set(key, value)
            }
        },
        subscriptions
    } as unknown as vscode.ExtensionContext
    return { data, context, dispose: () => subscriptions.forEach((d) => d.dispose()) }
}
describe('global preferences', () => {
    it('migrates only explicit global values once and preserves subsequent edits', async () => {
        const fixture = setup()
        const store = new Preferences()
        await store.initialize(fixture.context)
        expect(store.get('port')).toBe(4123)
        const events: string[] = []
        store.onDidChange((event) => {
            if (event.affectsConfiguration('tapline.port')) events.push('port')
        })
        await store.update('port', 4567)
        expect(events).toEqual(['port'])
        fixture.dispose()
        const next = setup(fixture.data)
        const restored = new Preferences()
        await restored.initialize(next.context)
        expect(restored.get('port')).toBe(4567)
        next.dispose()
    })
    it('rejects invalid values without changing storage', async () => {
        const fixture = setup()
        const store = new Preferences()
        await store.initialize(fixture.context)
        await expect(store.update('port', 0)).rejects.toThrow()
        await expect(store.update('unknown', true)).rejects.toThrow()
        await expect(store.update('terminal.profiles', ['invalid'])).rejects.toThrow()
        expect(store.get('port')).toBe(4123)
        fixture.dispose()
    })
    it('detects shared storage updates and notifies subscribers', async () => {
        vi.useFakeTimers()
        const fixture = setup()
        const store = new Preferences()
        await store.initialize(fixture.context)
        const listener = vi.fn()
        store.onDidChange(listener)
        fixture.data.set('preferences.ssl.enabled', false)
        vi.advanceTimersByTime(2000)
        expect(store.get('ssl.enabled')).toBe(false)
        expect(listener.mock.calls[0][0].affectsConfiguration('tapline.ssl')).toBe(true)
        fixture.dispose()
        vi.useRealTimers()
    })
    it('accepts every default and returns detached values', async () => {
        for (const schema of Object.values(preferenceSchema))
            expect(validatePreference(schema.default, schema)).toBe(true)
        const store = new Preferences()
        store.get<string[]>('ssl.hosts').push('example.com')
        expect(store.get('ssl.hosts')).toEqual(['*'])
    })
})
