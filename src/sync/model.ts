import type { ImageAsset, Mistake, Notebook, Review, ReviewSettings } from '../types'
import { initialNotebook } from '../data'
import { entityKey, isRecord, parseEntity, parseMutation, parseMutationResult, parsePayload } from './protocol'
import type { EntityKind, MutationResult, SyncEntity, SyncError, SyncIdentity, SyncMutation, SyncPayload } from './protocol'

export type LocalMutation = SyncMutation & {
  state: 'pending' | 'inflight' | 'retry' | 'failed' | 'conflict'
  localDataUrl?: string
  dependsOn?: string[]
  error?: SyncError
}
export type SyncConflict = {
  id: string
  entityId: string
  kind: EntityKind
  type: 'edit-edit' | 'delete-edit' | 'schedule-divergence'
  local: SyncMutation
  remote: SyncEntity
  createdAt: string
}
export type SyncState = {
  schemaVersion: 1
  identity: SyncIdentity
  deviceId: string
  paused: boolean
  cursor?: string
  epoch?: string
  lastSuccess?: string
  retryAt?: number
  retryCount?: number
  blocked?: SyncError
  idMap: Record<string, string>
  entities: Record<string, SyncEntity>
  outbox: LocalMutation[]
  conflicts: SyncConflict[]
  assetVersions: Record<string, { assetId: string }>
  assetCache: Record<string, string>
}
export type SyncNotebook = Notebook & { sync: SyncState }
export type MaybeSyncNotebook = Notebook & { sync?: SyncState }
type Desired = { kind: EntityKind; id: string; payload: SyncPayload; deletedAt?: string; localDataUrl?: string; dependsOn?: string[] }
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : isRecord(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
const newId = () => crypto.randomUUID()
const stamp = () => new Date().toISOString()
const placeholder = 'data:image/png;base64,'
const imageKeys = ['name', 'rotation', 'crop', 'annotations', 'editorVersion', 'sourceWidth', 'sourceHeight', 'recognizedText', 'recognizedAt'] as const
const questionKeys = ['status', 'exam', 'subject', 'chapter', 'question', 'questionType', 'answer', 'choice', 'fillBlank', 'shortAnswer', 'recognition', 'diagrams', 'cause', 'note', 'tags', 'createdAt', 'updatedAt', 'deletedAt', 'schedule'] as const
const reviewKeys = ['rating', 'answerText', 'reviewedAt', 'durationSeconds', 'before', 'after'] as const
// Local persistence must succeed even if a business record cannot fit a cloud cell.
function localPayload(kind: EntityKind, value: Record<string, unknown>): SyncPayload {
  try { return parsePayload(kind, value) }
  catch { return copy(value) as SyncPayload }
}
function pick(value: object, keys: readonly string[]): Record<string, unknown> {
  const source = value as Record<string, unknown>
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]))
}
function cloudId(sync: SyncState, kind: EntityKind, localId: string): string {
  const key = entityKey(kind, localId)
  return sync.idMap[key] ??= newId()
}
function localId(sync: SyncState, kind: EntityKind, id: string, hint: string): string {
  const existing = Object.entries(sync.idMap).find(([key, value]) => key.startsWith(`${kind}:`) && value === id)?.[0]
  if (existing) return existing.slice(kind.length + 1)
  const preferred = sync.idMap[entityKey(kind, hint)] === undefined ? hint : id
  sync.idMap[entityKey(kind, preferred)] = id
  return preferred
}
function attached(notebook: MaybeSyncNotebook): SyncNotebook {
  if (!notebook.sync) throw new Error('SYNC_NOT_ATTACHED')
  if (notebook.sync.schemaVersion !== 1) throw new Error('UNSUPPORTED_SYNC_SCHEMA')
  return notebook as SyncNotebook
}

export function assertSyncIdentity(notebook: MaybeSyncNotebook, identity: SyncIdentity): void {
  if (!identity || ![identity.environment, identity.accountId, identity.libraryId].every((value) => typeof value === 'string' && value.trim())) throw new Error('INVALID_SYNC_IDENTITY')
  if (notebook.sync && (!same(notebook.sync.identity.environment, identity.environment) || !same(notebook.sync.identity.accountId, identity.accountId) || !same(notebook.sync.identity.libraryId, identity.libraryId))) throw new Error('SYNC_IDENTITY_MISMATCH')
}

