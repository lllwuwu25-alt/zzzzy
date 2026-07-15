import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { initialNotebook } from './data'
import { duePriority, scheduleReview } from './lib/fsrs'
import type { ImageAsset, Mistake, Notebook, Rating, Review, Schedule } from './types'

const KEY = 'mistake-notebook-v1'
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))

const load = (): Notebook => {
  try {
    const value = localStorage.getItem(KEY)
    return value ? { ...initialNotebook, ...JSON.parse(value) } : initialNotebook
  } catch {
    return initialNotebook
  }
}

type State = Notebook & {
  lastReview?: Review
  addCapture: (images: ImageAsset[]) => string
  splitCapture: (id: string) => string[]
  updateItem: (id: string, patch: Partial<Mistake>) => void
  saveOrganized: (id: string, patch: Partial<Mistake>) => void
  trashItem: (id: string) => void
  restoreItem: (id: string) => void
  purgeExpired: () => void
  rate: (id: string, rating: Rating, answerText: string, durationSeconds: number) => void
  undoRating: () => void
  replaceNotebook: (data: Notebook) => void
  setWorkspace: (path: string) => void
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

const persist = (state: Notebook) => {
  const contents = JSON.stringify(state)
  localStorage.setItem(KEY, contents)
  if (state.workspacePath && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    void invoke('write_workspace_notebook', { path: state.workspacePath, contents }).catch(() => undefined)
  }
}
const core = (state: State): Notebook => ({
  version: 1,
  items: state.items,
  reviews: state.reviews,
  taxonomy: state.taxonomy,
  workspaceName: state.workspaceName,
  workspacePath: state.workspacePath,
  workspaceUpdatedAt: state.workspaceUpdatedAt,
})

export const useNotebook = create<State>((set, get) => ({
  ...load(),
  addCapture: (images) => {
    const stamp = new Date().toISOString()
    const id = uid('item')
    set((state) => {
      const item = captureItem(id, images, stamp)
      const next = { ...state, items: [item, ...state.items] }
      persist(core(next))
      return next
    })
    return id
  },
  splitCapture: (id) => {
    const source = get().items.find((item) => item.id === id)
    if (!source || source.images.length < 2) return source ? [source.id] : []
    const ids = source.images.map(() => uid('item'))
    set((state) => {
      const replacements = source.images.map((image, index) => ({
        ...captureItem(ids[index], [image], source.createdAt),
        exam: source.exam, subject: source.subject, chapter: source.chapter,
        answer: source.answer, cause: source.cause, note: source.note, tags: [...source.tags],
      }))
      const position = state.items.findIndex((item) => item.id === id)
      const items = [...state.items]
      items.splice(position, 1, ...replacements)
      const next = { ...state, items }
      persist(core(next)); return next
    })
    return ids
  },
  updateItem: (id, patch) => set((state) => {
    const next = { ...state, items: state.items.map((item) => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item) }
    persist(core(next))
    return next
  }),
  saveOrganized: (id, patch) => get().updateItem(id, { ...patch, status: 'ready' }),
  trashItem: (id) => get().updateItem(id, { status: 'trashed', deletedAt: new Date().toISOString() }),
  restoreItem: (id) => get().updateItem(id, { status: 'ready', deletedAt: undefined }),
  purgeExpired: () => set((state) => {
    const cutoff = Date.now() - 30 * 86_400_000
    const next = { ...state, items: state.items.filter((item) => item.status !== 'trashed' || !item.deletedAt || new Date(item.deletedAt).getTime() > cutoff) }
    persist(core(next))
    return next
  }),
  rate: (id, rating, answerText, durationSeconds) => set((state) => {
    const item = state.items.find((entry) => entry.id === id)
    if (!item) return state
    const before = clone(item.schedule)
    const after = scheduleReview(before, rating)
    const review: Review = { id: uid('review'), mistakeId: id, rating, answerText, reviewedAt: new Date().toISOString(), durationSeconds, before, after }
    const next = {
      ...state,
      items: state.items.map((entry) => entry.id === id ? { ...entry, schedule: after, updatedAt: review.reviewedAt } : entry),
      reviews: [review, ...state.reviews],
      lastReview: review,
    }
    persist(core(next))
    return next
  }),
  undoRating: () => set((state) => {
    const review = state.lastReview
    if (!review) return state
    const next = {
      ...state,
      items: state.items.map((item) => item.id === review.mistakeId ? { ...item, schedule: review.before } : item),
      reviews: state.reviews.filter((entry) => entry.id !== review.id),
      lastReview: undefined,
    }
    persist(core(next))
    return next
  }),
  replaceNotebook: (data) => set(() => {
    persist(data)
    return { ...data, lastReview: undefined }
  }),
  setWorkspace: (path) => set((state) => {
    const normalized = path.replace(/[\\/]+$/, '')
    const name = normalized.split(/[\\/]/).pop() || '我的错题本'
    const next = { ...state, workspacePath: normalized, workspaceName: name, workspaceUpdatedAt: new Date().toISOString() }
    persist(core(next))
    return next
  }),
  addExam: (name) => {
    const value = name.trim()
    if (!value) return '考试名称不能为空'
    const state = get()
    if (state.taxonomy.exams.some((entry) => entry.name === value)) return '这个考试已经存在'
    const next = { ...state, taxonomy: { exams: [...state.taxonomy.exams, { name: value, subjects: [] }] } }
    persist(core(next)); set(next)
  },
  addSubject: (exam, name) => {
    const value = name.trim()
    if (!value) return '科目名称不能为空'
    const state = get()
    const parent = state.taxonomy.exams.find((entry) => entry.name === exam)
    if (!parent) return '请先选择考试'
    if (parent.subjects.some((entry) => entry.name === value)) return '这个科目已经存在'
    const taxonomy = { exams: state.taxonomy.exams.map((entry) => entry.name === exam ? { ...entry, subjects: [...entry.subjects, { name: value, chapters: [] }] } : entry) }
    const next = { ...state, taxonomy }; persist(core(next)); set(next)
  },
  addChapter: (exam, subject, name) => {
    const value = name.trim()
    if (!value) return '章节名称不能为空'
    const state = get()
    const parent = state.taxonomy.exams.find((entry) => entry.name === exam)?.subjects.find((entry) => entry.name === subject)
    if (!parent) return '请先选择科目'
    if (parent.chapters.includes(value)) return '这个章节已经存在'
    const taxonomy = { exams: state.taxonomy.exams.map((entry) => entry.name === exam ? { ...entry, subjects: entry.subjects.map((subjectEntry) => subjectEntry.name === subject ? { ...subjectEntry, chapters: [...subjectEntry.chapters, value] } : subjectEntry) } : entry) }
    const next = { ...state, taxonomy }; persist(core(next)); set(next)
  },
  renameExam: (name, nextName) => {
    const value = nextName.trim(); const state = get()
    if (!value) return '考试名称不能为空'
    if (value !== name && state.taxonomy.exams.some((entry) => entry.name === value)) return '这个考试已经存在'
    const next = { ...state, taxonomy: { exams: state.taxonomy.exams.map((entry) => entry.name === name ? { ...entry, name: value } : entry) }, items: state.items.map((item) => item.exam === name ? { ...item, exam: value, updatedAt: new Date().toISOString() } : item) }
    persist(core(next)); set(next)
  },
  renameSubject: (exam, name, nextName) => {
    const value = nextName.trim(); const state = get()
    if (!value) return '科目名称不能为空'
    const parent = state.taxonomy.exams.find((entry) => entry.name === exam)
    if (!parent) return '考试不存在'
    if (value !== name && parent.subjects.some((entry) => entry.name === value)) return '这个科目已经存在'
    const taxonomy = { exams: state.taxonomy.exams.map((entry) => entry.name === exam ? { ...entry, subjects: entry.subjects.map((subject) => subject.name === name ? { ...subject, name: value } : subject) } : entry) }
    const next = { ...state, taxonomy, items: state.items.map((item) => item.exam === exam && item.subject === name ? { ...item, subject: value, updatedAt: new Date().toISOString() } : item) }
    persist(core(next)); set(next)
  },
  renameChapter: (exam, subject, name, nextName) => {
    const value = nextName.trim(); const state = get()
    if (!value) return '章节名称不能为空'
    const parent = state.taxonomy.exams.find((entry) => entry.name === exam)?.subjects.find((entry) => entry.name === subject)
    if (!parent) return '科目不存在'
    if (value !== name && parent.chapters.includes(value)) return '这个章节已经存在'
    const taxonomy = { exams: state.taxonomy.exams.map((entry) => entry.name === exam ? { ...entry, subjects: entry.subjects.map((subjectEntry) => subjectEntry.name === subject ? { ...subjectEntry, chapters: subjectEntry.chapters.map((chapter) => chapter === name ? value : chapter) } : subjectEntry) } : entry) }
    const next = { ...state, taxonomy, items: state.items.map((item) => item.exam === exam && item.subject === subject && item.chapter === name ? { ...item, chapter: value, updatedAt: new Date().toISOString() } : item) }
    persist(core(next)); set(next)
  },
  deleteExam: (name) => {
    const state = get(); const exam = state.taxonomy.exams.find((entry) => entry.name === name)
    if (!exam) return '考试不存在'
    if (exam.subjects.length) return '请先删除该考试下的科目'
    if (state.items.some((item) => item.exam === name)) return '仍有错题使用这个考试，暂时不能删除'
    const next = { ...state, taxonomy: { exams: state.taxonomy.exams.filter((entry) => entry.name !== name) } }; persist(core(next)); set(next)
  },
  deleteSubject: (exam, name) => {
    const state = get(); const subject = state.taxonomy.exams.find((entry) => entry.name === exam)?.subjects.find((entry) => entry.name === name)
    if (!subject) return '科目不存在'
    if (subject.chapters.length) return '请先删除该科目下的章节'
    if (state.items.some((item) => item.exam === exam && item.subject === name)) return '仍有错题使用这个科目，暂时不能删除'
    const taxonomy = { exams: state.taxonomy.exams.map((entry) => entry.name === exam ? { ...entry, subjects: entry.subjects.filter((subjectEntry) => subjectEntry.name !== name) } : entry) }
    const next = { ...state, taxonomy }; persist(core(next)); set(next)
  },
  deleteChapter: (exam, subject, name) => {
    const state = get()
    if (state.items.some((item) => item.exam === exam && item.subject === subject && item.chapter === name)) return '仍有错题使用这个章节，暂时不能删除'
    const taxonomy = { exams: state.taxonomy.exams.map((entry) => entry.name === exam ? { ...entry, subjects: entry.subjects.map((subjectEntry) => subjectEntry.name === subject ? { ...subjectEntry, chapters: subjectEntry.chapters.filter((chapter) => chapter !== name) } : subjectEntry) } : entry) }
    const next = { ...state, taxonomy }; persist(core(next)); set(next)
  },
}))

function captureItem(id: string, images: ImageAsset[], stamp: string): Mistake {
  return {
    id, status: 'inbox', exam: '', subject: '', chapter: '',
    question: images.length === 1 ? images[0].name.replace(/\.[^.]+$/, '') : `${images.length} 张待整理截图`,
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
