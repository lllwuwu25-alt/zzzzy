import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Copy, Download, FileKey2, NotebookTabs, RefreshCw, ShieldCheck, Upload } from 'lucide-react'
import { activateLicense, saveActivationRequest, licenseLabel, MAX_LICENSE_BYTES, type LicenseStatus } from '../../lib/license'
import { ActionButton } from '../ActionButton'
import './license.css'

export function ActivationView({ status, onActivated, onReadonly, onRetry, onBack }: { status: LicenseStatus; onActivated: (status: LicenseStatus) => void; onReadonly: () => void; onRetry: () => Promise<void>; onBack?: () => void }) {
  const file = useRef<HTMLInputElement>(null), code = useRef<HTMLTextAreaElement>(null), heading = useRef<HTMLHeadingElement>(null)
  const [busy, setBusy] = useState(false), [retrying, setRetrying] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('')
  const preview = status.state === 'preview' || status.state === 'development'
  async function exportRequest() {
    setBusy(true); setError(''); setNotice('')
    try { const path = await saveActivationRequest(status); if (path) setNotice('激活申请已导出，请发送给卖家。') }
    catch (caught) { setError(typeof caught === 'string' ? caught : caught instanceof Error ? caught.message : '未能导出申请，请检查保存位置。') }
    finally { setBusy(false) }
  }
  useEffect(() => heading.current?.focus(), [])
  async function importFile(selected?: File) {
    if (!selected) return
    setError(''); setNotice('')
    if (selected.size > MAX_LICENSE_BYTES || selected.size === 0) { setError('授权文件为空或超过 32 KB，请选择卖家提供的授权文件。'); if (file.current) file.current.value = ''; return }
    setBusy(true)
    try { onActivated(await activateLicense(await selected.text())) }
    catch (caught) { setError(typeof caught === 'string' ? caught : caught instanceof Error ? caught.message : '没有完成激活，请核对文件后重试。') }
    finally { setBusy(false); if (file.current) file.current.value = '' }
  }
  return <main className="license-start" onDragOver={event => event.preventDefault()} onDrop={event => event.preventDefault()}>
    <header className="license-brand"><NotebookTabs size={22}/><strong>错题本</strong><span>本地学习工作台</span>{onBack && <button className="button ghost compact" onClick={onBack}><ArrowLeft size={14}/>返回工作台</button>}</header>
    <div className="license-layout">
      <section aria-labelledby="activation-title">
        <span className="license-state"><FileKey2 size={15}/>{licenseLabel(status)}</span>
        <h1 id="activation-title" tabIndex={-1} ref={heading}>把这台设备，变成你的学习工作台。</h1>
        <p className="license-intro">永久离线授权。完成一次激活，以后无需联网续期。</p>
        <div className="license-machine">
          <label htmlFor="activation-machine">本机机器码</label>
          <textarea id="activation-machine" ref={code} readOnly value={status.machineCode || ''} placeholder={preview ? '网页预览不生成真实机器码' : '暂时无法读取，请检查权限后重试'} spellCheck={false}/>
          <div className="button-row">
            <button className="button ghost compact" disabled={!status.machineCode || busy} onClick={async () => { try { await navigator.clipboard.writeText(status.machineCode!); setNotice('机器码已复制，可发送给卖家。') } catch { code.current?.focus(); code.current?.select(); setNotice('已选中机器码，请按 ⌘C 或 Ctrl+C 复制。') } }}><Copy size={14}/>复制机器码</button>
            <button className="button ghost compact" disabled={!status.machineCode || busy} onClick={() => void exportRequest()}><Download size={14}/>导出激活申请</button>
          </div>
          <small>仅包含经过哈希处理的设备标识，不含题目或原始硬件编号。</small>
        </div>
        <div className="license-import">
          <p>{status.message}</p>
          <div className="button-row">
            <ActionButton className="primary" busy={busy} busyLabel="正在校验授权" disabled={preview || !status.machineCode || status.state === 'misconfigured'} onClick={() => file.current?.click()}><Upload size={15}/>导入授权文件</ActionButton>
            <ActionButton className="ghost" busy={retrying} busyLabel="正在检查" disabled={busy} onClick={async () => { setError(''); setRetrying(true); try { await onRetry() } finally { setRetrying(false) } }}><RefreshCw size={14}/>重新检查</ActionButton>
          </div>
          <input ref={file} hidden type="file" accept=".ctb-license.json,.json,application/json" aria-label="选择授权文件" onChange={event => void importFile(event.target.files?.[0])}/>
          {preview && <small>这是{status.state === 'preview' ? '网页预览' : '开发构建'}，不代表正式授权；请在配置发行公钥后的桌面版测试真实激活。</small>}
          {error && <p className="license-error" role="alert">{error}</p>}
          <span className="license-notice" role="status" aria-live="polite">{notice}</span>
        </div>
      </section>
      <aside className="license-explanation" aria-label="离线激活说明">
        <h2>只需这一次</h2>
        <ol><li><strong>发送机器码</strong><p>把本机机器码或激活申请文件，连同购买信息一起发给卖家。</p></li><li><strong>收到设备授权</strong><p>每份购买授权最多签发两台设备。同一设备重新导出不占新名额。</p></li><li><strong>导入，开始学习</strong><p>导入卖家发来的授权文件。校验在本机完成，不会上传错题。</p></li></ol>
        <div className="license-data-safe"><ShieldCheck size={18}/><div><strong>你的资料始终属于你</strong><p>即使暂时无法激活，也不会删除已有错题。你仍然可以查看与导出。</p><button className="button ghost" onClick={onReadonly}>查看与导出已有资料</button></div></div>
        <p className="license-replacement-note">换电脑请联系卖家人工处理。离线旧授权无法被远程撤销。</p>
      </aside>
    </div>
  </main>
}