/** Callers must persist a complete pre-migration backup before persisting this result. */
export function attachNotebook(notebook: MaybeSyncNotebook, identity: SyncIdentity, deviceId: string): SyncNotebook {
  assertSyncIdentity(notebook, identity)
  if (!deviceId.trim()) throw new Error('INVALID_SYNC_DEVICE')
  if (notebook.sync) {
    if (notebook.sync.schemaVersion !== 1) throw new Error('UNSUPPORTED_SYNC_SCHEMA')
    return { ...copy(notebook), sync: { ...copy(notebook.sync), deviceId } }
  }
  const sync: SyncState = { schemaVersion: 1, identity: copy(identity), deviceId, paused: false, idMap: {}, entities: {}, outbox: [], conflicts: [], assetVersions: {}, assetCache: {} }
  const next: SyncNotebook = { ...copy(notebook), sync }
  const desired = snapshot(next, sync)
  for (const entity of desired) enqueue(sync, entity)
  return next
}

function snapshot(notebook: Notebook, sync: SyncState, previous?: Notebook): Desired[] {
  const desired: Desired[] = []
  for (const item of notebook.items) cloudId(sync, 'question', item.id)
  for (const item of notebook.items) {
    const questionId = cloudId(sync, 'question', item.id)
    const imageRefs: Array<{ id: string; assetId: string }> = []
    item.images.forEach((image, order) => {
      const versionKey = `${item.id}:${image.id}`
      const old = previous?.items.find((entry) => entry.id === item.id)?.images.find((entry) => entry.id === image.id)
      const oldIndex = previous?.items.find((entry) => entry.id === item.id)?.images.findIndex((entry) => entry.id === image.id)
      const previousId = sync.assetVersions[versionKey]?.assetId
      if (!previousId || (old && (!same(old, image) || oldIndex !== order))) sync.assetVersions[versionKey] = { assetId: newId() }
      const assetId = sync.assetVersions[versionKey].assetId
      const baseline = projected(sync, entityKey('asset', assetId))
      const mime = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(image.dataUrl)?.[1]
      const payload = localPayload('asset', { ...(baseline?.payload ?? {}), schemaVersion: 1, ...pick(image, imageKeys), questionId, localImageId: image.id, mime: baseline?.payload.mime ?? mime ?? '', order, status: baseline?.payload.status ?? 'pending', ...(previousId && previousId !== assetId ? { originalAssetId: previousId } : {}) })
      desired.push({ kind: 'asset', id: assetId, payload, localDataUrl: image.dataUrl === placeholder ? undefined : image.dataUrl })
      imageRefs.push({ id: image.id, assetId })
    })
    const source = projected(sync, entityKey('question', questionId))?.payload.sourceQuestionId
    const payload = localPayload('question', { schemaVersion: 1, localId: item.id, ...pick(item, questionKeys), images: imageRefs, ...(source ? { sourceQuestionId: source } : {}) })
    desired.push({ kind: 'question', id: questionId, payload, deletedAt: item.deletedAt, dependsOn: imageRefs.map((ref) => entityKey('asset', ref.assetId)) })
  }
  for (const review of notebook.reviews) {
    const questionId = cloudId(sync, 'question', review.mistakeId)
    const id = cloudId(sync, 'review', review.id)
    const original = projected(sync, entityKey('review', id))?.payload
    desired.push({ kind: 'review', id, payload: localPayload('review', { schemaVersion: 1, localId: review.id, questionId, deviceId: original?.deviceId ?? sync.deviceId, algorithmVersion: 'mistake-fsrs-v1', eventBaseRevision: original?.eventBaseRevision ?? sync.entities[entityKey('question', questionId)]?.revision ?? 0, ...pick(review, reviewKeys) }) })
  }
  notebook.taxonomy.exams.forEach((exam, order) => {
    const examKey = JSON.stringify(['exam', exam.name])
    const examId = cloudId(sync, 'collection', examKey)
    desired.push({ kind: 'collection', id: examId, payload: localPayload('collection', { schemaVersion: 1, localKey: examKey, entityType: 'exam', name: exam.name, order }) })
    exam.subjects.forEach((subject, subjectOrder) => {
      const subjectKey = JSON.stringify(['subject', exam.name, subject.name])
      const subjectId = cloudId(sync, 'collection', subjectKey)
      desired.push({ kind: 'collection', id: subjectId, payload: localPayload('collection', { schemaVersion: 1, localKey: subjectKey, entityType: 'subject', name: subject.name, parentId: examId, order: subjectOrder }) })
      subject.chapters.forEach((chapter, chapterOrder) => {
        const chapterKey = JSON.stringify(['chapter', exam.name, subject.name, chapter])
        desired.push({ kind: 'collection', id: cloudId(sync, 'collection', chapterKey), payload: localPayload('collection', { schemaVersion: 1, localKey: chapterKey, entityType: 'chapter', name: chapter, parentId: subjectId, order: chapterOrder }) })
      })
    })
  })
  if (notebook.items.length || notebook.reviews.length || notebook.taxonomy.exams.length || !same(notebook.reviewSettings, initialNotebook.reviewSettings) || sync.idMap['config:review-settings']) desired.push({ kind: 'config', id: cloudId(sync, 'config', 'review-settings'), payload: localPayload('config', { schemaVersion: 1, key: 'review-settings', reviewSettings: notebook.reviewSettings }) })
  return desired
}

