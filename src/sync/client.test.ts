import { describe, expect, it, vi, afterEach } from 'vitest'
import { CloudClient, CloudError, safeAuthorizationUrl, cloudClient } from './client'

describe('cloud transport security', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
  it('reports an unconfigured native build before attempting network or credential access', async () => {
    vi.stubGlobal('isTauri', true)
    vi.stubEnv('VITE_SYNC_GATEWAY_URL', '')
    const client = new CloudClient({ baseUrl: 'https://not-configured.invalid' })
    await expect(client.request('GET', '/v1/status')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' })
  })
  it('can construct the native client without mistaking the webview origin for a gateway', async () => {
    vi.stubGlobal('isTauri', true)
    vi.stubGlobal('location', { origin: 'http://tauri.localhost' })
    vi.stubEnv('VITE_SYNC_GATEWAY_URL', '')
    await expect(cloudClient().request('GET', '/v1/status')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' })
  })
  it('does not accept an insecure public gateway or credentials embedded in a URL', () => {
    expect(() => new CloudClient({ baseUrl: 'http://example.com' })).toThrow()
    expect(() => new CloudClient({ baseUrl: 'https://user:pass@example.com' })).toThrow()
  })
  it('only opens the exact Feishu authorization endpoint', () => {
    expect(safeAuthorizationUrl('https://accounts.feishu.cn/open-apis/authen/v1/authorize?client_id=x')).toBe(true)
    expect(safeAuthorizationUrl('https://accounts.feishu.cn.evil.test/open-apis/authen/v1/authorize')).toBe(false)
    expect(safeAuthorizationUrl('javascript:alert(1)')).toBe(false)
  })
  it('sends cookies and csrf for writes, without a browser bearer token', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = []
    const client = new CloudClient({ baseUrl: 'https://app.example.com', fetcher: async (url, init) => {
      seen.push({ url: String(url), init: init! })
      return Response.json(seen.length === 1 ? { csrfToken: 'one-csrf', device: { status: 'active' } } : { ok: true })
    } })
    await client.request('GET', '/v1/me')
    await client.request('POST', '/v1/libraries/bootstrap', {})
    expect(seen[1].init.credentials).toBe('include')
    expect(new Headers(seen[1].init.headers).get('X-CSRF-Token')).toBe('one-csrf')
    expect(new Headers(seen[1].init.headers).has('Authorization')).toBe(false)
  })
  it('preserves actionable retry information and refuses foreign paths', async () => {
    const client = new CloudClient({ baseUrl: 'https://app.example.com', fetcher: async () => Response.json({ code: 'DEVICE_REVOKED', message: '设备已撤销', retryable: false, request_id: 'req-7' }, { status: 403 }) })
    await expect(client.request('GET', '/v1/me')).rejects.toMatchObject({ code: 'DEVICE_REVOKED', requestId: 'req-7', retryable: false })
    await expect(client.request('GET', '//evil.test/v1/me')).rejects.toBeInstanceOf(CloudError)
    await expect(client.request('GET', '/v1/../secret')).rejects.toBeInstanceOf(CloudError)
  })
})
