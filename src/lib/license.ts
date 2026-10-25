import { invoke, isTauri } from '@tauri-apps/api/core'
import type { Notebook } from '../types'

export type LicenseState = 'active' | 'unactivated' | 'invalid' | 'unavailable' | 'misconfigured' | 'development' | 'preview'
export type LicenseStatus = { state: LicenseState; canWrite: boolean; machineCode: string | null; platform: string; purchaseCode: string | null; licenseId: string | null; message: string }
export const MAX_LICENSE_BYTES = 32 * 1024
const closed = (message: string): LicenseStatus => ({ state: 'unavailable', canWrite: false, machineCode: null, platform: 'unknown', purchaseCode: null, licenseId: null, message })
export const canUseWorkbench = (status: LicenseStatus) => status.canWrite && ['active', 'development', 'preview'].includes(status.state)
function nativeStatus(value: unknown): LicenseStatus {
  if (!value || typeof value !== 'object') return closed('暂时无法读取本机授权，已有资料仍可查看和导出。')
  const state = value as LicenseStatus
  if (!['active', 'unactivated', 'invalid', 'unavailable', 'misconfigured', 'development'].includes(state.state) || typeof state.canWrite !== 'boolean' || typeof state.message !== 'string' || typeof state.platform !== 'string') return closed('本机授权状态无效，请重新打开应用。')
  if (state.state === 'active' && (!state.purchaseCode || !state.licenseId || !state.machineCode)) return closed('本机授权信息不完整，请重新导入授权文件。')
  return { ...state, canWrite: state.canWrite && ['active', 'development'].includes(state.state) }
}
export async function getLicenseStatus(): Promise<LicenseStatus> {
  if (!isTauri()) return import.meta.env.DEV
    ? { ...closed('网页开发预览不进行真实设备激活；正式授权在桌面版中验证。'), state: 'preview', platform: 'web', canWrite: true }
    : closed('当前不是桌面版，无法验证设备授权。请使用正式桌面应用。')
  try { return nativeStatus(await invoke('get_license_status')) }
  catch { return closed('暂时无法读取本机授权。请重试或重新打开应用，已有资料仍可查看和导出。') }
}
export async function activateLicense(contents: string): Promise<LicenseStatus> {
  if (!isTauri()) throw Error('请在桌面版导入授权文件，网页预览不能激活真实设备。')
  if (!contents.trim() || new TextEncoder().encode(contents).byteLength > MAX_LICENSE_BYTES) throw Error('授权文件为空或超过 32 KB，请选择卖家提供的授权文件。')
  const status = nativeStatus(await invoke('import_license', { contents }))
  if (status.state !== 'active' || !status.canWrite) throw Error(status.message || '未能激活，请核对授权文件。')
  return status
}
export function makeActivationRequest(status: LicenseStatus) {
  if (!status.machineCode) throw Error('当前无法生成机器码，请在桌面版检查系统权限后重试。')
  return { version: 1, product: 'mistake-notebook', machineCode: status.machineCode, platform: status.platform }
}
export function exportNotebookData(notebook: Notebook): string {
  if (notebook.items.some((item) => item.images.some((image) => !image.dataUrl || image.dataUrl.endsWith('base64,')))) throw Error('尚有原图未下载，不能导出为完整备份。请先在云同步中下载整套题库图片，再导出备份。')
  const { version, workspaceName, items, reviews, taxonomy, reviewSettings, workspaceUpdatedAt } = notebook
  return JSON.stringify({ version, workspaceName, items, reviews, taxonomy, reviewSettings, workspaceUpdatedAt }, null, 2)
}
export function downloadText(contents: string, name: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export async function saveNotebookBackup(notebook: Notebook): Promise<string | null> {
  const contents = exportNotebookData(notebook)
  if (isTauri()) return invoke('export_notebook_backup', { contents })
  const name = `错题本备份-${new Date().toISOString().slice(0, 10)}.json`
  downloadText(contents, name)
  return name
}
export async function saveActivationRequest(status: LicenseStatus): Promise<string | null> {
  if (isTauri()) return invoke('export_license_request')
  const name = `错题本激活申请.ctb-request.json`
  downloadText(JSON.stringify(makeActivationRequest(status), null, 2), name)
  return name
}
export const licenseLabel = (status: LicenseStatus) => ({ active: '已激活 · 永久离线', unactivated: '尚未激活', invalid: '授权待核对', unavailable: '授权暂不可用', misconfigured: '发行公钥未配置', development: '开发模式', preview: '网页预览' })[status.state]
