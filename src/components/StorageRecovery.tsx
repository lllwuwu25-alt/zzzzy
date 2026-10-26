import { useState } from 'react'
import { FolderLock, RotateCcw } from 'lucide-react'
import { storageErrorMessage } from '../lib/storage-errors'
import { invoke } from '@tauri-apps/api/core'
import { nativeAndroidBuild } from '../lib/platform'

export function StorageRecovery({ error, onRetry }: { error: unknown; onRetry: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  return <main className="storage-recovery">
    <section aria-labelledby="storage-recovery-title">
      <FolderLock size={28} aria-hidden="true" />
      <h1 id="storage-recovery-title">暂时无法读取错题本</h1>
      <p role="alert">{storageErrorMessage(error, '本地记录无法读取或格式损坏。为保护已有内容，已暂停打开题库。')}</p>
      <p>没有清空或覆盖已有数据。请勿清理浏览器的网站数据，以免丢失错题。</p>
      {nativeAndroidBuild() && <><p>安卓数据位于应用私有目录；请勿卸载或清除应用数据。可以先导出同步前自动备份，再联系支持处理。</p><button className="button ghost" disabled={busy} onClick={async () => { setBusy(true); try { const path = await invoke<string | null>('export_sync_backup'); setNotice(path ? '自动备份已导出，原记录保持不变。' : '已取消导出，原记录保持不变。') } catch (error) { setNotice(typeof error === 'string' ? error : '没有完成备份导出，请重试。') } finally { setBusy(false) } }}>导出同步前自动备份</button>{notice && <p role="status">{notice}</p>}</>}
      <button className="button primary" disabled={busy} onClick={async () => { setBusy(true); try { await onRetry() } finally { setBusy(false) } }}><RotateCcw size={16} />{busy ? '正在读取…' : '重试读取'}</button>
    </section>
  </main>
}
