import { useCallback, useRef, useState, type ReactNode } from 'react'
import { saveState, state } from '../lib/vscode'
import type { Layout } from '../types/messages'

/** Two panes with a draggable divider; `ratio` is the first pane's share, persisted per layout. */
export function SplitPane({
    layout,
    first,
    second,
    minimum = 0.15
}: {
    layout: Layout
    first: ReactNode
    second: ReactNode
    minimum?: number
}) {
    const [ratio, setRatio] = useState(() => state().ratio ?? 0.5)
    const container = useRef<HTMLDivElement>(null)
    const onPointerDown = useCallback(
        (event: React.PointerEvent) => {
            const element = container.current
            if (!element) return
            event.preventDefault()
            const bounds = element.getBoundingClientRect()
            let latest = ratio
            const move = (e: PointerEvent) => {
                const next =
                    layout === 'stacked'
                        ? (e.clientY - bounds.top) / bounds.height
                        : (e.clientX - bounds.left) / bounds.width
                latest = Math.min(1 - minimum, Math.max(minimum, next))
                setRatio(latest)
            }
            const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
                document.body.classList.remove('resizing')
                saveState({ ratio: latest })
            }
            document.body.classList.add('resizing')
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
        },
        [layout, minimum, ratio]
    )
    return (
        <div className={`split ${layout}`} ref={container}>
            <div className="split-pane" style={{ flexBasis: `${ratio * 100}%` }}>
                {first}
            </div>
            <div
                className="split-divider"
                onPointerDown={onPointerDown}
                role="separator"
                aria-orientation={layout === 'stacked' ? 'horizontal' : 'vertical'}
            />
            <div className="split-pane" style={{ flexBasis: `${(1 - ratio) * 100}%` }}>
                {second}
            </div>
        </div>
    )
}
