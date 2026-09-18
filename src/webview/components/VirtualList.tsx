import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { scrollIntoView, visibleRange } from '../lib/virtual'

/**
 * Fixed-height windowed list: only the rows near the viewport exist in the DOM.
 * `reveal` scrolls an index into view whenever its `tick` changes.
 */
export function VirtualList<T>({
    items,
    rowHeight,
    render,
    reveal,
    header,
    empty
}: {
    items: T[]
    rowHeight: number
    render(item: T, index: number): ReactNode
    reveal?: { index: number; tick: number }
    header?: ReactNode
    empty?: ReactNode
}) {
    const container = useRef<HTMLDivElement>(null)
    const [scrollTop, setScrollTop] = useState(0)
    const [viewport, setViewport] = useState(0)
    useLayoutEffect(() => {
        const element = container.current
        if (!element) return
        const observer = new ResizeObserver(() => setViewport(element.clientHeight))
        observer.observe(element)
        setViewport(element.clientHeight)
        return () => observer.disconnect()
    }, [])
    // Scroll once per request; a later index shift (rows inserted above) must not re-scroll.
    const revealed = useRef<number | undefined>(undefined)
    useEffect(() => {
        const element = container.current
        if (!reveal || !element || reveal.index < 0 || revealed.current === reveal.tick) return
        revealed.current = reveal.tick
        const head = headerHeight(element)
        element.scrollTop = scrollIntoView(
            element.scrollTop,
            element.clientHeight - head,
            reveal.index,
            rowHeight
        )
    }, [reveal?.tick, reveal?.index, rowHeight]) // eslint-disable-line react-hooks/exhaustive-deps
    const range = visibleRange(scrollTop, viewport, items.length, rowHeight)
    return (
        <div
            className="virtual"
            ref={container}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
            {header}
            {items.length === 0 ? (
                empty
            ) : (
                <div className="virtual-body" style={{ height: items.length * rowHeight }}>
                    <div style={{ transform: `translateY(${range.top}px)` }}>
                        {items
                            .slice(range.start, range.end)
                            .map((item, i) => render(item, range.start + i))}
                    </div>
                </div>
            )}
        </div>
    )
}

const headerHeight = (element: HTMLElement) =>
    (element.firstElementChild as HTMLElement | null)?.classList.contains('grid-head')
        ? (element.firstElementChild as HTMLElement).offsetHeight
        : 0