function projected(sync: SyncState, key: string): SyncEntity | LocalMutation | undefined {
  return [...sync.outbox].reverse().find((op) => entityKey(op.kind, op.entityId) === key) ?? sync.entities[key]
}
function enqueue(sync: SyncState, desired: Desired): void {
  const key = entityKey(desired.kind, desired.id)
  const originalReview = desired.kind === 'review' ? sync.entities[key]?.payload ?? sync.outbox.find((op) => op.kind === 'review' && op.entityId === desired.id)?.payload : undefined
  if (desired.kind === 'review' && desired.deletedAt && originalReview) desired = { ...desired, payload: copy(originalReview) }
  const comparable = (payload: SyncPayload, deletedAt?: string) => desired.kind === 'question' && deletedAt ? { ...payload, status: 'trashed', deletedAt } : payload
  const matches = (baseline: ReturnType<typeof projected>) => baseline && same(comparable(baseline.payload, baseline.deletedAt), comparable(desired.payload, desired.deletedAt)) && baseline.deletedAt === desired.deletedAt
  if (matches(projected(sync, key))) return
  // These tasks provably never left the device; correcting their content can safely replace them.
  sync.outbox = sync.outbox.filter((op) => !(entityKey(op.kind, op.entityId) === key && op.state === 'failed' && ['PAYLOAD_TOO_LARGE', 'LOCAL_SYNC_VALIDATION', 'REVIEW_FACT_IMMUTABLE'].includes(op.error?.code ?? '')))
  if (matches(projected(sync, key))) return
  const op: LocalMutation = { mutationId: newId(), entityId: desired.id, kind: desired.kind, baseRevision: sync.entities[key]?.revision ?? 0, payload: copy(desired.payload), state: 'pending', ...(desired.deletedAt ? { deletedAt: desired.deletedAt } : {}), ...(desired.localDataUrl ? { localDataUrl: desired.localDataUrl } : {}), ...(desired.dependsOn?.length ? { dependsOn: [...desired.dependsOn] } : {}) }
  try { parseMutation(op) }
  catch (error) {
    op.state = 'failed'
    op.error = { code: error instanceof Error && error.message === 'SYNC_PAYLOAD_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'LOCAL_SYNC_VALIDATION', message: '内容已保存在本机，但暂时不能上传；请缩小单条记录或修复其格式。', retryable: false }
  }
  if (desired.kind === 'review' && !desired.deletedAt && originalReview && !same(originalReview, desired.payload)) {
    op.state = 'failed'
    op.error = { code: 'REVIEW_FACT_IMMUTABLE', message: '历史复习事实不能覆盖；已保留本机修改，请恢复原记录或另建记录。', retryable: false }
  }
  sync.outbox.push(op)
}

export function prepareLocalCommit(previous: SyncNotebook, next: MaybeSyncNotebook): SyncNotebook
export function prepareLocalCommit(previous: MaybeSyncNotebook, next: MaybeSyncNotebook): MaybeSyncNotebook
export function prepareLocalCommit(previous: MaybeSyncNotebook, next: MaybeSyncNotebook): MaybeSyncNotebook {
  if (!previous.sync) return copy(next)
  if (next.sync) assertSyncIdentity(previous, next.sync.identity)
  const sync = copy(previous.sync)
  const result: SyncNotebook = { ...copy(next), sync }
  const oldDesired = snapshot(previous, copy(sync), previous)
  const desired = snapshot(result, sync, previous)
  const present = new Set(desired.map((entry) => entityKey(entry.kind, entry.id)))
  for (const old of oldDesired) {
    if (old.kind === 'asset' || present.has(entityKey(old.kind, old.id))) continue
    desired.push({ ...old, deletedAt: old.deletedAt ?? stamp() })
    if (old.kind === 'question') {
      const item = previous.items.find((entry) => cloudId(sync, 'question', entry.id) === old.id)
      if (item) result.items.push({ ...copy(item), status: 'trashed', deletedAt: desired[desired.length - 1].deletedAt })
    }
  }
  // Review event creation is a durable stage before publishing derived schedule changes.
  const newlyQueuedReviews: string[] = []
  for (const entry of desired.filter((entity) => entity.kind === 'review')) {
    const before = sync.outbox.length
    enqueue(sync, entry)
    if (sync.outbox.length > before) newlyQueuedReviews.push(entityKey('review', entry.id))
  }
  for (const entry of desired.filter((entity) => entity.kind !== 'review')) {
    if (entry.kind === 'question') entry.dependsOn = [...(entry.dependsOn ?? []), ...newlyQueuedReviews.filter((key) => sync.outbox.some((op) => entityKey(op.kind, op.entityId) === key && op.payload.questionId === entry.id))]
    enqueue(sync, entry)
  }
  return result
}

/** Only the head operation of each entity is eligible; never coalesce unknown in-flight writes. */
export function pendingMutations(notebook: MaybeSyncNotebook): LocalMutation[] {
  const sync = notebook.sync
  if (!sync || sync.paused) return []
  const seen = new Set<string>()
  return sync.outbox.filter((op) => {
    const key = entityKey(op.kind, op.entityId)
    if (seen.has(key)) return false
    seen.add(key)
    if (op.state === 'conflict' || op.state === 'failed' || sync.conflicts.some((conflict) => entityKey(conflict.kind, conflict.entityId) === key)) return false
    return (op.dependsOn ?? []).every((dependency) => sync.entities[dependency] && !sync.outbox.some((pending) => entityKey(pending.kind, pending.entityId) === dependency))
  }).map(copy)
}

export function markMutationsInFlight(notebook: MaybeSyncNotebook, mutationIds: string[]): SyncNotebook {
  const next = copy(attached(notebook))
  const ids = new Set(mutationIds)
  next.sync.outbox = next.sync.outbox.map((op) => ids.has(op.mutationId) ? { ...op, state: 'inflight' } : op)
  return next
}

function addConflict(sync: SyncState, local: LocalMutation, remote: SyncEntity): void {
  const key = entityKey(remote.kind, remote.id)
  sync.outbox = sync.outbox.map((op) => entityKey(op.kind, op.entityId) === key ? { ...op, state: 'conflict' } : op)
  const concurrentReview = remote.kind === 'question' && sync.outbox.some((op) => op.kind === 'review' && !op.deletedAt && op.payload.questionId === remote.id)
  const type = remote.deletedAt !== local.deletedAt && (remote.deletedAt || local.deletedAt) ? 'delete-edit' : remote.kind === 'question' && (concurrentReview || !same(remote.payload.schedule, local.payload.schedule)) ? 'schedule-divergence' : 'edit-edit'
  const existing = sync.conflicts.findIndex((entry) => entityKey(entry.kind, entry.entityId) === key)
  const conflict: SyncConflict = { id: existing < 0 ? newId() : sync.conflicts[existing].id, entityId: remote.id, kind: remote.kind, type, local: parseMutation(local, Infinity), remote: copy(remote), createdAt: stamp() }
  if (existing < 0) sync.conflicts.push(conflict)
  else sync.conflicts[existing] = conflict
}

export function ackMutations(notebook: MaybeSyncNotebook, results: MutationResult[]): SyncNotebook {
  const parsed = results.map(parseMutationResult)
  const next = copy(attached(notebook))
  for (const result of parsed) {
    const op = next.sync.outbox.find((entry) => entry.mutationId === result.mutationId)
    if (!op) continue
    const key = entityKey(op.kind, op.entityId)
    if (next.sync.outbox.find((entry) => entityKey(entry.kind, entry.entityId) === key)?.mutationId !== op.mutationId) continue
    if (result.status === 'committed') {
      const revision = result.revision!
      if (revision <= op.baseRevision) throw new Error('INVALID_ACK_REVISION')
      const baseline = next.sync.entities[key]
      if (result.current && (result.current.id !== op.entityId || result.current.kind !== op.kind || result.current.revision !== revision)) throw new Error('INVALID_ACK_ENTITY')
      if (!baseline || revision >= baseline.revision) next.sync.entities[key] = result.current ? copy(result.current) : { kind: op.kind, id: op.entityId, revision, payload: copy(op.payload), ...(op.deletedAt ? { deletedAt: op.deletedAt } : {}) }
      if (op.kind === 'asset' && op.localDataUrl) next.sync.assetCache[op.entityId] = op.localDataUrl
      next.sync.outbox = next.sync.outbox.filter((entry) => entry.mutationId !== op.mutationId)
      next.sync.outbox = next.sync.outbox.map((entry) => entityKey(entry.kind, entry.entityId) === key && entry.state !== 'inflight' ? { ...entry, baseRevision: revision } : entry)
    } else if (result.status === 'conflict' && result.current) {
      if (result.current.kind !== op.kind || result.current.id !== op.entityId) throw new Error('INVALID_CONFLICT_ENTITY')
      addConflict(next.sync, op, result.current)
      next.sync.entities[key] = copy(result.current)
    } else {
      op.state = result.status === 'retry' ? 'retry' : result.status === 'conflict' ? 'conflict' : 'failed'
      op.error = result.error
    }
  }
  if (!next.sync.outbox.some((op) => op.kind === 'collection') && !next.sync.conflicts.some((entry) => entry.kind === 'collection')) rebuildTaxonomy(next)
  return next
}

function imageFromAsset(sync: SyncState, ref: { id: string; assetId: string }, current?: ImageAsset): ImageAsset {
  const asset = sync.entities[entityKey('asset', ref.assetId)]
  if (!asset) throw new Error('ATTACHMENT_PENDING')
  const pendingData = sync.outbox.find((op) => op.kind === 'asset' && op.entityId === ref.assetId)?.localDataUrl
  return { ...pick(asset.payload, imageKeys), id: ref.id, dataUrl: sync.assetCache[ref.assetId] ?? pendingData ?? current?.dataUrl ?? placeholder } as ImageAsset
}

function rebuildTaxonomy(notebook: SyncNotebook): void {
  const entities = Object.values(notebook.sync.entities).filter((entry) => entry.kind === 'collection' && !entry.deletedAt).sort((a, b) => Number(a.payload.order) - Number(b.payload.order) || a.id.localeCompare(b.id))
  notebook.taxonomy = { exams: entities.filter((entry) => entry.payload.entityType === 'exam').map((exam) => ({ name: String(exam.payload.name), subjects: entities.filter((entry) => entry.payload.entityType === 'subject' && entry.payload.parentId === exam.id).map((subject) => ({ name: String(subject.payload.name), chapters: entities.filter((entry) => entry.payload.entityType === 'chapter' && entry.payload.parentId === subject.id).map((entry) => String(entry.payload.name)) })) })) }
}

function materializeQuestions(notebook: SyncNotebook): void {
  for (const remote of Object.values(notebook.sync.entities).filter((entry) => entry.kind === 'question')) {
    const key = entityKey('question', remote.id)
    if (notebook.sync.outbox.some((op) => entityKey(op.kind, op.entityId) === key) || notebook.sync.conflicts.some((entry) => entityKey(entry.kind, entry.entityId) === key)) continue
    const refs = remote.payload.images as Array<{ id: string; assetId: string }>
    if (refs.some((ref) => notebook.sync.entities[entityKey('asset', ref.assetId)]?.payload.status !== 'ready')) continue
    const id = localId(notebook.sync, 'question', remote.id, String(remote.payload.localId))
    const existing = notebook.items.find((item) => item.id === id)
    const images = refs.map((ref) => {
      const oldId = notebook.sync.assetVersions[`${id}:${ref.id}`]?.assetId
      const image = imageFromAsset(notebook.sync, ref, oldId === ref.assetId ? existing?.images.find((entry) => entry.id === ref.id) : undefined)
      notebook.sync.assetVersions[`${id}:${ref.id}`] = { assetId: ref.assetId }
      return image
    })
    const item = { ...pick(remote.payload, questionKeys), id, images, ...(remote.deletedAt ? { status: 'trashed', deletedAt: remote.deletedAt } : {}) } as Mistake
    notebook.items = existing ? notebook.items.map((entry) => entry.id === id ? item : entry) : [...notebook.items, item]
  }
}

/** Initial merge may align logically identical settings/taxonomy, but never rewrite an unknown submitted operation. */
function alignInitialLogicalIds(sync: SyncState, remoteEntities: SyncEntity[]): void {
  if (sync.epoch) return
  const remap = new Map<string, string>()
  const candidates: Array<{ kind: 'collection' | 'config'; hint: string; id: string }> = []
  for (const remote of remoteEntities) {
    if (remote.deletedAt || (remote.kind !== 'collection' && remote.kind !== 'config')) continue
    candidates.push({ kind: remote.kind, hint: remote.kind === 'collection' ? String(remote.payload.localKey) : 'review-settings', id: remote.id })
    // A child carries its parent UUID even when the parent's snapshot page has not arrived yet.
    if (remote.kind === 'collection' && typeof remote.payload.parentId === 'string') {
      try {
        const path: unknown = JSON.parse(String(remote.payload.localKey))
        if (Array.isArray(path) && path.every((part) => typeof part === 'string')) {
          if (remote.payload.entityType === 'subject' && path.length === 3 && path[0] === 'subject') candidates.push({ kind: 'collection', hint: JSON.stringify(['exam', path[1]]), id: remote.payload.parentId })
          if (remote.payload.entityType === 'chapter' && path.length === 4 && path[0] === 'chapter') candidates.push({ kind: 'collection', hint: JSON.stringify(['subject', path[1], path[2]]), id: remote.payload.parentId })
        }
      } catch { /* Unknown logical keys remain separate; never guess identity from a display name. */ }
    }
  }
  for (const candidate of candidates) {
    const mapKey = entityKey(candidate.kind, candidate.hint)
    const oldId = sync.idMap[mapKey]
    if (!oldId || oldId === candidate.id || sync.entities[entityKey(candidate.kind, oldId)]) continue
    const pending = sync.outbox.filter((op) => op.kind === candidate.kind && op.entityId === oldId)
    if (!pending.length || pending.some((op) => op.state !== 'pending') || sync.outbox.some((op) => op.state !== 'pending' && op.payload.parentId === oldId)) continue
    remap.set(oldId, candidate.id)
    sync.idMap[mapKey] = candidate.id
    for (const op of pending) op.entityId = candidate.id
  }
  for (const op of sync.outbox) {
    if (op.state !== 'pending') continue
    if (typeof op.payload.parentId === 'string' && remap.has(op.payload.parentId)) op.payload.parentId = remap.get(op.payload.parentId)!
    if (op.dependsOn) op.dependsOn = op.dependsOn.map((key) => {
      const split = key.indexOf(':')
      return remap.has(key.slice(split + 1)) ? `${key.slice(0, split)}:${remap.get(key.slice(split + 1))}` : key
    })
  }
  for (const remote of remoteEntities) {
    if (remote.kind !== 'collection' && remote.kind !== 'config') continue
    const key = entityKey(remote.kind, remote.id)
    const pending = [...sync.outbox].reverse().find((op) => entityKey(op.kind, op.entityId) === key)
    if (pending && pending.state === 'pending' && same(pending.payload, remote.payload) && pending.deletedAt === remote.deletedAt && sync.outbox.filter((op) => entityKey(op.kind, op.entityId) === key).every((op) => op.state === 'pending')) sync.outbox = sync.outbox.filter((op) => entityKey(op.kind, op.entityId) !== key)
  }
}

/** Snapshot absence never implies deletion. The caller validates identity/epoch before applying. */
export function applyRemoteChanges(notebook: MaybeSyncNotebook, entities: SyncEntity[]): SyncNotebook {
  const parsed = entities.map(parseEntity)
  const next = copy(attached(notebook))
  alignInitialLogicalIds(next.sync, parsed)
  const order: EntityKind[] = ['asset', 'collection', 'question', 'review', 'config']
  for (const remote of parsed.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))) {
    const key = entityKey(remote.kind, remote.id)
    const baseline = next.sync.entities[key]
    if (baseline && baseline.revision >= remote.revision) continue
    const pending = [...next.sync.outbox].reverse().find((op) => entityKey(op.kind, op.entityId) === key)
    if (pending) {
      addConflict(next.sync, pending, remote)
      next.sync.entities[key] = remote
      continue
    }
    next.sync.entities[key] = remote
    if (remote.kind === 'question') {
      localId(next.sync, 'question', remote.id, String(remote.payload.localId))
    } else if (remote.kind === 'review') {
      const id = localId(next.sync, 'review', remote.id, String(remote.payload.localId))
      const question = localId(next.sync, 'question', String(remote.payload.questionId), String(remote.payload.questionId))
      if (remote.deletedAt) next.reviews = next.reviews.filter((entry) => entry.id !== id)
      else {
        const review = { ...pick(remote.payload, reviewKeys), id, mistakeId: question } as Review
        const existing = next.reviews.find((entry) => entry.id === id)
        if (!existing) next.reviews.push(review)
        else if (!same(existing, review)) {
          const local: LocalMutation = { kind: 'review', mutationId: newId(), entityId: remote.id, baseRevision: baseline?.revision ?? 0, payload: parsePayload('review', { ...remote.payload, ...pick(existing, reviewKeys) }), state: 'conflict' }
          addConflict(next.sync, local, remote)
        }
      }
    } else if (remote.kind === 'config' && !remote.deletedAt) next.reviewSettings = copy(remote.payload.reviewSettings) as ReviewSettings
    if (remote.kind === 'collection') {
      localId(next.sync, 'collection', remote.id, String(remote.payload.localKey))
      if (!next.sync.outbox.some((op) => op.kind === 'collection')) rebuildTaxonomy(next)
    }
    if (remote.kind === 'config') localId(next.sync, 'config', remote.id, 'review-settings')
  }
  materializeQuestions(next)
  next.reviews.sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt) || (next.sync.idMap[entityKey('review', a.id)] ?? a.id).localeCompare(next.sync.idMap[entityKey('review', b.id)] ?? b.id))
  return next
}

