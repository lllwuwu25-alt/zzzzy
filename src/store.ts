import { create } from 'zustand'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { initialNotebook } from './data'
import { duePriority, scheduleReview } from './lib/fsrs'
import { parseNotebookBackup } from './lib/notebook'
import { defaultTypeContent, normalizeMistakeType } from './lib/question-types'
import { readWebNotebook, writeWebNotebook, migrateWebNotebook, writeWebSyncBackup } from './lib/web-notebook-storage'
import { attachNotebook, prepareLocalCommit, type MaybeSyncNotebook } from './sync/model'
import type { SyncIdentity } from './sync/protocol'
import type { ImageAsset, Mistake, Notebook, QuestionType, Rating, Review, ReviewSettings, Schedule } from './types'

const KEY = 'mistake-notebook-v1'
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))

const normalizeNotebook = (parsed: Partial<Notebook>): Notebook => ({
  ...initialNotebook,
  ...parsed,
  reviewSettings: {
    ...initialNotebook.reviewSettings,
    ...parsed.reviewSettings,
    intervals: { ...initialNotebook.reviewSettings.intervals, ...parsed.reviewSettings?.intervals },
  },
  items: (parsed.items ?? initialNotebook.items).map(normalizeMistakeType),
})

const load = (): Notebook => {
  try {
    const value = localStorage.getItem(KEY)
    if (!value) return initialNotebook
    return parseNotebookBackup(normalizeNotebook(JSON.parse(value) as Partial<Notebook>))
  } catch {
    return initialNotebook
  }
}

type State = Notebook & {
  lastReview?: Review
  addCapture: (images: ImageAsset[]) => Promise<string>
  addTypedCaptures: (groups: Array<{ images: ImageAsset[]; questionType: QuestionType }>) => Promise<string[]>
  splitCapture: (id: string) => Promise<string[]>
  updateItem: (id: string, patch: Partial<Mistake>) => void
  updateItemNow: (id: string, patch: Partial<Mistake>) => Promise<void>
  saveOrganized: (id: string, patch: Partial<Mistake>) => Promise<void>
  trashItem: (id: string) => void
  restoreItem: (id: string) => void
  purgeExpired: () => void
  rate: (id: string, rating: Rating, answerText: string, durationSeconds: number) => Promise<void>
  undoRating: () => Promise<void>
  replaceNotebook: (data: Notebook) => Promise<void>
  setWorkspace: (path: string) => Promise<void>
  setReviewSettings: (settings: ReviewSettings) => void
  addExam: (name: string) => string | undefined
  addSubject: (exam: string, name: string) => string | undefined
  addChapter: (exam: string, subject: string, name: string) => string | undefined
  renameExam: (name: string, nextName: string) => string | undefined
  renameSubject: (exam: string, name: string, nextName: string) => string | undefined
  renameChapter: (exam: string, subject: string, name: string, nextName: string) => string | undefined
  deleteExam: (name: string) => string | undefined
  deleteSubject: (exam: string, name: string) => string | undefined
  deleteChapter: (exam: string, subject: string, name: string) => string | undefined
}

const persistNotebook = async (state: Notebook, requireWorkspace = false) => {
  const contents = JSON.stringify(state)
  if (isTauri()) {
    if (state.workspacePath && requireWorkspace) {
      await invoke('write_workspace_notebook', { path: state.workspacePath, contents })
    }
    await invoke('write_app_notebook', { contents })
    if (state.workspacePath && !requireWorkspace) {
      await invoke('write_workspace_notebook', { path: state.workspacePath, contents }).catch(() => undefined)
    }
    return
  }
  await writeWebNotebook(contents)
}

