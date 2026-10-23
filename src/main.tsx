import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { hydrateNotebook } from './store'
import { StorageRecovery } from './components/StorageRecovery'
import { applyTheme, getThemePreference } from './lib/themes'
import { LicenseBoundary } from './components/license/LicenseBoundary'
import './styles.css'
import './workbench.css'
import './themes.css'

applyTheme(getThemePreference())
const root = createRoot(document.getElementById('root')!)
async function start() {
  try {
    await hydrateNotebook()
    root.render(<StrictMode><LicenseBoundary><App /></LicenseBoundary></StrictMode>)
  } catch (error) {
    root.render(<StrictMode><StorageRecovery error={error} onRetry={start} /></StrictMode>)
  }
}

void start()
