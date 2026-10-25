import { describe, expect, it } from 'vitest'
import { initialNotebook } from '../data'
import type { ImageAsset, Mistake, Notebook, Review } from '../types'
import { initialSchedule, scheduleReview } from '../lib/fsrs'
import { acceptUploadedAsset, ackMutations, applyRemoteChanges, assertSyncIdentity, attachNotebook, cacheAssetData, pendingMutations, prepareLocalCommit, resolveConflict, validateSyncState } from './model'
import { parseEntity, parseMutation } from './protocol'

const identity = { environment: 'staging', accountId: 'account-a', libraryId: 'library-a' }
const stamp = '2026-10-25T01:00:00.000Z'
const image: ImageAsset = { id: 'img-legacy', name: 'original.png', dataUrl: 'data:image/png;base64,aGVsbG8=', rotation: 90, crop: { x: 1, y: 2, width: 30, height: 40 }, editorVersion: 2, sourceWidth: 800, sourceHeight: 600, annotations: [{ id: 'mask-1', tool: 'mask', color: '#fff', width: 2, points: [1, 2, 3, 4], coordinateSpace: 'source' }] }
const question = (): Mistake => ({ id: 'item-legacy', status: 'ready', exam: '考试', subject: '数学', chapter: '函数', question: '1+1?', questionType: 'short-answer', answer: '2', cause: '', note: '', tags: [], images: [structuredClone(image)], diagrams: [{ imageId: image.id, x: 0, y: 0, width: 100, height: 100, caption: '图' }], createdAt: stamp, updatedAt: stamp, schedule: initialSchedule(new Date(stamp)) })
const fixture = (): Notebook => ({ ...structuredClone(initialNotebook), items: [question()], workspacePath: '/Users/private', reviewSettings: { mode: 'custom', intervals: { again: 3, hard: 6, good: 12, easy: 18 } }, taxonomy: { exams: [{ name: '考试', subjects: [{ name: '数学', chapters: ['函数'] }] }] } })
function confirmAll(notebook: ReturnType<typeof attachNotebook>) {
  let next = notebook
  for (let i = 0; i < 10 && next.sync.outbox.length; i++) {
    const ops = pendingMutations(next)
    if (!ops.length) break
    for (const op of ops.filter((entry) => entry.kind === 'asset')) next = acceptUploadedAsset(next, op.mutationId, { id: op.entityId, revision: 1, payload: { ...op.payload, status: 'ready', size: 5, sha256: 'a'.repeat(64) } })
    next = ackMutations(next, ops.filter((op) => op.kind !== 'asset').map((op) => ({ mutationId: op.mutationId, status: 'committed', revision: op.baseRevision + 1 })))
  }
  return next
}

