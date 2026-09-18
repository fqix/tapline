// Windowing arithmetic for fixed-height lists; pure so it can be unit tested.

export interface Range {
    start: number
    end: number
    top: number
    bottom: number
}

/** Rows [start, end) to render for a scroll position, padded by `overscan` rows each side. */
export function visibleRange(
    scrollTop: number,
    viewport: number,
    count: number,
    rowHeight: number,
    overscan = 8
): Range {
    if (count === 0 || rowHeight <= 0) return { start: 0, end: 0, top: 0, bottom: 0 }
    const first = Math.floor(Math.max(0, scrollTop) / rowHeight)
    const last = Math.ceil((Math.max(0, scrollTop) + viewport) / rowHeight)
    const start = Math.max(0, first - overscan)
    const end = Math.min(count, last + overscan)
    return { start, end, top: start * rowHeight, bottom: (count - end) * rowHeight }
}

/** Scroll offset that brings `index` into view with the least movement. */
export function scrollIntoView(
    scrollTop: number,
    viewport: number,
    index: number,
    rowHeight: number
): number {
    const top = index * rowHeight
    if (top < scrollTop) return top
    if (top + rowHeight > scrollTop + viewport) return top + rowHeight - viewport
    return scrollTop
}
