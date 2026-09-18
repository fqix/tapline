// Minimal `vscode` module stand-in for testing providers outside the extension host.
import { vi } from 'vitest'

export class EventEmitter<T> {
    private listeners: ((e: T) => void)[] = []
    event = (listener: (e: T) => void) => {
        this.listeners.push(listener)
        return { dispose: () => this.listeners.splice(this.listeners.indexOf(listener), 1) }
    }
    fire(e: T) {
        for (const l of this.listeners) l(e)
    }
    dispose() {}
}
export class TreeItem {
    id?: string
    description?: string
    tooltip?: unknown
    iconPath?: unknown
    contextValue?: string
    command?: unknown
    constructor(
        public label: string,
        public collapsibleState = 0
    ) {}
}
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 }
export class ThemeIcon {
    static Folder = new ThemeIcon('folder')
    constructor(
        public id: string,
        public color?: unknown
    ) {}
}
export class ThemeColor {
    constructor(public id: string) {}
}
export class MarkdownString {
    constructor(
        public value: string,
        public supportThemeIcons?: boolean
    ) {}
}
export const config: Record<string, unknown> = {}
export const workspace = {
    getConfiguration: () => ({
        get: <T>(key: string, fallback: T) => (config[key] as T) ?? fallback
    }),
    onDidChangeConfiguration: () => ({ dispose() {} })
}
export const window = {
    createTreeView: () => ({ selection: [], description: '', dispose() {} }),
    createOutputChannel: () => ({ info() {}, warn() {}, error() {}, debug() {}, dispose() {} })
}
export const commands = { executeCommand: vi.fn() }
export const l10n = {
    t: (s: string, ...args: unknown[]) => s.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)]))
}
