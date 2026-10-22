import { expect, it } from 'vitest'
import { initialNotebook } from '../../data'
import { buildSuggestions, applySuggestions, undoSuggestions } from './suggestions'
import type { Mistake } from '../../types'

const item = { ...initialNotebook, id: 'q', question: '原题', answer: '', questionType: 'short-answer', shortAnswer: { keyPoints: [] }, note: '' } as unknown as Mistake
it('skips edits made during recognition and keeps unrelated edits during undo', () => {
  const current = { ...item, question: '手工编辑', note: '保留笔记' }
  const suggestions = buildSuggestions(item, current, { questionType: 'short-answer', question: '识别题干', answer: '图片答案', shortAnswer: { keyPoints: [] } })
  expect(suggestions.find((s) => s.key === 'question')?.conflict).toBe(true)
  const change = applySuggestions(current, suggestions, suggestions.filter((s) => !s.conflict).map((s) => s.key))
  expect(change.patch.question).toBeUndefined()
  expect(change.patch.answer).toBe('图片答案')
  const later = { ...current, ...change.patch, note: '后续笔记' }
  expect({ ...later, ...undoSuggestions(later, change) }).toMatchObject({ question: '手工编辑', answer: '', note: '后续笔记' })
  expect(() => undoSuggestions({ ...later, answer: '再次手改' }, change)).toThrow()
})
