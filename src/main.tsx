import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { hydrateNotebook } from './store'
import { StorageRecovery } from './components/StorageRecovery'
import { applyTheme, getThemePreference } from './lib/themes'
import { CloudApplication } from './components/sync/CloudApplication'
import { appPlatform } from './lib/platform'
import './styles.css'
import './workbench.css'
import './themes.css'
import './sync.css'
import './mobile.css'

applyTheme(getThemePreference())
document.documentElement.dataset.platform = appPlatform()
const root = createRoot(document.getElementById('root')!)
async function start() {
  try {
    await hydrateNotebook()
    root.render(<StrictMode><CloudApplication><App /></CloudApplication></StrictMode>)
  } catch (error) {
    root.render(<StrictMode><StorageRecovery error={error} onRetry={start} /></StrictMode>)
  }
}

void start()
