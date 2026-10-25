import { parseNotebookBackup } from '../lib/notebook'
import { initialNotebook } from '../data'

export const SYNC_SCHEMA_VERSION = 1 as const
export const MAX_ENTITY_BYTES = 16 * 1024
export type EntityKind = 'question' | 'review' | 'collection' | 'config' | 'asset'
export type SyncPayload = Record<string, unknown> & { schemaVersion: 1 }
export type SyncEntity = { kind: EntityKind; id: string; revision: number; payload: SyncPayload; deletedAt?: string }
export type SyncMutation = { mutationId: string; entityId: string; kind: EntityKind; baseRevision: number; payload: SyncPayload; deletedAt?: string }
export type SyncError = { code: string; message: string; retryable: boolean }
export type MutationResult = { mutationId: string; status: 'committed' | 'conflict' | 'retry' | 'failed'; revision?: number; current?: SyncEntity; error?: SyncError }
export type SyncIdentity = { environment: string; accountId: string; libraryId: string }

export const entityKey = (kind: EntityKind, id: string) => `${kind}:${id}`
export const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const string = (value: unknown): value is string => typeof value === 'string'
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const date = (value: unknown) => value === undefined || (string(value) && Number.isFinite(Date.parse(value)))
const kinds: EntityKind[] = ['question', 'review', 'collection', 'config', 'asset']
const allowed: Record<EntityKind, string[]> = {
  question: ['schemaVersion', 'localId', 'status', 'exam', 'subject', 'chapter', 'question', 'questionType', 'answer', 'choice', 'fillBlank', 'shortAnswer', 'recognition', 'diagrams', 'cause', 'note', 'tags', 'images', 'createdAt', 'updatedAt', 'deletedAt', 'schedule', 'sourceQuestionId'],
  review: ['schemaVersion', 'localId', 'questionId', 'deviceId', 'algorithmVersion', 'eventBaseRevision', 'rating', 'answerText', 'reviewedAt', 'durationSeconds', 'before', 'after'],
  asset: ['schemaVersion', 'questionId', 'localImageId', 'name', 'mime', 'order', 'rotation', 'crop', 'annotations', 'editorVersion', 'sourceWidth', 'sourceHeight', 'recognizedText', 'recognizedAt', 'fileToken', 'sha256', 'size', 'originalAssetId', 'status'],
  collection: ['schemaVersion', 'localKey', 'entityType', 'name', 'parentId', 'order'],
  config: ['schemaVersion', 'key', 'reviewSettings'],
}

function fail(): never { throw new Error('INVALID_SYNC_PROTOCOL') }
function fields(value: unknown, keys: string[]): void {
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key))) fail()
}
function scheduleFields(value: unknown): void { fields(value, ['due', 'stability', 'difficulty', 'reps', 'lapses', 'lastReview']) }
function nestedFields(kind: EntityKind, p: SyncPayload): void {
  if (kind === 'question') {
    scheduleFields(p.schedule)
    if (p.choice !== undefined) {
      fields(p.choice, ['mode', 'options', 'correctOptionIds'])
      if (Array.isArray((p.choice as Record<string, unknown>).options)) for (const option of (p.choice as { options: unknown[] }).options) fields(option, ['id', 'label', 'text'])
    }
    if (p.fillBlank !== undefined) {
      fields(p.fillBlank, ['blanks'])
      if (Array.isArray((p.fillBlank as Record<string, unknown>).blanks)) for (const blank of (p.fillBlank as { blanks: unknown[] }).blanks) fields(blank, ['id', 'answer'])
    }
    if (p.shortAnswer !== undefined) fields(p.shortAnswer, ['keyPoints'])
    if (p.recognition !== undefined) fields(p.recognition, ['status', 'confidence', 'reviewed', 'message', 'provider', 'model', 'recognizedAt'])
    if (Array.isArray(p.diagrams)) for (const diagram of p.diagrams) fields(diagram, ['imageId', 'x', 'y', 'width', 'height', 'caption'])
    if (p.sourceQuestionId !== undefined && !uuid(p.sourceQuestionId)) fail()
  } else if (kind === 'review') {
    scheduleFields(p.before)
    scheduleFields(p.after)
  } else if (kind === 'asset') {
    if (p.crop !== undefined) fields(p.crop, ['x', 'y', 'width', 'height'])
    if (Array.isArray(p.annotations)) for (const annotation of p.annotations) fields(annotation, ['id', 'tool', 'color', 'width', 'points', 'text', 'fontSize', 'opacity', 'coordinateSpace'])
  } else if (kind === 'config') {
    fields(p.reviewSettings, ['mode', 'intervals'])
    fields((p.reviewSettings as Record<string, unknown>).intervals, ['again', 'hard', 'good', 'easy'])
  }
}
function safeTree(value: unknown, depth = 0): void {
  if (depth > 32) fail()
  if (Array.isArray(value)) { value.forEach((entry) => safeTree(entry, depth + 1)); return }
  if (!isRecord(value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) fail()
    return
  }
  for (const [key, entry] of Object.entries(value)) {
    if (/(api.?key|secret|password|authorization|dataurl|databaseurl|workspacepath|cachedir)/i.test(key) || /^(dataBase64|workspaceName|accessToken|refreshToken|license|theme|__proto__|constructor|prototype)$/i.test(key)) fail()
    safeTree(entry, depth + 1)
  }
}

