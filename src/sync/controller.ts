import { create } from 'zustand'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { cloudClient, CloudError, type AuthAttempt, type Binding, type CloudDevice, type CloudIdentity, type CloudLibrary } from './client'
import { SyncRunner } from './engine'
import { assertSyncIdentity, type MaybeSyncNotebook } from './model'
import { attachCloudNotebook, clearCloudLocalCopy, readSyncNotebook, switchCloudSpace, transactSyncNotebook } from '../store'
import { readLatestWebSyncBackup } from '../lib/web-notebook-storage'
import { downloadText } from '../lib/license'
import { appPlatform, cloudDeviceDescriptor, parseBindingLink } from '../lib/platform'
import { publicGatewayUrl } from './client'

export type CloudPhase = 'checking' | 'unconfigured' | 'disconnected' | 'authorizing' | 'pending_device' | 'initializing' | 'connected' | 'syncing' | 'offline' | 'error'
type CloudState = { phase: CloudPhase; identity?: CloudIdentity; library?: CloudLibrary; error?: { message: string; code: string; requestId?: string }; busy: boolean; binding?: Binding; bindings: Binding[]; devices: CloudDevice[]; mergePreview?: { local: number; remote: number; images: number } }
type ServiceInfo = { environment?: string; applicationType?: string; serviceVersion?: string; protocolVersion?: number }
let serviceInfo: ServiceInfo = {}
export const useCloud = create<CloudState>(() => ({ phase: 'checking', busy: false, devices: [], bindings: [] }))
let runner: SyncRunner | undefined
const getRunner = () => runner ??= new SyncRunner(cloudClient(), { read: readSyncNotebook, commit: transactSyncNotebook })
const showError = (caught: unknown) => {
  const error = caught instanceof CloudError ? caught : new CloudError(caught instanceof Error && caught.message === 'SYNC_IDENTITY_MISMATCH' ? 'ACCOUNT_MISMATCH' : 'LOCAL_SYNC_ERROR', caught instanceof Error && caught.message === 'SYNC_IDENTITY_MISMATCH' ? '本机题库属于另一账号，已停止同步，原账号的待上传内容不会发送给当前账号。请先导出备份并返回原账号。' : '操作未完成，本地资料仍保留。请重试或导出备份后联系支持。')
  useCloud.setState({ phase: error.code === 'NOT_CONFIGURED' || error.code === 'CONFIG_INVALID' ? 'unconfigured' : error.code === 'NETWORK_UNAVAILABLE' ? 'offline' : 'error', busy: false, error: { code: error.code, message: error.message, requestId: error.requestId } })
}
export async function refreshCloud() {
  try {
    const status = await cloudClient().request<ServiceInfo>('GET', '/v1/status')
    serviceInfo = { environment: ['development', 'staging', 'production'].includes(status.environment ?? '') ? status.environment : undefined, applicationType: status.applicationType === 'self_built' ? status.applicationType : undefined, serviceVersion: typeof status.serviceVersion === 'string' && /^\d+\.\d+\.\d+[-a-z0-9.]*$/i.test(status.serviceVersion) ? status.serviceVersion : undefined, protocolVersion: Number.isSafeInteger(status.protocolVersion) ? status.protocolVersion : undefined }
    const identity = await cloudClient().request<CloudIdentity>('GET', '/v1/me')
    const library = identity.library
    useCloud.setState({ identity, library, phase: identity.device.status === 'active' ? 'connected' : 'pending_device', error: undefined })
    if (library && readSyncNotebook().sync) assertSyncIdentity(readSyncNotebook(), { environment: identity.environment, accountId: identity.account.id, libraryId: library.id })
    return identity
  } catch (caught) {
    if (caught instanceof CloudError && caught.code === 'AUTH_REQUIRED') useCloud.setState({ phase: 'disconnected', identity: undefined, library: undefined, busy: false, error: undefined })
    else showError(caught)
    return undefined
  }
}
function bindingIntent(): { bindingId: string; token: string } | undefined {
  if (typeof location === 'undefined') return
  const bindingId = new URLSearchParams(location.search).get('bind'), token = new URLSearchParams(location.hash.slice(1)).get('token')
  if (bindingId && token) return { bindingId, token }
  try { const saved = sessionStorage.getItem('ctb-bind-intent'); if (saved) return JSON.parse(saved) } catch { /* invalid local intent never grants admission */ }
}
async function pollAuthorization(attempt: AuthAttempt) {
  const deadline = typeof attempt.expiresAt === 'number' ? attempt.expiresAt : Date.parse(attempt.expiresAt)
  while (Date.now() < deadline) {
    const response = await cloudClient().request<{ status: string }>('POST', '/v1/auth/exchange', { attemptId: attempt.attemptId, pollToken: attempt.pollToken, client: isTauri() ? 'native' : 'web' })
    if (response.status === 'complete') {
      sessionStorage.removeItem('ctb-oauth-attempt-v1'); sessionStorage.removeItem('ctb-bind-intent')
      if (!isTauri()) history.replaceState(null, '', '/')
      const identity = await refreshCloud()
      if (identity?.device.status === 'active') await initializeLibrary()
      return
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2000))
  }
  throw new CloudError('OAUTH_EXPIRED', '授权已过期，请重新连接飞书。')
}
let authorizationInProgress = false
export async function connectCloud() {
  if (authorizationInProgress) return
  authorizationInProgress = true
  useCloud.setState({ busy: true, phase: 'authorizing', error: undefined })
  try {
    const binding = bindingIntent()
    if (binding) sessionStorage.setItem('ctb-bind-intent', JSON.stringify(binding))
    const attempt = await cloudClient().request<AuthAttempt>('POST', '/v1/auth/feishu/start', { client: isTauri() ? 'native' : 'web', ...cloudDeviceDescriptor(appPlatform()), ...(binding ? { binding } : {}) })
    await cloudClient().openAuthorization(attempt)
    if (isTauri()) await pollAuthorization(attempt)
  } catch (caught) { showError(caught) }
  finally { authorizationInProgress = false; useCloud.setState({ busy: false }) }
}
let resumeTask: Promise<boolean> | undefined
export function resumeCloudAuthorization(): Promise<boolean> {
  return resumeTask ??= resumeAuthorizationOnce().finally(() => { resumeTask = undefined })
}
async function resumeAuthorizationOnce() {
  const raw = sessionStorage.getItem('ctb-oauth-attempt-v1')
  if (!raw) return false
  try { const attempt: AuthAttempt = JSON.parse(raw); if (!attempt.attemptId || !attempt.pollToken) throw Error(); useCloud.setState({ phase: 'authorizing', busy: true }); await pollAuthorization(attempt) }
  catch (caught) { sessionStorage.removeItem('ctb-oauth-attempt-v1'); showError(caught) }
  finally { useCloud.setState({ busy: false }) }
  return true
}
export async function initializeLibrary() {
  useCloud.setState({ busy: true, phase: 'initializing', error: undefined })
  try {
    const library = await cloudClient().request<CloudLibrary>('POST', '/v1/libraries/bootstrap', {})
    useCloud.setState({ library, phase: 'connected' })
    await previewFirstSync()
  } catch (caught) { showError(caught) }
  finally { useCloud.setState({ busy: false }) }
}
export async function previewFirstSync() {
  const { identity, library } = useCloud.getState()
  if (!identity || !library) return
  const notebook = readSyncNotebook()
  assertSyncIdentity(notebook, { environment: identity.environment, accountId: identity.account.id, libraryId: library.id })
  if (notebook.sync) return
  let page: string | null | undefined, epoch = '', remote = 0
  do {
    const snapshot = await cloudClient().request<{ entities: Array<{ kind: string }>; epoch: string; hasMore: boolean; nextPage: string | null }>('GET', `/v1/sync/snapshot?limit=100&scope_account=${identity.account.id}&scope_library=${library.id}&scope_environment=${identity.environment}${page ? `&page=${page}&epoch=${epoch}` : ''}`)
    remote += snapshot.entities.filter((entity) => entity.kind === 'question').length; epoch = snapshot.epoch; page = snapshot.hasMore ? snapshot.nextPage : null
  } while (page)
  useCloud.setState({ mergePreview: { local: notebook.items.length, remote, images: notebook.items.reduce((total, item) => total + item.images.length, 0) } })
}
export async function confirmFirstSync() {
  const { identity, library } = useCloud.getState()
  if (!identity || !library) return
  useCloud.setState({ busy: true })
  try { await attachCloudNotebook({ environment: identity.environment, accountId: identity.account.id, libraryId: library.id }, identity.device.id); useCloud.setState({ mergePreview: undefined }); await syncNow() }
  catch (caught) { showError(caught) }
  finally { useCloud.setState({ busy: false }) }
}
export async function activateAccountSpace() {
  const { identity, library } = useCloud.getState()
  if (!identity || !library || identity.device.status !== 'active') return
  try { useCloud.setState({ busy: true }); await switchCloudSpace({ accountId: identity.account.id, libraryId: library.id, environment: identity.environment }, identity.device.id); useCloud.setState({ error: undefined, phase: 'connected' }); await syncNow() }
  catch (caught) { showError(caught) }
  finally { useCloud.setState({ busy: false }) }
}
export async function syncNow() {
  if (useCloud.getState().busy && useCloud.getState().phase === 'syncing') return
  const { identity, library } = useCloud.getState()
  if (!identity || identity.device.status !== 'active' || !library || !readSyncNotebook().sync || readSyncNotebook().sync?.paused) return
  try {
    assertSyncIdentity(readSyncNotebook(), { environment: identity.environment, accountId: identity.account.id, libraryId: library.id })
    useCloud.setState({ phase: 'syncing', busy: true, error: undefined })
    await getRunner().run()
    useCloud.setState({ phase: 'connected', busy: false })
  } catch (caught) { showError(caught) }
}
export async function pauseCloud(paused: boolean) {
  await transactSyncNotebook((notebook) => notebook.sync ? { ...notebook, sync: { ...notebook.sync, paused, ...(!paused ? { blocked: undefined, retryAt: undefined, retryCount: 0 } : {}) } } : notebook)
  if (!paused) await syncNow()
}
export async function refreshDevices() {
  try { const response = await cloudClient().request<{ devices: CloudDevice[] }>('GET', '/v1/devices'); const binding = await cloudClient().request<{ bindings: Binding[] }>('GET', '/v1/device-bindings'); useCloud.setState({ devices: response.devices, bindings: binding.bindings }) }
  catch (caught) { showError(caught) }
}
export async function createBinding() {
  try { useCloud.setState({ binding: await cloudClient().request<Binding>('POST', '/v1/device-bindings', { action: 'create' }) }); await refreshDevices() }
  catch (caught) { showError(caught) }
}
export async function bindingAction(action: 'confirm' | 'cancel', binding: Binding) {
  try { await cloudClient().request('POST', '/v1/device-bindings', { action, bindingId: binding.bindingId, pendingDeviceId: binding.pendingDeviceId }); if (action === 'cancel') useCloud.setState({ binding: undefined }); await refreshDevices() }
  catch (caught) { showError(caught) }
}
export async function claimBinding() {
  const intent = bindingIntent(); if (!intent) return
  try { await cloudClient().request('POST', '/v1/device-bindings', { action: 'claim', ...intent }); sessionStorage.setItem('ctb-bind-intent', JSON.stringify(intent)); history.replaceState(null, '', '/'); await refreshCloud() }
  catch (caught) { showError(caught) }
}

