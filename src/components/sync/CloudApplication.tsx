import { useEffect, useState, type ReactNode } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { Cloud, NotebookTabs } from 'lucide-react'
import { useNotebook } from '../../store'
import { refreshCloud, resumeCloudAuthorization, syncNow, useCloud } from '../../sync/controller'
import { LicenseBoundary } from '../license/LicenseBoundary'
import { CloudSettings } from './CloudSettings'
import { nativeAndroidBuild } from '../../lib/platform'

export const mobileCloudBuild = () => !isTauri() && import.meta.env.VITE_CLOUD_MOBILE === 'true'

function SyncRuntime() {
  useEffect(() => {
    let timer: number | undefined, mounted = true
    const focus = async () => { if (!mounted || document.visibilityState === 'hidden') return; await refreshCloud(); if (mounted) await syncNow() }
    void (async () => { if (!await resumeCloudAuthorization()) { await refreshCloud(); if (mounted) await syncNow() } })()
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void focus() }, 30_000)
    let pendingIds = ''
    const unsubscribe = useNotebook.subscribe((notebook) => {
      const nextIds = notebook.sync?.outbox.map((op) => op.mutationId).join(',') ?? ''
      if (nextIds === pendingIds) return
      pendingIds = nextIds; window.clearTimeout(timer)
      timer = window.setTimeout(() => { if (mounted && document.visibilityState === 'visible') void syncNow() }, 2000)
    })
    window.addEventListener('online', focus); window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus)
    return () => { mounted = false; unsubscribe(); window.clearInterval(interval); window.clearTimeout(timer); window.removeEventListener('online', focus); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus) }
  }, [])
  return null
}
function MobileCloudBoundary({ children }: { children: ReactNode }) {
  const state = useCloud(), notebook = useNotebook(), [localOnly, setLocalOnly] = useState(false)
  const active = state.identity?.device.status === 'active' && state.identity.account.id === notebook.sync?.identity.accountId && state.identity.environment === notebook.sync.identity.environment && state.library?.id === notebook.sync.identity.libraryId
  if (active || (localOnly && (notebook.sync || nativeAndroidBuild()))) return <>{localOnly && <div className="cloud-local-banner"><Cloud size={14}/>{notebook.sync ? '正在使用本机副本；联网同步仍需有效设备会话。' : '安卓本机测试 · 尚未连接云端'}<button onClick={() => setLocalOnly(false)}>返回连接</button></div>}{children}</>
  return <main className="cloud-mobile-entry"><header><NotebookTabs size={23}/><strong>错题本</strong><span>手机工作台 · 测试版</span></header><h1>题库随身，学习继续。</h1><p>在电脑连接飞书并生成绑定二维码，再用这台手机扫码。登录同一飞书身份，由电脑确认后下载题库。</p><CloudSettings/>{(notebook.sync || nativeAndroidBuild()) && <button className="button ghost" onClick={() => setLocalOnly(true)}>{notebook.sync ? '继续使用已保存在本机的题库' : '先测试本机录题与复习'}</button>}<p className="cloud-mobile-note">这是独立安卓测试空间，不替代桌面版离线购买授权。数据保存于本应用私有目录；卸载、清除应用数据会删除本机资料，请先导出备份。</p></main>
}
export function CloudApplication({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (mobileCloudBuild() && 'serviceWorker' in navigator && !import.meta.env.DEV) void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  }, [])
  return (mobileCloudBuild() || nativeAndroidBuild()) ? <><SyncRuntime/><MobileCloudBoundary>{children}</MobileCloudBoundary></> : <LicenseBoundary><SyncRuntime/>{children}</LicenseBoundary>
}