/** Byte download/cache changes are not business edits and must not create an outbox item. */
export function cacheAssetData(notebook: MaybeSyncNotebook, assetId: string, dataUrl: string): SyncNotebook {
  const source = attached(notebook)
  if (!/^data:image\/(png|jpe?g|webp|gif|bmp);base64,/i.test(dataUrl) || !source.sync.entities[entityKey('asset', assetId)]) throw new Error('INVALID_ASSET_CACHE')
  const next = copy(source)
  next.sync.assetCache[assetId] = dataUrl
  for (const item of next.items) item.images = item.images.map((image) => next.sync.assetVersions[`${item.id}:${image.id}`]?.assetId === assetId ? { ...image, dataUrl } : image)
  return next
}

/** The upload endpoint commits the asset itself; never send the same asset through /push. */
export function acceptUploadedAsset(notebook: MaybeSyncNotebook, mutationId: string, uploaded: { id: string; revision: number; payload: SyncPayload }): SyncNotebook {
  const source = attached(notebook)
  const op = source.sync.outbox.find((entry) => entry.mutationId === mutationId)
  if (!op) return copy(source)
  if (op.kind !== 'asset' || op.entityId !== uploaded.id) throw new Error('INVALID_ASSET_ACK')
  const current = parseEntity({ ...uploaded, kind: 'asset' })
  if (current.payload.status !== 'ready' || current.payload.questionId !== op.payload.questionId || current.payload.localImageId !== op.payload.localImageId) throw new Error('INVALID_ASSET_ACK')
  return ackMutations(notebook, [{ mutationId, status: 'committed', revision: current.revision, current }])
}

