import * as vscode from 'vscode'
import { preferenceSchema, type PreferenceSchema } from './shared/preferences'

type Change = { affectsConfiguration(section: string): boolean }

export function validatePreference(value: unknown, schema: PreferenceSchema): boolean {
    if (Array.isArray(schema.type))
        return schema.type.some((type) => validatePreference(value, { ...schema, type }))
    if (schema.type === 'null') return value === null
    if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value)
    if (schema.type === 'integer')
        return (
            typeof value === 'number' &&
            Number.isInteger(value) &&
            value >= (schema.minimum ?? -Infinity) &&
            value <= (schema.maximum ?? Infinity)
        )
    if (schema.type === 'array')
        return (
            Array.isArray(value) &&
            value.every((item) => !schema.items || validatePreference(item, schema.items))
        )
    if (schema.type === 'object') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false
        const fields = value as Record<string, unknown>
        return (
            (schema.required ?? []).every((key) => key in fields) &&
            Object.entries(fields).every(([key, item]) => {
                const child =
                    schema.properties?.[key] ??
                    (typeof schema.additionalProperties === 'object'
                        ? schema.additionalProperties
                        : undefined)
                return child
                    ? validatePreference(item, child)
                    : schema.additionalProperties !== false
            })
        )
    }
    return typeof value === schema.type && (!schema.enum || schema.enum.includes(value as string))
}

export class Preferences {
    private storage?: vscode.Memento
    private snapshot = ''
    private listeners = new Set<(event: Change) => void>()
    readonly onDidChange = (listener: (event: Change) => void) => {
        this.listeners.add(listener)
        return {
            dispose: () => {
                this.listeners.delete(listener)
            }
        }
    }
    async initialize(context: vscode.ExtensionContext) {
        this.storage = context.globalState
        if (!this.storage.get('preferences.migrated')) {
            const legacy = vscode.workspace.getConfiguration('tapline')
            for (const [key, schema] of Object.entries(preferenceSchema)) {
                const value = legacy.inspect(key)?.globalValue
                if (
                    value !== undefined &&
                    this.storage.get(`preferences.${key}`) === undefined &&
                    validatePreference(value, schema)
                )
                    await this.storage.update(`preferences.${key}`, value)
            }
            await this.storage.update('preferences.migrated', true)
        }
        this.snapshot = JSON.stringify(this.values())
        const timer = setInterval(() => this.refresh(), 2000)
        timer.unref()
        context.subscriptions.push({
            dispose: () => {
                clearInterval(timer)
                this.listeners.clear()
                this.storage = undefined
            }
        })
    }
    get<T>(key: string, fallback?: T): T {
        return structuredClone(
            this.storage?.get(`preferences.${key}`) ?? preferenceSchema[key]?.default ?? fallback
        ) as T
    }
    values(): Record<string, unknown> {
        return Object.fromEntries(Object.keys(preferenceSchema).map((key) => [key, this.get(key)]))
    }
    async update(key: string, value: unknown) {
        const schema = preferenceSchema[key]
        if (!schema || !validatePreference(value, schema))
            throw new Error(`Invalid setting: ${key}`)
        if (!this.storage) throw new Error('Settings storage is not initialized')
        await this.storage.update(`preferences.${key}`, structuredClone(value))
        this.refresh()
    }
    private refresh() {
        const values = this.values()
        const next = JSON.stringify(values)
        if (next === this.snapshot) return
        const previous = JSON.parse(this.snapshot || '{}') as Record<string, unknown>
        this.snapshot = next
        const changed = Object.keys(values).filter(
            (key) => JSON.stringify(values[key]) !== JSON.stringify(previous[key])
        )
        const event = {
            affectsConfiguration: (section: string) =>
                changed.some(
                    (key) =>
                        `tapline.${key}` === section || `tapline.${key}`.startsWith(section + '.')
                )
        }
        for (const listener of this.listeners) listener(event)
    }
}
export const preferences = new Preferences()