describe('sync identity and immutable assets', () => {
  it('assigns durable cloud UUIDs without changing editor or review local IDs', () => {
    const attached = attachNotebook(fixture(), identity, 'device-a')
    const restarted = attachNotebook(JSON.parse(JSON.stringify(attached)), identity, 'device-a')
    expect(restarted.sync.idMap['question:item-legacy']).toMatch(/^[0-9a-f-]{36}$/)
    expect(restarted.sync.idMap).toEqual(attached.sync.idMap)
    expect(restarted.items[0]).toEqual(fixture().items[0])
    expect(restarted.sync.outbox.filter((op) => op.kind === 'question')).toHaveLength(1)
    expect(JSON.stringify(restarted.sync.outbox.filter((op) => op.kind !== 'asset'))).not.toContain('data:image')
    expect(JSON.stringify(restarted.sync.outbox)).not.toContain('/Users/private')
    expect(restarted.sync.outbox.find((op) => op.kind === 'config')?.payload).toMatchObject({ reviewSettings: { mode: 'custom', intervals: { good: 12 } } })
  })

  it('round trips original pixels, crop, rotation, source annotations and diagrams on a new device', () => {
    const synced = confirmAll(attachNotebook(fixture(), identity, 'device-a'))
    let empty = attachNotebook({ ...structuredClone(initialNotebook), items: [] }, identity, 'device-b')
    empty = { ...empty, sync: { ...empty.sync, outbox: [] } }
    let downloaded = applyRemoteChanges(empty, Object.values(synced.sync.entities))
    const asset = Object.values(synced.sync.entities).find((entity) => entity.kind === 'asset')!
    downloaded = cacheAssetData(downloaded, asset.id, image.dataUrl)
    expect(downloaded.items[0].images[0]).toEqual(image)
    expect(downloaded.items[0].diagrams?.[0].imageId).toBe('img-legacy')
    expect(downloaded.reviewSettings.intervals.good).toBe(12)
  })

  it('defers question publication until an asset in a later snapshot page becomes available', () => {
    const synced = confirmAll(attachNotebook(fixture(), identity, 'device-a'))
    const empty = attachNotebook(structuredClone(initialNotebook), identity, 'device-b')
    const q = Object.values(synced.sync.entities).find((entry) => entry.kind === 'question')!
    const asset = Object.values(synced.sync.entities).find((entry) => entry.kind === 'asset')!
    const firstPage = applyRemoteChanges(empty, [q])
    expect(firstPage.items).toHaveLength(0)
    expect(firstPage.sync.entities[`question:${q.id}`]).toBeDefined()
    const secondPage = applyRemoteChanges(firstPage, [asset])
    expect(secondPage.items[0].question).toBe('1+1?')
    expect(secondPage.items[0].images[0].rotation).toBe(90)
  })

  it('reconciles logical collection IDs and preserves differing first-sync settings as one conflict', () => {
    const cloud = confirmAll(attachNotebook(fixture(), identity, 'device-a'))
    const local = attachNotebook({ ...fixture(), reviewSettings: { mode: 'custom', intervals: { again: 1, hard: 2, good: 5, easy: 9 } } }, identity, 'device-b')
    const remoteConfig = Object.values(cloud.sync.entities).find((entry) => entry.kind === 'config')!
    const merged = applyRemoteChanges(local, Object.values(cloud.sync.entities).filter((entry) => ['collection', 'config'].includes(entry.kind)))
    expect(merged.sync.idMap['config:review-settings']).toBe(remoteConfig.id)
    expect(merged.sync.outbox.filter((op) => op.kind === 'config')).toHaveLength(1)
    expect(merged.sync.outbox.find((op) => op.kind === 'config')?.entityId).toBe(remoteConfig.id)
    expect(merged.sync.conflicts.find((entry) => entry.kind === 'config')).toMatchObject({ local: { payload: { reviewSettings: { intervals: { good: 5 } } } }, remote: { payload: { reviewSettings: { intervals: { good: 12 } } } } })
    expect(merged.sync.outbox.filter((op) => op.kind === 'collection')).toHaveLength(0)
    expect(new Set(merged.sync.outbox.map((op) => op.mutationId)).size).toBe(merged.sync.outbox.length)
  })

  it('reconciles a subject before its parent exam arrives in a later snapshot page', () => {
    const cloud = confirmAll(attachNotebook(fixture(), identity, 'device-a'))
    const local = attachNotebook(fixture(), identity, 'device-b')
    const taxonomy = Object.values(cloud.sync.entities).filter((entry) => entry.kind === 'collection')
    const subject = taxonomy.find((entry) => entry.payload.entityType === 'subject')!
    const first = applyRemoteChanges(local, [subject])
    const merged = applyRemoteChanges(first, taxonomy.filter((entry) => entry.id !== subject.id))
    expect(merged.sync.conflicts).toHaveLength(0)
    expect(merged.sync.outbox.filter((op) => op.kind === 'collection')).toHaveLength(0)
    expect(merged.taxonomy).toEqual(fixture().taxonomy)
  })

  it('retains independent local and remote taxonomy additions once local uploads are acknowledged', () => {
    const cloudFixture = fixture(); cloudFixture.taxonomy.exams.push({ name: '云端考试', subjects: [] })
    const localFixture = fixture(); localFixture.taxonomy.exams.push({ name: '本机考试', subjects: [] })
    const cloud = confirmAll(attachNotebook(cloudFixture, identity, 'device-a'))
    const local = attachNotebook(localFixture, identity, 'device-b')
    const merged = confirmAll(applyRemoteChanges(local, Object.values(cloud.sync.entities).filter((entry) => entry.kind === 'collection')))
    expect(merged.taxonomy.exams.map((exam) => exam.name).sort()).toEqual(['云端考试', '本机考试', '考试'])
  })

  it('versions an edited image instead of modifying an asset already referenced by a question', () => {
    const synced = confirmAll(attachNotebook(fixture(), identity, 'device-a'))
    const oldAssetId = synced.sync.assetVersions['item-legacy:img-legacy'].assetId
    const next = prepareLocalCommit(synced, { ...synced, items: [{ ...synced.items[0], images: [{ ...image, rotation: 180 }] }] })
    expect(next.sync.assetVersions['item-legacy:img-legacy'].assetId).not.toBe(oldAssetId)
    expect(next.sync.entities[`asset:${oldAssetId}`]).toBeDefined()
    expect(pendingMutations(next).some((op) => op.kind === 'question')).toBe(false)
    expect(next.items[0].images[0].dataUrl).toBe(image.dataUrl)
  })

  it('accepts a committed asset upload before publishing the question without leaking server tokens', () => {
    const attached = attachNotebook(fixture(), identity, 'device-a')
    const op = pendingMutations(attached).find((entry) => entry.kind === 'asset')!
    const uploaded = acceptUploadedAsset(attached, op.mutationId, { id: op.entityId, revision: 1, payload: { ...op.payload, status: 'ready', sha256: 'a'.repeat(64), size: 5 } })
    expect(uploaded.sync.entities[`asset:${op.entityId}`].payload.status).toBe('ready')
    expect(uploaded.sync.outbox.some((entry) => entry.mutationId === op.mutationId)).toBe(false)
    expect(pendingMutations(uploaded).some((entry) => entry.kind === 'question')).toBe(true)
    expect(() => acceptUploadedAsset(attached, op.mutationId, { id: crypto.randomUUID(), revision: 1, payload: op.payload })).toThrow()
  })

  it('rejects account, environment and library changes without discarding pending data', () => {
    const attached = attachNotebook(fixture(), identity, 'device-a')
    for (const other of [{ ...identity, accountId: 'b' }, { ...identity, libraryId: 'b' }, { ...identity, environment: 'production' }]) {
      expect(() => attachNotebook(attached, other, 'device-b')).toThrow('SYNC_IDENTITY_MISMATCH')
      expect(() => assertSyncIdentity(attached, other)).toThrow('SYNC_IDENTITY_MISMATCH')
    }
  })
})