let persistenceQueue = Promise.resolve()
type Mutation = { build: (state: State) => Partial<State> | void; optimistic: boolean }
let committedState: State | undefined
const mutations: Mutation[] = []
const publishPending = () => {
  let projected = committedState!
  for (const mutation of mutations) {
    if (!mutation.optimistic) continue
    try { projected = { ...projected, ...mutation.build(projected) } }
    catch { /* The queued commit will reject this mutation without losing other edits. */ }
  }
  useNotebook.setState(projected)
}
const queueMutation = (build: Mutation['build'], optimistic = false, requireWorkspace = false, fromCloud = false, backupFirst = false) => {
  committedState ??= useNotebook.getState()
  const mutation = { build, optimistic }
  mutations.push(mutation)
  if (optimistic) publishPending()
  const task = persistenceQueue.then(async () => {
    try {
      const patch = build(committedState!)
      if (patch) {
        let next = { ...committedState!, ...patch }
        if (!fromCloud && committedState!.sync) next = { ...next, ...prepareLocalCommit(core(committedState!), core(next)) }
        if (backupFirst || (!committedState!.sync && next.sync)) {
          const backup = JSON.stringify(core(committedState!))
          if (isTauri()) await invoke('create_sync_backup', { contents: backup })
          else await writeWebSyncBackup(backup)
        }
        await persistNotebook(core(next), requireWorkspace)
        committedState = next
      }
    } finally {
      mutations.splice(mutations.indexOf(mutation), 1)
      publishPending()
    }
  })
  persistenceQueue = task.catch(() => undefined)
  return task
}
const optimisticUpdate = (build: Mutation['build']) => { void queueMutation(build, true).catch(() => undefined) }
const core = (state: State): Notebook => ({
  version: 1,
  items: state.items,
  reviews: state.reviews,
  taxonomy: state.taxonomy,
  reviewSettings: state.reviewSettings,
  workspaceName: state.workspaceName,
  workspacePath: state.workspacePath,
  workspaceUpdatedAt: state.workspaceUpdatedAt,
  sync: state.sync,
  localSyncSpaces: state.localSyncSpaces,
})

export const readSyncNotebook = (): MaybeSyncNotebook => core(useNotebook.getState())
/** All remote applications/acks share the existing serialized durable commit lane. */
export const transactSyncNotebook = (build: (notebook: MaybeSyncNotebook) => MaybeSyncNotebook) => queueMutation((state) => build(core(state)), false, false, true)
export const attachCloudNotebook = (identity: SyncIdentity, deviceId: string) => transactSyncNotebook((notebook) => attachNotebook(notebook, identity, deviceId))
const spaceKey = (identity: SyncIdentity) => JSON.stringify([identity.environment, identity.accountId, identity.libraryId])
/** Explicit account switch: archive A with its queue, activate B's own copy, never import A into B. */
export const switchCloudSpace = (identity: SyncIdentity, deviceId: string) => queueMutation((state) => {
  const { localSyncSpaces, ...current } = core(state)
  if (!current.sync) throw new Error('SYNC_NOT_ATTACHED')
  const spaces = { ...localSyncSpaces, [spaceKey(current.sync.identity)]: current }
  const target = spaces[spaceKey(identity)] ?? { ...clone(initialNotebook), workspaceName: '飞书题库 · 本机副本' }
  const active = attachNotebook(target, identity, deviceId)
  return { ...active, localSyncSpaces: spaces, lastReview: undefined }
}, false, false, true, true)
export const clearCloudLocalCopy = () => queueMutation((state) => {
  if (!state.sync) return
  if (state.sync.outbox.length || state.sync.conflicts.length) throw new Error('仍有待同步内容或未解决冲突，请先导出备份或保留本机副本。')
  const spaces = { ...state.localSyncSpaces }
  delete spaces[spaceKey(state.sync.identity)]
  return { ...clone(initialNotebook), sync: undefined, localSyncSpaces: spaces, workspacePath: undefined, workspaceUpdatedAt: undefined, lastReview: undefined }
}, false, false, true, true)

