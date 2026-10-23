import type { Mistake } from '../../types'
import type { AiQuestionDraft } from './schema'

export type SuggestionKey = 'question' | 'answer' | 'choice' | 'fillBlank' | 'shortAnswer' | 'diagrams'
export type FieldSuggestion = { key: SuggestionKey; label: string; before: unknown; value: unknown; conflict: boolean }
export type SuggestionChange = { patch: Partial<Mistake>; before: Partial<Mistake> }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const labels: Record<SuggestionKey, string> = { question: '题干', answer: '参考答案', choice: '选项与正确选项', fillBlank: '填空答案', shortAnswer: '答题要点', diagrams: '题目配图' }

export function buildSuggestions(snapshot: Mistake, current: Mistake, draft: AiQuestionDraft): FieldSuggestion[] {
  const keys: SuggestionKey[] = ['question', 'answer', draft.questionType === 'choice' ? 'choice' : draft.questionType === 'fill-blank' ? 'fillBlank' : 'shortAnswer']
  if(draft.diagrams)keys.push('diagrams')
  return keys.filter((key) => draft[key] !== undefined && !equal(current[key], draft[key])).map((key) => ({ key, label: labels[key], before: current[key], value: draft[key], conflict: !equal(snapshot[key], current[key]) }))
}

export function applySuggestions(current: Mistake, suggestions: FieldSuggestion[], selectedIds: string[]): SuggestionChange {
  const patch: Partial<Mistake> = {}, before: Partial<Mistake> = {}
  for (const s of suggestions.filter((s) => selectedIds.includes(s.key))) {
    Object.assign(before, { [s.key]: current[s.key] })
    Object.assign(patch, { [s.key]: s.value })
  }
  return { patch, before }
}

export function undoSuggestions(current: Mistake, change: SuggestionChange): Partial<Mistake> {
  for (const key of Object.keys(change.patch) as SuggestionKey[]) {
    if (!equal(current[key], change.patch[key])) throw new Error('采用后的字段已被修改，请手动检查，避免覆盖你的编辑。')
  }
  return change.before
}