describe('durable mutation ordering and conflict safety', () => {
  it('does not rewrite historical review metadata when question revisions advance', () => {
    const synced = confirmAll(attachNotebook(fixture(), identity, 'device-a'))
    const before = synced.items[0].schedule
    const review: Review = { id: 'review-historical', mistakeId: 'item-legacy', rating: 'good', answerText: '2', reviewedAt: stamp, durationSeconds: 4, before, after: scheduleReview(before, 'good', new Date(stamp)) }
    const rated = confirmAll(prepareLocalCommit(synced, { ...synced, reviews: [review], items: [{ ...synced.items[0], schedule: review.after }] }))
    const edit = prepareLocalCommit(rated, { ...rated, items: [{ ...rated.items[0], note: 'later note' }] })
    expect(edit.sync.outbox.filter((op) => op.kind === 'review')).toHaveLength(0)
  })

  it('keeps an oversized local edit saved and diagnoses its unsendable task', () => {
    const synced = confirmAll(attachNotebook(fixture(), identity, 'device-a'))
    const next = prepareLocalCommit(synced, { ...synced, items: [{ ...synced.items[0], question: 'a'.repeat(20_000) }] })
    expect(next.items[0].question).toHaveLength(20_000)
    expect(next.sync.outbox.find((op) => op.kind === 'question')).toMatchObject({ state: 'failed', error: { retryable: false } })
    expect(pendingMutations(next).filter((op) => op.kind === 'question')).toHaveLength(0)
    const repaired = prepareLocalCommit(next, { ...next, items: [{ ...next.items[0], question: 'short enough' }] })
    expect(pendingMutations(repaired).find((op) => op.kind === 'question')?.payload.question).toBe('short enough')
  })

  it('rejects changes to an existing review fact while keeping the edited local copy recoverable', () => {
    const synced = confirmAll(attachNotebook(fixture(), identity, 'device-a'))
    const before = synced.items[0].schedule
    const review: Review = { id: 'review-immutable', mistakeId: 'item-legacy', rating: 'good', answerText: '2', reviewedAt: stamp, durationSeconds: 4, before, after: scheduleReview(before, 'good', new Date(stamp)) }
    const rated = confirmAll(prepareLocalCommit(synced, { ...synced, reviews: [review] }))
    const changed = prepareLocalCommit(rated, { ...rated, reviews: [{ ...review, answerText: 'modified historical fact' }] })
    expect(changed.reviews[0].answerText).toBe('modified historical fact')
    expect(changed.sync.outbox.find((op) => op.kind === 'review')).toMatchObject({ state: 'failed', error: { code: 'REVIEW_FACT_IMMUTABLE' } })
    expect(pendingMutations(changed).filter((op) => op.kind === 'review')).toHaveLength(0)
  })

  it('does not enqueue an extra immutable asset mutation after editing again before upload finishes', () => {
    const synced = confirmAll(attachNotebook(fixture(), identity, 'device-a'))
    const a = prepareLocalCommit(synced, { ...synced, items: [{ ...synced.items[0], images: [{ ...image, rotation: 180 }] }] })
    const b = prepareLocalCommit(a, { ...a, items: [{ ...a.items[0], note: 'new note' }] })
    expect(b.sync.outbox.filter((op) => op.kind === 'asset')).toHaveLength(1)
  })

  it('does not let an old acknowledgment clear a newer local edit and advances its base revision', () => {
    const synced = confirmAll(attachNotebook(fixture(), identity, 'device-a'))
    const a = prepareLocalCommit(synced, { ...synced, items: [{ ...synced.items[0], question: 'first edit' }] })
    const first = pendingMutations(a).find((op) => op.kind === 'question')!
    const b = prepareLocalCommit(a, { ...a, items: [{ ...a.items[0], question: 'second edit' }] })
    const acked = ackMutations(b, [{ mutationId: first.mutationId, status: 'committed', revision: 2 }])
    expect(acked.items[0].question).toBe('second edit')
    expect(acked.sync.outbox.filter((op) => op.kind === 'question')).toHaveLength(1)
    expect(pendingMutations(acked).find((op) => op.kind === 'question')?.baseRevision).toBe(2)
    expect(ackMutations(acked, [{ mutationId: first.mutationId, status: 'committed', revision: 2 }]).sync.outbox).toEqual(acked.sync.outbox)
  })

  it('retains a local stale edit and the newer remote tombstone as a conflict', () => {
    const synced = confirmAll(attachNotebook(fixture(), identity, 'device-a'))
    const edited = prepareLocalCommit(synced, { ...synced, items: [{ ...synced.items[0], question: 'offline edit' }] })
    const remote = Object.values(synced.sync.entities).find((entity) => entity.kind === 'question')!
    const conflicted = applyRemoteChanges(edited, [{ ...remote, revision: 2, deletedAt: stamp }])
    expect(conflicted.items[0].question).toBe('offline edit')
    expect(conflicted.sync.conflicts[0]).toMatchObject({ type: 'delete-edit', remote: { deletedAt: stamp } })
    expect(pendingMutations(conflicted).filter((op) => op.kind === 'question')).toHaveLength(0)
    expect(applyRemoteChanges(conflicted, []).items[0].question).toBe('offline edit')
  })

  it('resolves using local content at the newest remote base rather than forcing an overwrite', () => {
    const synced = confirmAll(attachNotebook(fixture(), identity, 'device-a'))
    const edited = prepareLocalCommit(synced, { ...synced, items: [{ ...synced.items[0], question: 'offline edit' }] })
    const remote = Object.values(synced.sync.entities).find((entry) => entry.kind === 'question')!
    const conflicted = applyRemoteChanges(edited, [{ ...remote, revision: 4, payload: { ...remote.payload, question: 'remote edit' } }])
    const resolved = resolveConflict(conflicted, conflicted.sync.conflicts[0].id, 'local')
    expect(resolved.items[0].question).toBe('offline edit')
    expect(resolved.sync.conflicts).toHaveLength(0)
    expect(pendingMutations(resolved).find((entry) => entry.kind === 'question')).toMatchObject({ baseRevision: 4, payload: { question: 'offline edit' } })
  })

  it('adopts a remote deletion or preserves both question versions with fresh IDs', () => {
    const synced = confirmAll(attachNotebook(fixture(), identity, 'device-a'))
    const edited = prepareLocalCommit(synced, { ...synced, items: [{ ...synced.items[0], question: 'offline edit' }] })
    const remote = Object.values(synced.sync.entities).find((entry) => entry.kind === 'question')!
    const conflicted = applyRemoteChanges(edited, [{ ...remote, revision: 4, deletedAt: stamp }])
    const adopted = resolveConflict(conflicted, conflicted.sync.conflicts[0].id, 'remote')
    expect(adopted.items[0]).toMatchObject({ status: 'trashed', deletedAt: stamp })
    const both = resolveConflict(conflicted, conflicted.sync.conflicts[0].id, 'both')
    expect(both.items).toHaveLength(2)
    expect(both.items.find((item) => item.question === 'offline edit')?.id).not.toBe('item-legacy')
    expect(both.sync.outbox.find((op) => op.kind === 'question')?.payload.sourceQuestionId).toBe(remote.id)
  })

  it('preserves two offline review facts and represents undo as a tombstone cancellation', () => {
    const synced = confirmAll(attachNotebook(fixture(), identity, 'device-a'))
    const before = synced.items[0].schedule
    const after = scheduleReview(before, 'good', new Date(stamp), synced.reviewSettings)
    const review: Review = { id: 'review-a', mistakeId: 'item-legacy', rating: 'good', answerText: '2', reviewedAt: stamp, durationSeconds: 4, before, after }
    const rated = prepareLocalCommit(synced, { ...synced, reviews: [review], items: [{ ...synced.items[0], schedule: after }] })
    const undo = prepareLocalCommit(rated, { ...rated, reviews: [], items: [{ ...rated.items[0], schedule: before }] })
    const reviewOps = undo.sync.outbox.filter((op) => op.kind === 'review')
    expect(reviewOps).toHaveLength(2)
    expect(reviewOps[1].deletedAt).toBeTypeOf('string')
    const remoteReview = { kind: 'review' as const, id: crypto.randomUUID(), revision: 1, payload: { ...reviewOps[0].payload, localId: 'review-b', deviceId: 'device-b' } }
    const merged = applyRemoteChanges(rated, [remoteReview])
    expect(merged.reviews.map((entry) => entry.id).sort()).toEqual(['review-a', 'review-b'])
    const remoteQuestion = Object.values(synced.sync.entities).find((entry) => entry.kind === 'question')!
    const bothRated = applyRemoteChanges(rated, [remoteReview, { ...remoteQuestion, revision: 2, payload: { ...remoteQuestion.payload, schedule: after } }])
    expect(bothRated.reviews).toHaveLength(2)
    expect(bothRated.sync.conflicts.find((entry) => entry.kind === 'question')?.type).toBe('schedule-divergence')
  })
})

