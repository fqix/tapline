declare global {
    interface Window {
        __strings: Record<string, string>
    }
}
/** Localised strings injected by the extension host; `{0}` placeholders. */
export function t(key: string, ...args: (string | number)[]) {
    const value = window.__strings?.[key] ?? key
    return value.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''))
}
