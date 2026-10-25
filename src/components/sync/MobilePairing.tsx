import { useState } from 'react'
import { ScanLine, X } from 'lucide-react'
import { acceptBindingLink, useCloud } from '../../sync/controller'
import { nativeAndroidBuild } from '../../lib/platform'

export function MobilePairing() {
  const [scanning, setScanning] = useState(false), [notice, setNotice] = useState(''), [paste, setPaste] = useState(false), [link, setLink] = useState('')
  const cloud = useCloud()
  if (!nativeAndroidBuild() || cloud.identity?.device.status === 'active' || cloud.phase === 'unconfigured') return null
  const scan = async () => {
    setNotice(''); setScanning(true)
    try {
      const scanner = await import('@tauri-apps/plugin-barcode-scanner')
      if (await scanner.checkPermissions() !== 'granted' && await scanner.requestPermissions() !== 'granted') throw Error('相机权限未开启。可在系统设置中允许，或粘贴电脑复制的绑定链接。')
      const result = await scanner.scan({ formats: [scanner.Format.QRCode], windowed: false })
      await acceptBindingLink(result.content)
    } catch (error) { setNotice(error instanceof Error ? error.message : '扫码未完成，可以重试或粘贴电脑的绑定链接。') }
    finally { setScanning(false) }
  }
  return <div className="mobile-pairing"><button className="button primary" disabled={scanning || cloud.busy} onClick={() => void scan()}><ScanLine size={18}/>{scanning ? '正在扫码…' : '扫描电脑绑定二维码'}</button>{scanning && <button className="button ghost" onClick={() => void import('@tauri-apps/plugin-barcode-scanner').then((scanner) => scanner.cancel()).catch(() => setScanning(false))}><X size={16}/>取消扫码</button>}<button className="text-link" onClick={() => setPaste(!paste)}>无法扫码？粘贴绑定链接</button>{paste && <form onSubmit={(event) => { event.preventDefault(); void acceptBindingLink(link).then(() => setLink('')) }}><label>电脑中“添加设备”生成的链接<input value={link} onChange={(event) => setLink(event.target.value)} type="url" autoComplete="off" spellCheck={false}/></label><button className="button ghost" disabled={!link.trim() || cloud.busy}>连接这台手机</button></form>}{notice && <p role="status">{notice}</p>}<p>扫码只用于申请加入；必须在电脑确认后才能读取云端题库。</p></div>
}
