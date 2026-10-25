import { invoke, isTauri } from '@tauri-apps/api/core'

export class CloudError extends Error {
  code: string
  retryable: boolean
  requestId?: string
  retryAfter?: number
  constructor(code: string, message: string, retryable = false, requestId?: string, retryAfter?: number) {
    super(message); this.name = 'CloudError'; this.code = code; this.retryable = retryable; this.requestId = requestId; this.retryAfter = retryAfter
  }
}
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
export type CloudIdentity = { account: { id: string; name: string; tenantKey?: string }; device: { id: string; name: string; type?: string; status: 'active' | 'pending_device' }; environment: string; csrfToken?: string; connection: { status: string }; library?: CloudLibrary }
export type CloudLibrary = { id: string; name: string; url: string; epoch: string; state: string }
export type CloudDevice = { id: string; name: string; type: string; status: string; createdAt: string | number; lastSeenAt?: string | number }
export type Binding = { bindingId: string; token?: string; url?: string; expiresAt: string | number; status?: string; pendingDeviceId?: string; pendingDeviceName?: string }
export type AuthAttempt = { attemptId: string; pollToken: string; authorizationUrl: string; expiresAt: string | number }

export const publicGatewayUrl = () => import.meta.env.VITE_SYNC_GATEWAY_URL as string | undefined
export const safeAuthorizationUrl = (value: string) => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && url.hostname === 'accounts.feishu.cn' && url.pathname === '/open-apis/authen/v1/authorize' }
  catch { return false }
}
function validateBase(value: string) {
  const url = new URL(value)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new CloudError('CONFIG_INVALID', '同步服务地址配置不安全，请联系部署人员。')
  return url.origin
}
export class CloudClient {
  private base: string
  private fetcher: Fetcher
  private csrf?: string
  constructor(options: { baseUrl: string; fetcher?: Fetcher }) { this.base = validateBase(options.baseUrl); this.fetcher = options.fetcher ?? fetch }
  async request<T = Record<string, unknown>>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
    if (!path.startsWith('/v1/') || path.includes('..') || path.includes('\\') || path.includes('#') || path.startsWith('//')) throw new CloudError('INVALID_PATH', '同步请求地址无效。')
    let result: { status: number; body: unknown }
    if (isTauri()) {
      if (!publicGatewayUrl()) throw new CloudError('NOT_CONFIGURED', '这个安装包尚未配置云同步服务，请联系部署人员；本地测试与已有资料不受影响。')
      try { result = await invoke('sync_gateway_request', { method, path, body: body ?? null }) }
      catch (error) { throw new CloudError('NATIVE_REQUEST_FAILED', typeof error === 'string' ? error : '同步服务暂不可用，请稍后重试。', true) }
    } else {
      let response: Response
      try { response = await this.fetcher(`${this.base}${path}`, { method, credentials: 'include', headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(this.csrf && method !== 'GET' ? { 'X-CSRF-Token': this.csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45_000), cache: 'no-store' }) }
      catch { throw new CloudError('NETWORK_UNAVAILABLE', '网络连接中断。修改仍保存在本机，请联网后重试。', true) }
      try { result = { status: response.status, body: await response.json() } }
      catch { throw new CloudError('NOT_CONFIGURED', '云同步服务尚未配置或不可达，本地功能不受影响。') }
    }
    const data = result.body as Record<string, unknown>
    if (result.status < 200 || result.status >= 300) throw new CloudError(typeof data?.code === 'string' ? data.code : 'SERVICE_ERROR', typeof data?.message === 'string' ? data.message : '云同步暂不可用，请稍后重试。', data?.retryable === true, typeof data?.request_id === 'string' ? data.request_id : undefined, typeof data?.retry_after === 'number' ? data.retry_after : undefined)
    if (typeof data?.csrfToken === 'string') this.csrf = data.csrfToken
    return result.body as T
  }
  async openAuthorization(attempt: AuthAttempt) {
    if (!safeAuthorizationUrl(attempt.authorizationUrl)) throw new CloudError('INVALID_AUTH_URL', '授权地址未通过安全检查，请联系部署人员。')
    if (isTauri()) { sessionStorage.setItem('ctb-oauth-attempt-v1', JSON.stringify(attempt)); await invoke('open_feishu_authorization', { url: attempt.authorizationUrl }) }
    else { sessionStorage.setItem('ctb-oauth-attempt-v1', JSON.stringify(attempt)); window.location.assign(attempt.authorizationUrl) }
  }
  async downloadAsset(id: string): Promise<string> {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new CloudError('INVALID_ASSET', '图片标识无效。')
    const path = `/v1/assets/${id}/content`
    if (isTauri()) return (await this.request<{ dataUrl: string }>('GET', path)).dataUrl
    const response = await this.fetcher(`${this.base}${path}`, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new CloudError(response.status === 401 ? 'REAUTH_REQUIRED' : 'ASSET_DOWNLOAD_FAILED', '图片暂未下载，请检查连接后重试。', response.status >= 500)
    if (!/^image\/(png|jpeg|webp|gif|bmp)(?:;|$)/i.test(response.headers.get('content-type') ?? '') || Number(response.headers.get('content-length')) > 20 * 1024 * 1024) throw new CloudError('ASSET_RESPONSE_INVALID', '图片格式或大小不符合要求，已停止下载。')
    const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let size = 0
    if (!reader) throw new CloudError('ASSET_RESPONSE_INVALID', '图片内容为空。')
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 20 * 1024 * 1024) { await reader.cancel(); throw new CloudError('ASSET_TOO_LARGE', '图片超过下载限制。') }; chunks.push(part.value) }
    const blob = new Blob(chunks as BlobPart[], { type: response.headers.get('content-type')! })
    return new Promise((resolve, reject) => { const file = new FileReader(); file.onload = () => resolve(String(file.result)); file.onerror = () => reject(new CloudError('LOCAL_STORAGE_ERROR', '图片读取失败。')); file.readAsDataURL(blob) })
  }
}
let client: CloudClient | undefined
export const cloudClient = () => client ??= new CloudClient({ baseUrl: publicGatewayUrl() || (isTauri() ? 'https://not-configured.invalid' : typeof location === 'undefined' ? 'http://localhost:5174' : location.origin) })