export async function acceptBindingLink(value: string) {
  try {
    const gateway = publicGatewayUrl()
    if (!gateway) throw new CloudError('NOT_CONFIGURED', '安装包尚未配置同步服务，请先联系部署人员。')
    const intent = parseBindingLink(value, gateway)
    sessionStorage.setItem('ctb-bind-intent', JSON.stringify(intent))
    if (!useCloud.getState().identity) await connectCloud()
    else if (useCloud.getState().identity?.device.status === 'pending_device') await claimBinding()
    else throw new CloudError('ALREADY_BOUND', '这台设备已加入题库，无需重复绑定。')
  } catch (caught) { showError(caught instanceof CloudError ? caught : new CloudError('INVALID_BINDING_LINK', caught instanceof Error ? caught.message : '绑定二维码无效，请重新生成。')) }
}
export async function removeDevice(id: string) { try { await cloudClient().request('DELETE', `/v1/devices/${id}`); await refreshDevices() } catch (caught) { showError(caught) } }
export async function renameCloudDevice(id: string, name: string) { try { await cloudClient().request('PATCH', `/v1/devices/${id}`, { name }); await refreshDevices() } catch (caught) { showError(caught) } }
export async function showSyncBackup() {
  try {
    if (isTauri()) { await invoke('open_sync_backup_folder'); return }
    const contents = await readLatestWebSyncBackup()
    if (!contents) throw new CloudError('BACKUP_NOT_FOUND', '尚无同步前备份。首次连接前会自动创建。')
    downloadText(contents, `错题本-同步前本机快照-${new Date().toISOString().slice(0, 10)}.json`)
  } catch (caught) { showError(caught) }
}
export async function disconnectCloud(logoutOnly = false, clearLocal = false) {
  try { if (clearLocal && (readSyncNotebook().sync?.outbox.length || readSyncNotebook().sync?.conflicts.length)) throw new CloudError('UNSYNCED_LOCAL_DATA', '仍有待同步内容或冲突，不能清除副本。请先导出备份或选择保留。'); if (readSyncNotebook().sync) await pauseCloud(true); await cloudClient().request('POST', logoutOnly ? '/v1/auth/logout' : '/v1/connections/feishu/disconnect', {}); if (clearLocal) await clearCloudLocalCopy(); useCloud.setState({ phase: 'disconnected', identity: undefined, library: undefined, devices: [], binding: undefined, bindings: [], mergePreview: undefined }) }
  catch (caught) { showError(caught) }
}
export async function downloadCloudImages() { useCloud.setState({ busy: true }); try { await getRunner().downloadAll() } catch (caught) { showError(caught) } finally { useCloud.setState({ busy: false }) } }
const downloading = new Map<string, Promise<void>>()
export function downloadCloudAsset(assetId: string) {
  if (!downloading.has(assetId)) downloading.set(assetId, getRunner().downloadOne(assetId).finally(() => downloading.delete(assetId)))
  return downloading.get(assetId)!
}
export function downloadCloudImage(imageId: string) {
  const notebook = readSyncNotebook(), item = notebook.items.find((entry) => entry.images.some((image) => image.id === imageId))
  const assetId = item && notebook.sync?.assetVersions[`${item.id}:${imageId}`]?.assetId
  if (!assetId) return Promise.reject(new CloudError('ASSET_NOT_FOUND', '这张图片没有可下载的云端原图，请从备份恢复。'))
  return downloadCloudAsset(assetId)
}
export async function recoverCloudAccess() { try { useCloud.setState({ phase: 'authorizing', busy: true }); const attempt = await cloudClient().request<AuthAttempt>('POST', '/v1/auth/recover', { confirm: true }); await cloudClient().openAuthorization(attempt); if (isTauri()) await pollAuthorization(attempt) } catch (caught) { showError(caught) } finally { useCloud.setState({ busy: false }) } }
export const commitCloudModel = (build: (notebook: MaybeSyncNotebook) => MaybeSyncNotebook) => transactSyncNotebook(build).catch(showError)
export function cloudDiagnostics() {
  const state = useCloud.getState(), sync = readSyncNotebook().sync
  return { version: 1, generatedAt: new Date().toISOString(), client: isTauri() ? 'desktop' : 'web', service: serviceInfo, phase: state.phase, deviceStatus: state.identity?.device.status, queued: sync?.outbox.length ?? 0, assetsPending: sync?.outbox.filter((op) => op.kind === 'asset').length ?? 0, conflicts: sync?.conflicts.length ?? 0, retryCount: sync?.retryCount ?? 0, errorCode: state.error?.code && /^[A-Z_0-9]{1,80}$/.test(state.error.code) ? state.error.code : undefined, requestId: state.error?.requestId && /^[a-zA-Z0-9_-]{1,128}$/.test(state.error.requestId) ? state.error.requestId : undefined }
}
export function exportCloudDiagnostics() { downloadText(JSON.stringify(cloudDiagnostics(), null, 2), '错题本-脱敏同步诊断.json') }
