import { useEffect, useState } from 'react'
import { saveState, vscode } from '../lib/vscode'
import type { HostMessage } from '../types/messages'

type Detail = Extract<HostMessage, { type: 'detail' }>

/**
 * Latest view sent by the extension host, persisted so a hidden panel restores
 * instantly. `detail` messages update the sequence selection without replacing the view.
 */
export function useHostMessages() {
    const [view, setView] = useState<HostMessage | undefined>(() => vscode.getState()?.view)
    const [detail, setDetail] = useState<Detail | undefined>()
    useEffect(() => {
        const listener = (event: MessageEvent<HostMessage>) => {
            if (event.data.type === 'detail') {
                setDetail(event.data)
                return
            }
            setView(event.data)
            if (event.data.type !== 'sequence') saveState({ view: event.data })
            else saveState({ view: { type: 'sequence', rows: [] } })
        }
        window.addEventListener('message', listener)
        vscode.postMessage({ type: 'ready' })
        return () => window.removeEventListener('message', listener)
    }, [])
    return { view, detail }
}
