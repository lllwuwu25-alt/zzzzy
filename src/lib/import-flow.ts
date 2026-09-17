import type { ImageAsset, QuestionType } from '../types'

export type ImportMode = 'merge' | 'split'

export type ImportGroup = {
  id: string
  images: ImageAsset[]
  questionType?: QuestionType
}

const groupId = () => `group-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`

export function groupsFor(images: ImageAsset[], mode: ImportMode): ImportGroup[] {
  if (!images.length) return []
  if (mode === 'merge') return [{ id: groupId(), images: [...images] }]
  return images.map((image) => ({ id: groupId(), images: [image] }))
}

export function assignGroupType(groups: ImportGroup[], id: string, questionType: QuestionType) {
  return groups.map((group) => group.id === id ? { ...group, questionType } : group)
}

export function importReady(groups: ImportGroup[]) {
  return groups.length > 0 && groups.every((group) => group.images.length > 0 && Boolean(group.questionType))
}