export function parsePayload(kind: EntityKind, value: unknown, maxBytes = MAX_ENTITY_BYTES): SyncPayload {
  if (!isRecord(value) || value.schemaVersion !== 1 || Object.keys(value).some((key) => !allowed[kind].includes(key))) fail()
  if (new TextEncoder().encode(JSON.stringify(value)).length > maxBytes) throw new Error('SYNC_PAYLOAD_TOO_LARGE')
  safeTree(value)
  const p = value as SyncPayload
  nestedFields(kind, p)
  const dummyImage = { id: 'image', name: 'image', dataUrl: 'data:image/png;base64,', rotation: 0, annotations: [] }
  try {
    if (kind === 'question') {
      if (!string(p.localId) || !Array.isArray(p.images) || p.images.some((ref) => !isRecord(ref) || !string(ref.id) || !uuid(ref.assetId) || Object.keys(ref).some((key) => !['id', 'assetId'].includes(key)))) fail()
      parseNotebookBackup({ ...initialNotebook, items: [{ ...p, id: p.localId, images: p.images.map((ref) => ({ ...dummyImage, id: (ref as { id: string }).id })) }] })
    } else if (kind === 'review') {
      if (!string(p.localId) || !uuid(p.questionId) || !string(p.deviceId) || p.algorithmVersion !== 'mistake-fsrs-v1' || !integer(p.eventBaseRevision)) fail()
      parseNotebookBackup({ ...initialNotebook, reviews: [{ ...p, id: p.localId, mistakeId: p.questionId }] })
    } else if (kind === 'asset') {
      if (!uuid(p.questionId) || !string(p.localImageId) || !string(p.name) || !string(p.mime) || !/^image\/(png|jpe?g|webp|gif|bmp)$/i.test(p.mime) || !integer(p.order) || !['pending', 'ready'].includes(String(p.status))) fail()
      if (p.fileToken !== undefined && (!string(p.fileToken) || !p.fileToken)) fail()
      if (p.originalAssetId !== undefined && !uuid(p.originalAssetId)) fail()
      if (p.sha256 !== undefined && (!string(p.sha256) || !/^[0-9a-f]{64}$/i.test(p.sha256))) fail()
      if (p.size !== undefined && !integer(p.size)) fail()
      parseNotebookBackup({ ...initialNotebook, items: [{ id: 'q', status: 'inbox', exam: '', subject: '', chapter: '', question: '', questionType: 'short-answer', answer: '', cause: '', note: '', tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01', schedule: { due: '2026-01-01', stability: 1, difficulty: 5, reps: 0, lapses: 0 }, images: [{ ...dummyImage, ...p, id: p.localImageId }] }] })
    } else if (kind === 'collection') {
      if (!string(p.localKey) || !string(p.name) || !['exam', 'subject', 'chapter'].includes(String(p.entityType)) || !integer(p.order) || (p.parentId !== undefined && !uuid(p.parentId))) fail()
    } else {
      if (p.key !== 'review-settings') fail()
      parseNotebookBackup({ ...initialNotebook, reviewSettings: p.reviewSettings })
    }
  } catch { fail() }
  return JSON.parse(JSON.stringify(p)) as SyncPayload
}

export function parseEntity(value: unknown): SyncEntity {
  if (!isRecord(value) || !kinds.includes(value.kind as EntityKind) || !uuid(value.id) || !integer(value.revision) || value.revision === 0 || !date(value.deletedAt)) fail()
  const kind = value.kind as EntityKind
  return { kind, id: value.id, revision: Number(value.revision), payload: parsePayload(kind, value.payload), ...(value.deletedAt === undefined ? {} : { deletedAt: String(value.deletedAt) }) }
}

export function parseMutation(value: unknown, maxBytes = MAX_ENTITY_BYTES): SyncMutation {
  if (!isRecord(value) || !kinds.includes(value.kind as EntityKind) || !uuid(value.mutationId) || !uuid(value.entityId) || !integer(value.baseRevision) || !date(value.deletedAt)) fail()
  const kind = value.kind as EntityKind
  return { kind, mutationId: value.mutationId, entityId: value.entityId, baseRevision: Number(value.baseRevision), payload: parsePayload(kind, value.payload, maxBytes), ...(value.deletedAt === undefined ? {} : { deletedAt: String(value.deletedAt) }) }
}

export function parseMutationResult(value: unknown): MutationResult {
  if (!isRecord(value) || !uuid(value.mutationId) || !['committed', 'conflict', 'retry', 'failed'].includes(String(value.status))) fail()
  if (value.status === 'committed' && (!integer(value.revision) || value.revision === 0)) fail()
  if (value.error !== undefined && (!isRecord(value.error) || !string(value.error.code) || !string(value.error.message) || typeof value.error.retryable !== 'boolean')) fail()
  return { mutationId: value.mutationId, status: value.status as MutationResult['status'], ...(value.revision === undefined ? {} : { revision: Number(value.revision) }), ...(value.current === undefined ? {} : { current: parseEntity(value.current) }), ...(value.error === undefined ? {} : { error: value.error as SyncError }) }
}