export const useNotebook = create<State>((_set, get) => ({
  ...load(),
  addCapture: async (images) => {
    const ids = await get().addTypedCaptures([{ images, questionType: 'short-answer' }])
    return ids[0]
  },
  addTypedCaptures: async (groups) => {
    const stamp = new Date().toISOString()
    const ids = groups.map(() => uid('item'))
    const items = groups.map((group, index) => captureItem(ids[index], group.images, stamp, group.questionType))
    await queueMutation((state) => ({ items: [...items, ...state.items] }))
    return ids
  },
  splitCapture: async (id) => {
    let ids: string[] = []
    await queueMutation((state) => {
      const source = state.items.find((item) => item.id === id)
      if (!source || source.images.length < 2) { ids = source ? [source.id] : []; return }
      ids = source.images.map(() => uid('item'))
      const replacements = source.images.map((image, index) => ({
        ...captureItem(ids[index], [image], source.createdAt, source.questionType),
        exam: source.exam, subject: source.subject, chapter: source.chapter,
        answer: source.answer, cause: source.cause, note: source.note, tags: [...source.tags],
    }))
    const position = state.items.findIndex((item) => item.id === id)
    const items = [...state.items]
    items.splice(position, 1, ...replacements)
    return { items }
    })
    return ids
  },
  updateItem: (id, patch) => optimisticUpdate((state) => {
    const next = { ...state, items: state.items.map((item) => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item) }
    return next
  }),
  updateItemNow: async (id, patch) => {
    await queueMutation((state) => ({ items: state.items.map((item) => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item) }))
  },
  saveOrganized: async (id, patch) => get().updateItemNow(id, { ...patch, status: 'ready' }),
  trashItem: (id) => get().updateItem(id, { status: 'trashed', deletedAt: new Date().toISOString() }),
  restoreItem: (id) => get().updateItem(id, { status: 'ready', deletedAt: undefined }),
  purgeExpired: () => optimisticUpdate((state) => {
    // Keep synchronized tombstones and referenced originals until a future retention protocol exists.
    if (state.sync) return
    const cutoff = Date.now() - 30 * 86_400_000
    const next = { ...state, items: state.items.filter((item) => item.status !== 'trashed' || !item.deletedAt || new Date(item.deletedAt).getTime() > cutoff) }
    return next
  }),
  rate: async (id, rating, answerText, durationSeconds) => {
    await queueMutation((state) => {
      const item = state.items.find((entry) => entry.id === id)
      if (!item) return
      const before = clone(item.schedule)
      const after = scheduleReview(before, rating, new Date(), state.reviewSettings)
      const review: Review = { id: uid('review'), mistakeId: id, rating, answerText, reviewedAt: new Date().toISOString(), durationSeconds, before, after }
      const next = {
        ...state,
        items: state.items.map((entry) => entry.id === id ? { ...entry, schedule: after, updatedAt: review.reviewedAt } : entry),
        reviews: [review, ...state.reviews],
        lastReview: review,
      }
      return next
    })
  },
  undoRating: async () => {
    await queueMutation((state) => {
      const review = state.lastReview
      if (!review) return
      const next = {
        ...state,
        items: state.items.map((item) => item.id === review.mistakeId ? { ...item, schedule: review.before } : item),
        reviews: state.reviews.filter((entry) => entry.id !== review.id),
        lastReview: undefined,
      }
      return next
    })
  },
  replaceNotebook: async (data) => {
    const migrated = normalizeNotebook(data)
    await queueMutation(() => ({ ...migrated, lastReview: undefined }))
  },
  setWorkspace: async (path) => {
    const normalized = path.replace(/[\\/]+$/, '')
    const name = normalized.split(/[\\/]/).pop() || '我的错题本'
    await queueMutation(() => ({ workspacePath: normalized, workspaceName: name, workspaceUpdatedAt: new Date().toISOString() }), false, true)
  },
  setReviewSettings: (reviewSettings) => optimisticUpdate((state) => {
    const intervals = Object.fromEntries(Object.entries(reviewSettings.intervals).map(([key, value]) => [key, Math.min(3650, Math.max(1, Math.round(Number(value) || 1)))])) as ReviewSettings['intervals']
    const next = { ...state, reviewSettings: { ...reviewSettings, intervals } }
    return next
  }),
  addExam: (name) => {
    const value = name.trim()
    if (!value) return '考试名称不能为空'
    const state = get()
    if (state.taxonomy.exams.some((entry) => entry.name === value)) return '这个考试已经存在'
    optimisticUpdate((state) => {
      const next = { ...state, taxonomy: { exams: [...state.taxonomy.exams, { name: value, subjects: [] }] } }
      return next
    })
  },
  addSubject: (exam, name) => {
    const value = name.trim()
    if (!value) return '科目名称不能为空'
    const state = get()
    const parent = state.taxonomy.exams.find((entry) => entry.name === exam)
    if (!parent) return '请先选择考试'
    if (parent.subjects.some((entry) => entry.name === value)) return '这个科目已经存在'
    optimisticUpdate((state) => {
      const taxonomy = { exams: state.taxonomy.exams.map((entry) => entry.name === exam ? { ...entry, subjects: [...entry.subjects, { name: value, chapters: [] }] } : entry) }
      const next = { ...state, taxonomy }; return next
    })
  },
  addChapter: (exam, subject, name) => {
    const value = name.trim()
    if (!value) return '章节名称不能为空'
    const state = get()
    const parent = state.taxonomy.exams.find((entry) => entry.name === exam)?.subjects.find((entry) => entry.name === subject)
    if (!parent) return '请先选择科目'
    if (parent.chapters.includes(value)) return '这个章节已经存在'
    optimisticUpdate((state) => {
      const taxonomy = { exams: state.taxonomy.exams.map((entry) => entry.name === exam ? { ...entry, subjects: entry.subjects.map((subjectEntry) => subjectEntry.name === subject ? { ...subjectEntry, chapters: [...subjectEntry.chapters, value] } : subjectEntry) } : entry) }
      const next = { ...state, taxonomy }; return next
    })
  },
  renameExam: (name, nextName) => {
    const value = nextName.trim(); const state = get()
    if (!value) return '考试名称不能为空'
    if (value !== name && state.taxonomy.exams.some((entry) => entry.name === value)) return '这个考试已经存在'
    optimisticUpdate((state) => {
      const next = { ...state, taxonomy: { exams: state.taxonomy.exams.map((entry) => entry.name === name ? { ...entry, name: value } : entry) }, items: state.items.map((item) => item.exam === name ? { ...item, exam: value, updatedAt: new Date().toISOString() } : item) }
      return next
    })
  },
  renameSubject: (exam, name, nextName) => {
    const value = nextName.trim(); const state = get()
    if (!value) return '科目名称不能为空'
    const parent = state.taxonomy.exams.find((entry) => entry.name === exam)
    if (!parent) return '考试不存在'
    if (value !== name && parent.subjects.some((entry) => entry.name === value)) return '这个科目已经存在'
    optimisticUpdate((state) => {
      const taxonomy = { exams: state.taxonomy.exams.map((entry) => entry.name === exam ? { ...entry, subjects: entry.subjects.map((subject) => subject.name === name ? { ...subject, name: value } : subject) } : entry) }
      const next = { ...state, taxonomy, items: state.items.map((item) => item.exam === exam && item.subject === name ? { ...item, subject: value, updatedAt: new Date().toISOString() } : item) }
      return next
    })
  },
  renameChapter: (exam, subject, name, nextName) => {
    const value = nextName.trim(); const state = get()
    if (!value) return '章节名称不能为空'
    const parent = state.taxonomy.exams.find((entry) => entry.name === exam)?.subjects.find((entry) => entry.name === subject)
    if (!parent) return '科目不存在'
    if (value !== name && parent.chapters.includes(value)) return '这个章节已经存在'
    optimisticUpdate((state) => {
      const taxonomy = { exams: state.taxonomy.exams.map((entry) => entry.name === exam ? { ...entry, subjects: entry.subjects.map((subjectEntry) => subjectEntry.name === subject ? { ...subjectEntry, chapters: subjectEntry.chapters.map((chapter) => chapter === name ? value : chapter) } : subjectEntry) } : entry) }
      const next = { ...state, taxonomy, items: state.items.map((item) => item.exam === exam && item.subject === subject && item.chapter === name ? { ...item, chapter: value, updatedAt: new Date().toISOString() } : item) }
      return next
    })
  },
  deleteExam: (name) => {
    const state = get(); const exam = state.taxonomy.exams.find((entry) => entry.name === name)
    if (!exam) return '考试不存在'
    if (exam.subjects.length) return '请先删除该考试下的科目'
    if (state.items.some((item) => item.exam === name)) return '仍有错题使用这个考试，暂时不能删除'
    optimisticUpdate((state) => {
      const next = { ...state, taxonomy: { exams: state.taxonomy.exams.filter((entry) => entry.name !== name) } }; return next
    })
  },
  deleteSubject: (exam, name) => {
    const state = get(); const subject = state.taxonomy.exams.find((entry) => entry.name === exam)?.subjects.find((entry) => entry.name === name)
    if (!subject) return '科目不存在'
    if (subject.chapters.length) return '请先删除该科目下的章节'
    if (state.items.some((item) => item.exam === exam && item.subject === name)) return '仍有错题使用这个科目，暂时不能删除'
    optimisticUpdate((state) => {
      const taxonomy = { exams: state.taxonomy.exams.map((entry) => entry.name === exam ? { ...entry, subjects: entry.subjects.filter((subjectEntry) => subjectEntry.name !== name) } : entry) }
      const next = { ...state, taxonomy }; return next
    })
  },
  deleteChapter: (exam, subject, name) => {
    const state = get()
    if (state.items.some((item) => item.exam === exam && item.subject === subject && item.chapter === name)) return '仍有错题使用这个章节，暂时不能删除'
    optimisticUpdate((state) => {
      const taxonomy = { exams: state.taxonomy.exams.map((entry) => entry.name === exam ? { ...entry, subjects: entry.subjects.map((subjectEntry) => subjectEntry.name === subject ? { ...subjectEntry, chapters: subjectEntry.chapters.filter((chapter) => chapter !== name) } : subjectEntry) } : entry) }
      const next = { ...state, taxonomy }; return next
    })
  },
}))

