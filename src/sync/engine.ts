import { ackMutations, applyRemoteChanges, cacheAssetData, markMutationsInFlight, pendingMutations, type MaybeSyncNotebook, type SyncState } from './model'
import { parseEntity, type MutationResult, type SyncEntity, type SyncIdentity } from './protocol'
import { CloudError } from './client'

export type SyncTransport = {
  request: <T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<T>
  downloadAsset: (id: string) => Promise<string>
}
type Storage = { read: () => MaybeSyncNotebook; commit: (build: (notebook: MaybeSyncNotebook) => MaybeSyncNotebook) => Promise<void> }
type Page = { epoch: string; cursor: string | number; hasMore: boolean; entities?: SyncEntity[]; changes?: SyncEntity[]; nextPage?: string | null }
const bytesFromData = (url: string) => {
  const match = /^data:(image\/(?:png|jpe?g|webp|gif|bmp));base64,([A-Za-z0-9+/=]+)$/i.exec(url)
  if (!match) throw new CloudError('INVALID_LOCAL_IMAGE', '原图无法读取，请从备份恢复后重试。')
  const raw = atob(match[2]); const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0))
  return { mime: match[1].replace('image/jpg', 'image/jpeg'), base64: match[2], bytes }
}
export function requiredCloudAssets(sync?: SyncState): SyncEntity[] {
  if (!sync) return []
  const referenced = new Set(Object.values(sync.entities).filter((entity) => entity.kind === 'question').flatMap((entity) => Array.isArray(entity.payload.images) ? entity.payload.images.map((ref) => String((ref as { assetId: string }).assetId)) : []))
  return Object.values(sync.entities).filter((entity) => entity.kind === 'asset' && !entity.deletedAt && referenced.has(entity.id))
}
export class SyncRunner {
  private running?: Promise<void>
  constructor(private transport: SyncTransport, private storage: Storage) {}
  run() { return this.running ??= this.cycle().finally(() => { this.running = undefined }) }
  private scopedRequest<T>(scope: SyncIdentity, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
    if (method === 'GET') {
      const query = new URLSearchParams({ scope_account: scope.accountId, scope_library: scope.libraryId, scope_environment: scope.environment })
      return this.transport.request(method, `${path}${path.includes('?') ? '&' : '?'}${query}`)
    }
    return this.transport.request(method, path, { ...(body as object), syncScope: scope })
  }
  private async cycle() {
    const start = this.storage.read().sync
    if (!start || start.paused) return
    if (start.retryAt && start.retryAt > Date.now()) return
    const identity = JSON.stringify(start.identity)
    const request: SyncTransport['request'] = (method, path, body) => this.scopedRequest(start.identity, method, path, body)
    const commit = async (build: (notebook: MaybeSyncNotebook) => MaybeSyncNotebook) => this.storage.commit((notebook) => {
      if (JSON.stringify(notebook.sync?.identity) !== identity) throw new CloudError('ACCOUNT_CHANGED', '账号已切换，原账号待同步内容已保留。')
      return build(notebook)
    })
    try {
      if (!this.storage.read().sync!.epoch) await this.initialSnapshot(commit, request)
      // The gateway owns ordering; the durable per-entity queue preserves later edits.
      for (let batch = 0; batch < 200; batch++) {
        const current = this.storage.read()
        if (!current.sync || current.sync.paused) return
        const pending = pendingMutations(current)
        if (!pending.length) break
        const asset = pending.find((op) => op.kind === 'asset')
        if (asset) {
          if (!asset.localDataUrl) throw new CloudError('LOCAL_ASSET_MISSING', '原图尚未下载，无法上传修改。请先下载原图。')
          const data = bytesFromData(asset.localDataUrl)
          const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data.bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
          await commit((notebook) => markMutationsInFlight(notebook, [asset.mutationId]))
          const uploaded = await request<{ id: string; revision: number; payload: SyncEntity['payload'] }>('POST', '/v1/assets/upload', { assetId: asset.entityId, questionId: asset.payload.questionId, name: asset.payload.name, mime: data.mime, dataBase64: data.base64, sha256, width: asset.payload.sourceWidth, height: asset.payload.sourceHeight, editor: asset.payload })
          const canonical = parseEntity({ kind: 'asset', ...uploaded })
          if (canonical.id !== asset.entityId) throw new CloudError('ASSET_RESPONSE_INVALID', '图片确认标识不一致，未标记为已同步。')
          await commit((notebook) => ackMutations(notebook, [{ mutationId: asset.mutationId, status: 'committed', revision: canonical.revision, current: canonical }]))
        } else {
          const mutations = pending.slice(0, 30).map(({ mutationId, entityId, kind, baseRevision, payload, deletedAt }) => ({ mutationId, entityId, kind, baseRevision, payload, ...(deletedAt ? { deletedAt } : {}) }))
          await commit((notebook) => markMutationsInFlight(notebook, mutations.map((op) => op.mutationId)))
          const response = await request<{ results: MutationResult[] }>('POST', '/v1/sync/push', { mutations })
          if (!Array.isArray(response.results) || response.results.length !== mutations.length) throw new CloudError('ACK_INCOMPLETE', '服务尚未确认全部操作，稍后将继续核对。', true)
          await commit((notebook) => ackMutations(notebook, response.results))
          const error = response.results.find((result) => result.status === 'retry' || result.status === 'failed')?.error
          if (error) throw new CloudError(error.code, error.message, error.retryable)
        }
      }
      let sync = this.storage.read().sync!
      for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
        sync = this.storage.read().sync!
        const page = await request<Page>('GET', `/v1/sync/changes?limit=100&epoch=${encodeURIComponent(sync.epoch!)}&cursor=${encodeURIComponent(sync.cursor ?? '0')}`)
        if (page.epoch !== sync.epoch) throw new CloudError('RESET_REQUIRED', '云端索引已变化，需要重新全量校对。')
        await commit((notebook) => { const next = applyRemoteChanges(notebook, page.changes ?? []); next.sync.cursor = String(page.cursor); return next })
        if (!page.hasMore) break
        if (pageNumber === 999) throw new CloudError('SYNC_MORE_PENDING', '仍有内容等待下载，稍后继续。', true)
      }
      await commit((notebook) => ({ ...notebook, sync: { ...notebook.sync!, retryAt: undefined, retryCount: 0, ...(!notebook.sync!.outbox.length && !notebook.sync!.conflicts.length ? { lastSuccess: new Date().toISOString() } : {}) } }))
    } catch (error) {
      if (error instanceof CloudError && error.code === 'RESET_REQUIRED') await commit((notebook) => ({ ...notebook, sync: { ...notebook.sync!, epoch: undefined, cursor: undefined } }))
      if (error instanceof CloudError && error.retryable) await commit((notebook) => {
        const count = Math.min((notebook.sync!.retryCount ?? 0) + 1, 8)
        return { ...notebook, sync: { ...notebook.sync!, retryCount: count, retryAt: Date.now() + Math.max((error.retryAfter ?? 0) * 1000, Math.min(300_000, 1000 * 2 ** count) * (.8 + Math.random() * .4)), ...(count >= 8 ? { paused: true, blocked: { code: error.code, message: `${error.message} 自动重试已暂停，请检查后恢复同步。`, retryable: true } } : {}) } }
      })
      if (error instanceof CloudError && !error.retryable && error.code !== 'RESET_REQUIRED') await commit((notebook) => ({ ...notebook, sync: { ...notebook.sync!, paused: true, blocked: { code: error.code, message: error.message, retryable: false } } }))
      throw error
    }
  }
  private async initialSnapshot(commit: Storage['commit'], request: SyncTransport['request']) {
    let nextPage: string | undefined
    let highwater = '0', epoch = ''
    do {
      const page = await request<Page>('GET', `/v1/sync/snapshot?limit=100${nextPage ? `&page=${encodeURIComponent(nextPage)}&epoch=${encodeURIComponent(epoch)}` : ''}`)
      if (!page.epoch || (epoch && epoch !== page.epoch) || (page.hasMore && !page.nextPage)) throw new CloudError('SNAPSHOT_INVALID', '全量校对尚未完成，请重试。', true)
      epoch = page.epoch; highwater = String(page.cursor)
      await commit((notebook) => applyRemoteChanges(notebook, page.entities ?? page.changes ?? []))
      nextPage = page.hasMore ? page.nextPage! : undefined
    } while (nextPage)
    await commit((notebook) => ({ ...notebook, sync: { ...notebook.sync!, epoch, cursor: highwater } }))
  }
  async downloadAll() {
    const notebook = this.storage.read()
    if (!notebook.sync) return
    for (const entity of requiredCloudAssets(notebook.sync)) {
      if (this.storage.read().sync?.assetCache[entity.id]) continue
      await this.downloadOne(entity.id)
    }
  }
  async downloadOne(assetId: string) {
    const notebook = this.storage.read(), entity = notebook.sync?.entities[`asset:${assetId}`]
    if (!notebook.sync || !entity || entity.kind !== 'asset' || entity.deletedAt) throw new CloudError('ASSET_NOT_FOUND', '当前题库中没有这张原图。')
    if (notebook.sync.assetCache[assetId]) return
    const identity = JSON.stringify(notebook.sync.identity)
    const dataUrl = await this.transport.downloadAsset(assetId)
    const data = bytesFromData(dataUrl)
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data.bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
    if (sha256 !== entity.payload.sha256) throw new CloudError('ATTACHMENT_HASH_MISMATCH', '图片校验失败，未替换本机图片。请重试或从备份恢复。')
    await this.storage.commit((current) => { if (JSON.stringify(current.sync?.identity) !== identity) throw new CloudError('ACCOUNT_CHANGED', '账号已切换，已停止下载。'); return cacheAssetData(current, assetId, dataUrl) })
  }
}
