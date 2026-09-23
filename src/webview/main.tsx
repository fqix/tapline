import { Settings } from './components/Settings'
import { vscode } from './lib/vscode'
import { createRoot } from 'react-dom/client'
import '@vscode/codicons/dist/codicon.css'
import './styles/base.css'
import './styles/table.css'
import './styles/inspector.css'
import { App } from './App'

const settingsView = document.body.dataset.view === 'settings'

// Keep native selection/copy and context menus available throughout the panel.
// Only editing clipboard operations and drops require an explicit editable region;
// the request editor uses data-clipboard so URLs, bodies and curl commands can be pasted.
const element = (target: EventTarget | null): Element | null =>
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null

const exempt = (event: Event) => {
    if (settingsView) return true
    const el = element(event.target)
    if (!el) return false
    if (el.closest('[data-clipboard]')) return true
    return false
}
const block = (event: Event) => {
    if (!exempt(event)) event.preventDefault()
}
for (const type of ['cut', 'paste', 'drop'] as const) document.addEventListener(type, block, true)
document.addEventListener(
    'keydown',
    (event) => {
        if (settingsView) return
        if ((event.metaKey || event.ctrlKey) && ['x', 'v'].includes(event.key.toLowerCase()))
            if (!exempt(event)) event.preventDefault()
    },
    true
)

createRoot(document.getElementById('root')!).render(
    settingsView ? (
        <Settings
            onClose={() => vscode.postMessage({ type: 'closeSettings' })}
            onRules={() => vscode.postMessage({ type: 'openRules' })}
        />
    ) : (
        <App />
    )
)
