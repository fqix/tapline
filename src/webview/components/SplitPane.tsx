import { useCallback, useRef, useState, type ReactNode } from 'react'

/** Two stacked panes with a draggable horizontal divider; `ratio` is the top pane's share. */
export function SplitPane({
    top,
    bottom,
    initial = 0.5,
    minimum = 0.15
}: {
    top: ReactNode
    bottom: ReactNode
    initial?: number
    minimum?: number
}) {
    const [ratio, setRatio] = useState(initial)
    const container = useRef<HTMLDivElement>(null)
    const onPointerDown = useCallback(
        (event: React.PointerEvent) => {
            const element = container.current
            if (!element) return
            event.preventDefault()
            const bounds = element.getBoundingClientRect()
            const move = (e: PointerEvent) => {
                const next = (e.clientY - bounds.top) / bounds.height
                setRatio(Math.min(1 - minimum, Math.max(minimum, next)))
            }
            const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
        },
        [minimum]
    )
    return (
        <div className="split" ref={container}>
            <div className="split-pane" style={{ flexBasis: `${ratio * 100}%` }}>
                {top}
            </div>
            <div
                className="split-divider"
                onPointerDown={onPointerDown}
                role="separator"
                aria-orientation="horizontal"
            />
            <div className="split-pane" style={{ flexBasis: `${(1 - ratio) * 100}%` }}>
                {bottom}
            </div>
        </div>
    )
}
