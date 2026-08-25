import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { hydrateNotebook } from './store'
import './styles.css'

async function start() {
  await hydrateNotebook()
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
}

void start()
