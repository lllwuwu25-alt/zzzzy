import { beforeEach, expect, it, vi } from 'vitest'
const metrics = vi.hoisted(() => ({ exchanges: 0 }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }))
vi.mock('../store', () => ({ readSyncNotebook: () => ({}), transactSyncNotebook: vi.fn(), attachCloudNotebook: vi.fn(), switchCloudSpace: vi.fn(), clearCloudLocalCopy: vi.fn() }))
vi.mock('./client', async (original) => ({ ...await original<typeof import('./client')>(), cloudClient: () => ({ request: async (_method: string, path: string) => {
  if (path === '/v1/auth/exchange') { metrics.exchanges++; await Promise.resolve(); return { status: 'complete' } }
  if (path === '/v1/status') return { status: 'configured' }
  return { account: { id: 'a', name: '测试' }, environment: 'staging', device: { id: 'd', status: 'pending_device' }, connection: { status: 'connected' } }
} }) }))
beforeEach(() => { vi.resetModules(); metrics.exchanges = 0; const entries = new Map([['ctb-oauth-attempt-v1', JSON.stringify({ attemptId: 'attempt', pollToken: 'short-lived', expiresAt: Date.now() + 60000 })]]); vi.stubGlobal('sessionStorage', { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key) }); vi.stubGlobal('history', { replaceState: vi.fn() }) })
it('resumes a one-time web OAuth result only once during duplicate React mounts', async () => {
  const { resumeCloudAuthorization } = await import('./controller')
  await Promise.all([resumeCloudAuthorization(), resumeCloudAuthorization()])
  expect(metrics.exchanges).toBe(1)
})
it('exports diagnostics from an explicit metadata whitelist without QR, identity or provider credentials', async () => {
  const { cloudDiagnostics, useCloud } = await import('./controller')
  useCloud.setState({ binding: { bindingId: 'sensitive-binding', token: 'secret-qr-token', url: 'https://example.test/#token=secret-qr-token', expiresAt: Date.now() }, identity: { account: { id: 'sensitive-account', name: 'private-user' }, device: { id: 'sensitive-device', name: 'private-device', status: 'active' }, environment: 'staging', connection: { status: 'connected' } }, error: { code: 'REAUTH_REQUIRED', message: 'private-question-content', requestId: 'req-123' } })
  const json = JSON.stringify(cloudDiagnostics())
  for (const secret of ['sensitive-binding', 'secret-qr-token', 'sensitive-account', 'private-user', 'private-question-content', 'sensitive-device']) expect(json).not.toContain(secret)
  expect(json).toContain('REAUTH_REQUIRED')
  expect(json).toContain('req-123')
})