export function resolveConflict(notebook: MaybeSyncNotebook, conflictId: string, choice: 'local' | 'remote' | 'both'): SyncNotebook {
  const next = copy(attached(notebook))
  const conflict = next.sync.conflicts.find((entry) => entry.id === conflictId)
  if (!conflict) throw new Error('SYNC_CONFLICT_NOT_FOUND')
  if (choice === 'both' && conflict.kind !== 'question') throw new Error('KEEP_BOTH_QUESTIONS_ONLY')
  const key = entityKey(conflict.kind, conflict.entityId)
  const latest = [...next.sync.outbox].reverse().find((op) => entityKey(op.kind, op.entityId) === key)
  next.sync.outbox = next.sync.outbox.filter((op) => entityKey(op.kind, op.entityId) !== key)
  next.sync.conflicts = next.sync.conflicts.filter((entry) => entry.id !== conflictId)
  if (choice === 'local') {
    const local = latest ?? { ...conflict.local, state: 'conflict' as const }
    const replacement: LocalMutation = { ...local, mutationId: newId(), baseRevision: conflict.remote.revision, state: 'pending' }
    delete replacement.error
    try { parseMutation(replacement) }
    catch { replacement.state = 'failed'; replacement.error = { code: 'LOCAL_SYNC_VALIDATION', message: '本机版本已保留，但内容仍需调整后才能上传。', retryable: false } }
    next.sync.outbox.push(replacement)
    return next
  }
  const itemId = Object.entries(next.sync.idMap).find(([mapKey, id]) => mapKey.startsWith('question:') && id === conflict.entityId)?.[0].slice('question:'.length)
  const localItem = conflict.kind === 'question' ? next.items.find((item) => item.id === itemId) : undefined
  // Reapply the chosen server version despite its revision already being known for conflict checking.
  delete next.sync.entities[key]
  const adopted = applyRemoteChanges(next, [conflict.remote])
  if (choice === 'remote' || !localItem) return adopted
  const duplicate = { ...copy(localItem), id: newId() }
  const result = prepareLocalCommit(adopted, { ...adopted, items: [...adopted.items, duplicate] })
  const newQuestionId = result.sync.idMap[entityKey('question', duplicate.id)]
  for (const op of result.sync.outbox) if (op.kind === 'question' && op.entityId === newQuestionId) op.payload.sourceQuestionId = conflict.entityId
  return result
}

