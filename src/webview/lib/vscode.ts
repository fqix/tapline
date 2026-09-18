import type { PanelMessage, PanelState } from '../types/messages'

interface VsCodeApi {
    postMessage(message: PanelMessage): void
    getState(): PanelState | undefined
    setState(state: PanelState): void
}
declare function acquireVsCodeApi(): VsCodeApi

/** The webview's handle to the extension host; acquired once per page load. */
export const vscode = acquireVsCodeApi()

export function saveState(patch: Partial<PanelState>) {
    vscode.setState({ ...vscode.getState(), ...patch })
}
