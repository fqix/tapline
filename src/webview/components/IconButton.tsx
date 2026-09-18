import type { ButtonHTMLAttributes } from 'react'

/** Codicon button styled like a VS Code toolbar action; `label` adds text after the icon. */
export function IconButton({
    icon,
    title,
    label,
    active,
    className = '',
    ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon: string
    title: string
    label?: string
    active?: boolean
}) {
    return (
        <button
            type="button"
            className={`icon-button ${active ? 'active' : ''} ${className}`}
            title={title}
            aria-label={title}
            aria-pressed={active}
            {...rest}
        >
            <span className={`codicon codicon-${icon}`} aria-hidden="true" />
            {label && <span className="label">{label}</span>}
        </button>
    )
}
