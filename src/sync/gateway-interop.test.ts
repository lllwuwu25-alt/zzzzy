import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error The production gateway is deliberately native Node ESM, without browser declarations.
import { GatewayDB } from '../../tools/sync-gateway/db.mjs'
// @ts-expect-error The production gateway is deliberately native Node ESM, without browser declarations.
import { SyncService } from '../../tools/sync-gateway/sync.mjs'
import { initialNotebook } from '../data'
import { initialSchedule, scheduleReview } from '../lib/fsrs'
import { parseNotebookBackup } from '../lib/notebook'
import type { ImageAsset, Mistake, Notebook, Rating, Review } from '../types'
import { attachNotebook, prepareLocalCommit, type SyncNotebook } from './model'
import { SyncRunner, type SyncTransport } from './engine'
import { CloudError } from './client'
import type { SyncEntity } from './protocol'

type RemoteRecord = SyncEntity & { lastMutationId: string; contentHash: string; fileToken?: string; recordId?: string }
const closeDatabases: Array<() => void> = []
afterEach(() => { for (const close of closeDatabases.splice(0)) close() })
const stamp = '2026-10-25T01:00:00.000Z'
const pixels = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH0cAAAAASUVORK5CYII='
const original: ImageAsset = { id: 'legacy-image', name: 'original.png', dataUrl: `data:image/png;base64,${pixels}`, rotation: 90, editorVersion: 2, sourceWidth: 1, sourceHeight: 1, crop: { x: 0, y: 0, width: 1, height: 1 }, annotations: [{ id: 'mask-1', tool: 'mask', color: '#fff', width: 2, points: [0, 0, 1, 1], coordinateSpace: 'source' }] }
const mistake = (): Mistake => ({ id: 'legacy-question', status: 'ready', exam: '研究生考试', subject: '数学', chapter: '函数', questionType: 'short-answer', question: '求 1+1', answer: '2', cause: '', note: '', tags: ['代数'], images: [structuredClone(original)], diagrams: [{ imageId: original.id, x: 0, y: 0, width: 100, height: 100, caption: '原图' }], createdAt: stamp, updatedAt: stamp, schedule: initialSchedule(new Date(stamp)) })
const notebook = (): Notebook => ({ ...structuredClone(initialNotebook), items: [mistake()], taxonomy: { exams: [{ name: '研究生考试', subjects: [{ name: '数学', chapters: ['函数'] }] }] }, reviewSettings: { mode: 'custom', intervals: { again: 2, hard: 3, good: 7, easy: 14 } } })

