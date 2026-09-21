import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'

/** Codicon button styled like a VS Code toolbar action; `label` adds text after the icon. */
export function IconButton({
    icon,
    title,
    label,
    active,
    className = '',
    onMouseEnter,
    onMouseLeave,
    onFocus,
    onBlur,
    onClick,
    ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: string
    title: string
    label?: string
    active?: boolean
}) {
    const button = useRef<HTMLButtonElement>(null)
    const tooltip = useRef<HTMLDivElement>(null)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const id = useId()
    const [visible, setVisible] = useState(false)
    const [position, setPosition] = useState({ left: 0, top: 0 })
    const cancelTimer = () => {
        clearTimeout(timer.current)
        timer.current = undefined
    }
    const hide = () => {
        cancelTimer()
        setVisible(false)
    }
    useEffect(() => () => clearTimeout(timer.current), [])
    useLayoutEffect(() => {
        if (!visible || !button.current || !tooltip.current) return
        const anchor = button.current.getBoundingClientRect()
        const box = tooltip.current.getBoundingClientRect()
        const margin = 6
        setPosition({
            left: Math.max(margin, Math.min(anchor.left, window.innerWidth - box.width - margin)),
            top:
                anchor.bottom + box.height + margin * 2 <= window.innerHeight
                    ? anchor.bottom + margin
                    : Math.max(margin, anchor.top - box.height - margin)
        })
        const dismiss = () => setVisible(false)
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') dismiss()
        }
        window.addEventListener('scroll', dismiss, true)
        window.addEventListener('resize', dismiss)
        window.addEventListener('blur', dismiss)
        window.addEventListener('keydown', escape)
        return () => {
            window.removeEventListener('scroll', dismiss, true)
            window.removeEventListener('resize', dismiss)
            window.removeEventListener('blur', dismiss)
            window.removeEventListener('keydown', escape)
        }
    }, [visible, title])
    return (
        <>
            <button
                type="button"
                className={`icon-button ${active ? 'active' : ''} ${className}`}
                aria-label={title}
                aria-pressed={active}
                {...rest}
                ref={button}
                aria-describedby={visible ? id : rest['aria-describedby']}
                onMouseEnter={(event) => {
                    cancelTimer()
                    timer.current = setTimeout(() => setVisible(true), 300)
                    onMouseEnter?.(event)
                }}
                onMouseLeave={(event) => {
                    hide()
                    onMouseLeave?.(event)
                }}
                onFocus={(event) => {
                    cancelTimer()
                    setVisible(true)
                    onFocus?.(event)
                }}
                onBlur={(event) => {
                    hide()
                    onBlur?.(event)
                }}
                onClick={(event) => {
                    hide()
                    onClick?.(event)
                }}
            >
                {icon && <span className={`codicon codicon-${icon}`} aria-hidden="true" />}
                {label && <span className="label">{label}</span>}
            </button>
            {visible &&
                createPortal(
                    <div
                        ref={tooltip}
                        id={id}
                        role="tooltip"
                        className="icon-tooltip"
                        style={position}
                    >
                        {title}
                    </div>,
                    document.body
                )}
        </>
    )
}