/** Validate untrusted local persistence without accidentally accepting newer sync schemas. */
export function validateSyncState(value: unknown): SyncState {
  const invalid = (): never => { throw new Error('INVALID_SYNC_STATE') }
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.identity) || typeof value.deviceId !== 'string' || !value.deviceId || typeof value.paused !== 'boolean') invalid()
  const state = value as unknown as SyncState
  if (state.blocked !== undefined && (!isRecord(state.blocked) || typeof state.blocked.code !== 'string' || typeof state.blocked.message !== 'string' || typeof state.blocked.retryable !== 'boolean')) invalid()
  assertSyncIdentity(initialNotebook, state.identity)
  const uuid = (id: unknown) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  const key = (id: unknown) => typeof id === 'string' && /^(question|review|collection|config|asset):[0-9a-f-]{36}$/i.test(id)
  if (!isRecord(state.idMap) || !isRecord(state.entities) || !isRecord(state.assetVersions) || !isRecord(state.assetCache) || !Array.isArray(state.outbox) || !Array.isArray(state.conflicts)) invalid()
  for (const [mapKey, id] of Object.entries(state.idMap)) if (!/^(question|review|collection|config|asset):/.test(mapKey) || !uuid(id)) invalid()
  for (const [mapKey, entity] of Object.entries(state.entities)) {
    const parsed = parseEntity(entity)
    if (mapKey !== entityKey(parsed.kind, parsed.id)) invalid()
  }
  const mutationIds = new Set<string>()
  for (const op of state.outbox) {
    if (!isRecord(op) || !['pending', 'inflight', 'retry', 'failed', 'conflict'].includes(String(op.state))) invalid()
    parseMutation(op, op.state === 'failed' && ['PAYLOAD_TOO_LARGE', 'LOCAL_SYNC_VALIDATION'].includes(op.error?.code ?? '') ? Infinity : undefined)
    if (mutationIds.has(op.mutationId)) invalid()
    mutationIds.add(op.mutationId)
    if (op.localDataUrl !== undefined && (op.kind !== 'asset' || typeof op.localDataUrl !== 'string' || !/^data:image\/(png|jpe?g|webp|gif|bmp);base64,/i.test(op.localDataUrl))) invalid()
    if (op.dependsOn !== undefined && (!Array.isArray(op.dependsOn) || !op.dependsOn.every(key))) invalid()
    if (op.error !== undefined && (!isRecord(op.error) || typeof op.error.code !== 'string' || typeof op.error.message !== 'string' || typeof op.error.retryable !== 'boolean')) invalid()
  }
  for (const version of Object.values(state.assetVersions)) if (!isRecord(version) || !uuid(version.assetId)) invalid()
  for (const [assetId, dataUrl] of Object.entries(state.assetCache)) if (!uuid(assetId) || typeof dataUrl !== 'string' || !/^data:image\/(png|jpe?g|webp|gif|bmp);base64,/i.test(dataUrl)) invalid()
  for (const conflict of state.conflicts) {
    if (!isRecord(conflict) || !uuid(conflict.id) || !['edit-edit', 'delete-edit', 'schedule-divergence'].includes(String(conflict.type)) || typeof conflict.createdAt !== 'string' || !Number.isFinite(Date.parse(conflict.createdAt))) invalid()
    const local = parseMutation(conflict.local, Infinity)
    const remote = parseEntity(conflict.remote)
    if (local.entityId !== remote.id || local.kind !== remote.kind || conflict.entityId !== remote.id || conflict.kind !== remote.kind) invalid()
  }
  if ((state.cursor !== undefined && typeof state.cursor !== 'string') || (state.epoch !== undefined && typeof state.epoch !== 'string') || (state.lastSuccess !== undefined && !Number.isFinite(Date.parse(state.lastSuccess))) || (state.retryAt !== undefined && (!Number.isFinite(state.retryAt) || state.retryAt < 0)) || (state.retryCount !== undefined && (!Number.isSafeInteger(state.retryCount) || state.retryCount < 0))) invalid()
  return copy(state)
}
