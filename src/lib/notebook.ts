import type { Annotation, ImageAsset, Mistake, Notebook, Rating, Review, Schedule, Taxonomy } from '../types'

const ratings: Rating[] = ['again', 'hard', 'good', 'easy']
const imageData = /^data:image\/(png|jpe?g|webp|gif|bmp);base64,/i
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const string = (value: unknown): value is string => typeof value === 'string'
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(string)

function schedule(value: unknown): value is Schedule {
  return record(value) && string(value.due) && Number.isFinite(Date.parse(value.due))
    && finite(value.stability) && finite(value.difficulty) && finite(value.reps) && finite(value.lapses)
    && (value.lastReview === undefined || (string(value.lastReview) && Number.isFinite(Date.parse(value.lastReview))))
}

function annotation(value: unknown): value is Annotation {
  return record(value) && string(value.id)
    && ['pen', 'highlighter', 'text', 'arrow', 'rect', 'ellipse', 'mask'].includes(String(value.tool))
    && string(value.color) && finite(value.width) && Array.isArray(value.points) && value.points.every(finite)
}

function image(value: unknown): value is ImageAsset {
  return record(value) && string(value.id) && string(value.name) && string(value.dataUrl) && imageData.test(value.dataUrl)
    && finite(value.rotation) && Array.isArray(value.annotations) && value.annotations.every(annotation)
}

function mistake(value: unknown): value is Mistake {
  return record(value) && string(value.id) && ['inbox', 'ready', 'trashed'].includes(String(value.status))
    && ['exam', 'subject', 'chapter', 'question', 'answer', 'cause', 'note', 'createdAt', 'updatedAt'].every((key) => string(value[key]))
    && stringList(value.tags) && Array.isArray(value.images) && value.images.every(image) && schedule(value.schedule)
}

function taxonomy(value: unknown): value is Taxonomy {
  return record(value) && Array.isArray(value.exams) && value.exams.every((exam) => record(exam) && string(exam.name)
    && Array.isArray(exam.subjects) && exam.subjects.every((subject) => record(subject) && string(subject.name) && stringList(subject.chapters)))
}

function review(value: unknown): value is Review {
  return record(value) && string(value.id) && string(value.mistakeId) && ratings.includes(value.rating as Rating)
    && string(value.answerText) && string(value.reviewedAt) && finite(value.durationSeconds)
    && schedule(value.before) && schedule(value.after)
}

export function parseNotebookBackup(value: unknown): Notebook {
  const settings = record(value) && record(value.reviewSettings) ? value.reviewSettings : undefined
  const intervals = settings && record(settings.intervals) ? settings.intervals : undefined
  if (!record(value) || value.version !== 1 || !Array.isArray(value.items) || !value.items.every(mistake)
    || !Array.isArray(value.reviews) || !value.reviews.every(review) || !taxonomy(value.taxonomy)
    || !settings || !['adaptive', 'custom'].includes(String(settings.mode))
    || !intervals || !ratings.every((rating) => finite(intervals[rating]) && Number(intervals[rating]) >= 1)
    || !string(value.workspaceName) || (value.workspacePath !== undefined && !string(value.workspacePath))) {
    throw new Error('invalid-notebook-backup')
  }
  return value as unknown as Notebook
}
