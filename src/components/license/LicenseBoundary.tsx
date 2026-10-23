import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { NotebookTabs } from 'lucide-react'
import { canUseWorkbench, getLicenseStatus, type LicenseStatus } from '../../lib/license'
import { useNotebook } from '../../store'
import { ActivationView } from './ActivationView'
import { ReadonlyNotebook } from './ReadonlyNotebook'

type LicenseContextValue = { status: LicenseStatus; openActivation: () => void }
const LicenseContext = createContext<LicenseContextValue | null>(null)
export const useLicense = () => useContext(LicenseContext)

export function LicenseBoundary({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LicenseStatus>(), [screen, setScreen] = useState<'auto' | 'activation' | 'readonly'>('auto')
  const mounted = useRef(false), generation = useRef(0)
  const notebook = useNotebook()
  const refresh = useCallback(async () => {
    const request = ++generation.current, next = await getLicenseStatus()
    if (mounted.current && request === generation.current) setStatus(next)
  }, [])
  useEffect(() => {
    mounted.current = true
    void refresh()
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => { mounted.current = false; generation.current++; window.removeEventListener('focus', onFocus) }
  }, [refresh])
  if (!status) return <main className="license-loading" role="status"><NotebookTabs size={24}/><p>正在检查本机授权…</p></main>
  const activated = (next: LicenseStatus) => { generation.current++; setStatus(next); setScreen('auto') }
  return <LicenseContext.Provider value={{ status, openActivation: () => setScreen('activation') }}>
    {screen === 'readonly' ? <ReadonlyNotebook notebook={notebook} onActivate={() => setScreen('activation')}/>
      : screen === 'activation' || !canUseWorkbench(status) ? <ActivationView status={status} onActivated={activated} onReadonly={() => setScreen('readonly')} onRetry={refresh} onBack={canUseWorkbench(status) ? () => setScreen('auto') : undefined}/>
      : children}
  </LicenseContext.Provider>
}