export async function hydrateNotebook() {
  if (!isTauri()) {
    const saved = await readWebNotebook()
    const contents = saved ?? localStorage.getItem(KEY)
    if (contents === null) return
    const parsed = JSON.parse(contents) as Partial<Notebook>
    let notebook = saved === null
      ? parseNotebookBackup({ ...parsed, reviewSettings: normalizeNotebook(parsed).reviewSettings })
      : parseNotebookBackup(parsed)
    if (saved === null) notebook = parseNotebookBackup(JSON.parse(await migrateWebNotebook(JSON.stringify(notebook))))
    useNotebook.setState({ ...notebook, lastReview: undefined })
    // Keep the legacy value untouched as a recovery backup. All future writes use IndexedDB.
    return
  }
  const contents = await invoke<string | null>('read_app_notebook')
  // A new unactivated installation must be able to reach licensing without a write.
  // Existing corrupt/unsupported data must reach StorageRecovery, never an empty writable notebook.
  if (!contents) return
  const notebook = parseNotebookBackup(normalizeNotebook(JSON.parse(contents) as Partial<Notebook>))
  useNotebook.setState({ ...notebook, lastReview: undefined })
}

function captureItem(id: string, images: ImageAsset[], stamp: string, questionType: QuestionType = 'short-answer'): Mistake {
  return {
    id, status: 'inbox', exam: '', subject: '', chapter: '',
    questionType, ...defaultTypeContent(questionType),
    recognition: { status: 'idle', reviewed: false },
    question: '',
    answer: '', cause: '', note: '', tags: [], images, createdAt: stamp, updatedAt: stamp,
    schedule: { due: stamp, stability: 0.4, difficulty: 5, reps: 0, lapses: 0 },
  }
}

export const selectDue = (state: State) => state.items
  .filter((item) => item.status === 'ready' && new Date(item.schedule.due).getTime() <= Date.now())
  .sort((a, b) => duePriority(b.schedule) - duePriority(a.schedule))

export const scheduleLabel = (schedule: Schedule) => {
  const date = new Date(schedule.due)
  if (date.getTime() <= Date.now()) return '到期'
  return `${date.getMonth() + 1}月${date.getDate()}日`
}
