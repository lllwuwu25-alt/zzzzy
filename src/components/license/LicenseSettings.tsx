import { FileKey2 } from 'lucide-react'
import { licenseLabel } from '../../lib/license'
import { useLicense } from './LicenseBoundary'

export function LicenseSettings() {
  const license = useLicense()
  if (!license) return null
  const { status, openActivation } = license
  return <section className="settings-section"><div><h2>设备授权</h2><p>永久离线使用，不上传错题，不需要联网续期。</p></div><div className="license-settings-info"><div className="license-settings-title"><FileKey2 size={19}/><strong>{licenseLabel(status)}</strong></div><p>{status.message}</p>{status.purchaseCode && <div className="license-settings-code"><span>购买授权编号</span><code>{status.purchaseCode}</code></div>}{status.machineCode && <div className="license-settings-code"><span>本机机器码</span><code>{status.machineCode}</code></div>}<button className="button ghost" onClick={openActivation}>{status.state === 'preview' || status.state === 'development' ? '查看离线激活流程' : '查看或导入授权'}</button></div></section>
}
