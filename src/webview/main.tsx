import { createRoot } from 'react-dom/client'
import '@vscode/codicons/dist/codicon.css'
import './styles/base.css'
import './styles/table.css'
import './styles/inspector.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
