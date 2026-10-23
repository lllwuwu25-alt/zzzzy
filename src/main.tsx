import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { hydrateNotebook } from './store'
import { StorageRecovery } from './components/StorageRecovery'
import './styles.css'
import './workbench.css'

const root = createRoot(document.getElementById('root')!)
async function start() {
  try {
    await hydrateNotebook()
    root.render(<StrictMode><App /></StrictMode>)
  } catch (error) {
    root.render(<StrictMode><StorageRecovery error={error} onRetry={start} /></StrictMode>)
  }
}

void start()
