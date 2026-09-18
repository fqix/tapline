import { useEffect, useState } from 'react'
import { saveState, vscode } from '../lib/vscode'
import type { HostMessage } from '../types/messages'

/** Latest view sent by the extension host, persisted so a hidden panel restores instantly. */
export function useHostMessages() {
    const [view, setView] = useState<HostMessage | undefined>(() => vscode.getState()?.view)
    useEffect(() => {
        const listener = (event: MessageEvent<HostMessage>) => {
            setView(event.data)
            saveState({ view: event.data })
        }
        window.addEventListener('message', listener)
        vscode.postMessage({ type: 'ready' })
        return () => window.removeEventListener('message', listener)
    }, [])
    return view
}