describe('protocol boundaries', () => {
  it('validates persisted outbox state including a durable oversized failed task', () => {
    const attached = attachNotebook(fixture(), identity, 'device-a')
    expect(validateSyncState(JSON.parse(JSON.stringify(attached.sync)))).toEqual(attached.sync)
    expect(() => validateSyncState({ ...attached.sync, schemaVersion: 2 })).toThrow()
    expect(() => validateSyncState({ ...attached.sync, outbox: [{ ...attached.sync.outbox[0], baseRevision: -1 }] })).toThrow()
    const oversized = prepareLocalCommit(attached, { ...attached, items: [{ ...attached.items[0], question: 'a'.repeat(20_000) }] })
    expect(() => validateSyncState(JSON.parse(JSON.stringify(oversized.sync)))).not.toThrow()
  })
  it('rejects unknown schema, local data URLs, oversized payloads and unknown fields', () => {
    const attached = attachNotebook(fixture(), identity, 'device-a')
    const op = attached.sync.outbox.find((entry) => entry.kind === 'question')!
    expect(() => parseMutation(op)).not.toThrow()
    expect(() => parseEntity({ kind: op.kind, id: op.entityId, revision: 1, payload: { ...op.payload, schemaVersion: 9 } })).toThrow()
    expect(() => parseMutation({ ...op, payload: { ...op.payload, dataUrl: image.dataUrl } })).toThrow()
    expect(() => parseMutation({ ...op, payload: { ...op.payload, question: 'a'.repeat(300_000) } })).toThrow()
    expect(() => parseMutation({ ...op, payload: { ...op.payload, apiKey: 'secret' } })).toThrow()
    expect(() => parseMutation({ ...op, payload: { ...op.payload, recognition: { status: 'idle', reviewed: false, api_key: 'secret' } } })).toThrow()
    expect(() => parseMutation({ ...op, payload: { ...op.payload, schedule: { ...question().schedule, unexpectedFutureField: 3 } } })).toThrow()
  })
})
