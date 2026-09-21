import { createRoot } from 'react-dom/client'
import '@vscode/codicons/dist/codicon.css'
import './styles/base.css'
import './styles/table.css'
import './styles/inspector.css'
import { App } from './App'

// The panel offers its own copy actions (which go through the extension host); the
// browser's cut / copy / paste — keyboard shortcuts, the context menu and drag-drop —
// are blocked so nothing leaves or enters the webview through the system clipboard.
for (const type of ['cut', 'copy', 'paste'] as const)
    document.addEventListener(type, (event) => event.preventDefault(), true)
document.addEventListener('contextmenu', (event) => event.preventDefault(), true)
document.addEventListener(
    'keydown',
    (event) => {
        if ((event.metaKey || event.ctrlKey) && ['c', 'x', 'v'].includes(event.key.toLowerCase()))
            event.preventDefault()
    },
    true
)
document.addEventListener('drop', (event) => event.preventDefault(), true)

createRoot(document.getElementById('root')!).render(<App />)