async function fixture() {
  const db = new GatewayDB(':memory:', 'staging')
  closeDatabases.push(() => db.close())
  const records = new Map<string, RemoteRecord>()
  const files = new Map<string, { bytes: Buffer; mime: string }>()
  // Only the remote Bitable/Drive boundary is replaced. SQLite, sync protocol and client runner are production code.
  const provider = {
    async createBase() { return { appToken: 'test-base', url: 'https://example.feishu.cn/base/test-base' } },
    async checkAccess() { return true },
    async checkManagement() { return true },
    async createTable(_library: unknown, kind: string) { return { id: `table-${kind}`, fields: {} } },
    async ensureFields(_library: unknown, _kind: string, mapping: object) { return { ...mapping, fields: { id: 'id', payload: 'payload' } } },
    async findEntity(_library: unknown, kind: string, id: string) { return structuredClone(records.get(`${kind}:${id}`) ?? null) },
    async writeEntity(_library: unknown, entity: RemoteRecord) {
      const committed = { ...structuredClone(entity), recordId: `record-${entity.id}` }
      records.set(`${entity.kind}:${entity.id}`, committed)
      return structuredClone(committed)
    },
    async uploadAsset(_library: unknown, payload: Record<string, unknown>, bytes: Buffer) {
      const fileToken = crypto.randomUUID()
      files.set(fileToken, { bytes: Buffer.from(bytes), mime: String(payload.mime) })
      return { fileToken }
    },
    async downloadAsset(_library: unknown, remote: RemoteRecord) {
      const file = files.get(remote.fileToken!)
      if (!file) throw Error('test remote attachment missing')
      return { bytes: Buffer.from(file.bytes), mime: file.mime }
    },
  }
  const accountId = 'interop-account'
  db.put('accounts', accountId, { id: accountId })
  const service = new SyncService(db, async () => provider)
  const session = (deviceId: string) => ({ accountId, deviceId, status: 'active' })
  for (const id of ['device-a', 'device-b']) db.put('devices', id, { id, accountId, status: 'active' })
  const response = await service.handle('POST', '/v1/libraries/bootstrap', new URL('https://api.test/v1/libraries/bootstrap'), {}, session('device-a'))
  const identity = { environment: 'staging', accountId, libraryId: response.body.id as string }
  function device(id: string, contents: Notebook) {
    const state = { notebook: attachNotebook(contents, identity, id) }
    const transport: SyncTransport = {
      request: async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
        try {
          const result = await service.handle(method, path, new URL(`https://api.test${path}`), body ?? {}, session(id))
          if (!result) throw Error('unhandled gateway route')
          return result.body as T
        } catch (error) {
          const failure = error as Error & { code?: string; retryable?: boolean }
          throw new CloudError(failure.code ?? 'GATEWAY_ERROR', failure.message, Boolean(failure.retryable))
        }
      },
      downloadAsset: async (assetId) => {
        const result = await service.handle('GET', `/v1/assets/${assetId}/content`, new URL(`https://api.test/v1/assets/${assetId}/content`), {}, session(id))
        return `data:${result.headers['Content-Type']};base64,${result.bytes.toString('base64')}`
      },
    }
    const runner = new SyncRunner(transport, { read: () => state.notebook, commit: async (build) => {
      // Exercise the same JSON persistence + backup validation boundary as both real clients.
      state.notebook = parseNotebookBackup(JSON.parse(JSON.stringify(build(state.notebook)))) as SyncNotebook
    } })
    const edit = (build: (current: SyncNotebook) => Notebook) => { state.notebook = prepareLocalCommit(state.notebook, build(state.notebook)) }
    return { state, runner, edit }
  }
  return { db, records, files, device }
}

function addReview(current: SyncNotebook, id: string, rating: Rating): Notebook {
  const item = current.items[0]
  const before = structuredClone(item.schedule)
  const after = scheduleReview(before, rating, new Date(stamp), current.reviewSettings)
  const review: Review = { id, mistakeId: item.id, rating, answerText: '2', reviewedAt: stamp, durationSeconds: 8, before, after }
  return { ...current, items: [{ ...item, schedule: after, updatedAt: stamp }], reviews: [...current.reviews, review] }
}

