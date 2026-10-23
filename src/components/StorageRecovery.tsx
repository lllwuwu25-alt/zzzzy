import { useState } from 'react'
import { FolderLock, RotateCcw } from 'lucide-react'
import { storageErrorMessage } from '../lib/storage-errors'

export function StorageRecovery({ error, onRetry }: { error: unknown; onRetry: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return <main className="storage-recovery">
    <section aria-labelledby="storage-recovery-title">
      <FolderLock size={28} aria-hidden="true" />
      <h1 id="storage-recovery-title">暂时无法读取错题本</h1>
      <p role="alert">{storageErrorMessage(error, '本地记录无法读取或格式损坏。为保护已有内容，已暂停打开题库。')}</p>
      <p>没有清空或覆盖已有数据。请勿清理浏览器的网站数据，以免丢失错题。</p>
      <button className="button primary" disabled={busy} onClick={async () => { setBusy(true); try { await onRetry() } finally { setBusy(false) } }}><RotateCcw size={16} />{busy ? '正在读取…' : '重试读取'}</button>
    </section>
  </main>
}
