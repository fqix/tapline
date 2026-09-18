import { useState, type ReactNode } from 'react'
import { saveState, state } from '../lib/vscode'

const collapsed = new Set(state().collapsed ?? [])

/** Collapsible devtools-style section; the collapsed set is persisted by `id`. */
export function Section({
    id,
    title,
    count,
    actions,
    children
}: {
    id: string
    title: string
    count?: number | string
    actions?: ReactNode
    children: ReactNode
}) {
    const [open, setOpen] = useState(!collapsed.has(id))
    const toggle = () => {
        if (open) collapsed.add(id)
        else collapsed.delete(id)
        setOpen(!open)
        saveState({ collapsed: [...collapsed] })
    }
    return (
        <section className={`section ${open ? 'open' : ''}`}>
            <header className="section-head">
                <button
                    type="button"
                    className="section-toggle"
                    onClick={toggle}
                    aria-expanded={open}
                >
                    <span
                        className={`codicon codicon-chevron-${open ? 'down' : 'right'}`}
                        aria-hidden="true"
                    />
                    <span className="section-title">{title}</span>
                    {count !== undefined && <span className="section-count">{count}</span>}
                </button>
                {open && actions && <span className="section-actions">{actions}</span>}
            </header>
            {open && <div className="section-body">{children}</div>}
        </section>
    )
}