describe('actual client and gateway protocol interoperability', () => {
  it('uploads original pixels/editor metadata, downloads to an empty second device and syncs a reverse image edit', async () => {
    const f = await fixture()
    const a = f.device('device-a', notebook())
    await a.runner.run()
    expect(a.state.notebook.sync.outbox).toHaveLength(0)
    const firstAsset = Object.values(a.state.notebook.sync.entities).find((entity) => entity.kind === 'asset')!
    const b = f.device('device-b', structuredClone(initialNotebook))
    await b.runner.run(); await b.runner.downloadAll()
    expect(b.state.notebook.items[0].images[0]).toEqual(original)
    expect(b.state.notebook.items[0].diagrams).toEqual(notebook().items[0].diagrams)
    expect(b.state.notebook.reviewSettings).toEqual(notebook().reviewSettings)
    b.edit((current) => ({ ...current, items: [{ ...current.items[0], note: '手机编辑', images: [{ ...current.items[0].images[0], rotation: 180 }] }] }))
    await b.runner.run(); await a.runner.run(); await a.runner.downloadAll()
    expect(a.state.notebook.items[0]).toMatchObject({ note: '手机编辑', images: [{ rotation: 180, dataUrl: original.dataUrl, annotations: original.annotations }] })
    expect(f.records.get(`asset:${firstAsset.id}`)?.payload.rotation).toBe(90)
    expect([...f.records.values()].filter((entity) => entity.kind === 'asset')).toHaveLength(2)
    expect(JSON.stringify(f.db.list('sync_entities'))).not.toContain('手机编辑')
    expect(JSON.stringify(f.db.list('sync_intents'))).not.toContain(pixels)
  })

  it('keeps both offline review facts while retaining divergent schedule versions as a conflict', async () => {
    const f = await fixture()
    const a = f.device('device-a', notebook())
    await a.runner.run()
    const b = f.device('device-b', structuredClone(initialNotebook))
    await b.runner.run()
    a.edit((current) => addReview(current, 'review-a', 'hard'))
    b.edit((current) => addReview(current, 'review-b', 'easy'))
    await a.runner.run(); await b.runner.run(); await a.runner.run()
    expect(a.state.notebook.reviews).toHaveLength(2)
    expect(b.state.notebook.reviews).toHaveLength(2)
    expect(b.state.notebook.sync.conflicts.find((conflict) => conflict.kind === 'question')?.type).toBe('schedule-divergence')
    expect([...f.records.values()].filter((entity) => entity.kind === 'review')).toHaveLength(2)
    expect(b.state.notebook.sync.lastSuccess).toBeDefined() // Prior success remains historical, not a fresh acknowledgment of conflicted data.
    expect(b.state.notebook.sync.outbox.some((op) => op.state === 'conflict')).toBe(true)
  })

  it('synchronizes question tombstones/restores and cancels a review without deleting its original fact', async () => {
    const f = await fixture()
    const a = f.device('device-a', notebook())
    await a.runner.run()
    const b = f.device('device-b', structuredClone(initialNotebook))
    await b.runner.run()
    a.edit((current) => ({ ...current, items: [{ ...current.items[0], status: 'trashed', deletedAt: stamp }] }))
    await a.runner.run(); await b.runner.run()
    expect(b.state.notebook.items[0].status).toBe('trashed')
    b.edit((current) => ({ ...current, items: [{ ...current.items[0], status: 'ready', deletedAt: undefined }] }))
    await b.runner.run(); await a.runner.run()
    expect(a.state.notebook.items[0].status).toBe('ready')
    expect(a.state.notebook.items[0].deletedAt).toBeUndefined()
    const before = structuredClone(a.state.notebook.items[0].schedule)
    a.edit((current) => addReview(current, 'review-undo', 'good'))
    await a.runner.run(); await b.runner.run()
    a.edit((current) => ({ ...current, reviews: [], items: [{ ...current.items[0], schedule: before }] }))
    await a.runner.run(); await b.runner.run()
    expect(b.state.notebook.reviews).toHaveLength(0)
    const retained = [...f.records.values()].find((entity) => entity.kind === 'review')!
    expect(retained.deletedAt).toBeTypeOf('string')
    expect(retained.payload).toMatchObject({ rating: 'good', answerText: '2', before, after: { reps: 1 } })
    expect(f.db.list('sync_review_groups').every((group: { state: string }) => group.state === 'complete')).toBe(true)
  })

  it('reuses cloud config/collection IDs before uploading a nonempty second local notebook', async () => {
    const f = await fixture()
    const a = f.device('device-a', notebook())
    await a.runner.run()
    const configId = a.state.notebook.sync.idMap['config:review-settings']
    const b = f.device('device-b', notebook())
    await b.runner.run()
    expect(b.state.notebook.sync.idMap['config:review-settings']).toBe(configId)
    expect([...f.records.values()].filter((entity) => entity.kind === 'config' && entity.payload.key === 'review-settings')).toHaveLength(1)
    expect([...f.records.values()].filter((entity) => entity.kind === 'collection')).toHaveLength(3)
    expect(b.state.notebook.items).toHaveLength(2) // Similar-looking legacy questions are never silently deduplicated.
    expect(b.state.notebook.sync.outbox).toHaveLength(0)
    expect(b.state.notebook.sync.conflicts).toHaveLength(0)
  })
})
