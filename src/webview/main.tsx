import { Settings } from './components/Settings'
import { vscode } from './lib/vscode'
import { createRoot } from 'react-dom/client'
import '@vscode/codicons/dist/codicon.css'
import './styles/base.css'
import './styles/table.css'
import './styles/inspector.css'
import { App } from './App'

const settingsView = document.body.dataset.view === 'settings'

// The panel offers its own copy actions (which go through the extension host); the
// browser's cut / copy / paste — keyboard shortcuts, the context menu and drag-drop —
// are blocked so nothing leaves or enters the webview through the system clipboard.
// Elements marked `data-clipboard` (header tables, the request editor) keep the native
// clipboard: tables for selection and copy, the editor so a URL, a body or a whole curl
// command can be pasted in.
const exempt = (event: Event) =>
    settingsView || (event.target instanceof Element && !!event.target.closest('[data-clipboard]'))
const block = (event: Event) => {
    if (!exempt(event)) event.preventDefault()
}
for (const type of ['cut', 'copy', 'paste', 'contextmenu', 'drop'] as const)
    document.addEventListener(type, block, true)
document.addEventListener(
    'keydown',
    (event) => {
        if (settingsView) return
        if ((event.metaKey || event.ctrlKey) && ['c', 'x', 'v'].includes(event.key.toLowerCase()))
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
