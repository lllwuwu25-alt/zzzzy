import { describe, expect, it } from 'vitest'
import type { Mistake } from '../types'
import { answerTextFor, applyParsedQuestion, canCompleteOrganizer, defaultTypeContent, normalizeMistakeType, serializeResponse } from './question-types'

const base = (patch: Partial<Mistake> = {}) => ({
  id: 'item-1', status: 'inbox', exam: '', subject: '', chapter: '',
  question: '题目', answer: '', cause: '', note: '', tags: [], images: [],
  createdAt: '2026-09-17T00:00:00.000Z', updatedAt: '2026-09-17T00:00:00.000Z',
  schedule: { due: '2026-09-17T00:00:00.000Z', stability: 0.4, difficulty: 5, reps: 0, lapses: 0 },
  ...patch,
}) as Mistake

describe('question type compatibility', () => {
  it('migrates an old mistake to short answer without losing its answer', () => {
    const migrated = normalizeMistakeType(base({ answer: '旧答案', questionType: undefined } as never))
    expect(migrated.questionType).toBe('short-answer')
    expect(migrated.answer).toBe('旧答案')
    expect(migrated.shortAnswer).toEqual({ keyPoints: [] })
  })

  it('turns an interrupted OCR operation into a retryable state', () => {
    const migrated = normalizeMistakeType(base({
      questionType: 'choice',
      recognition: { status: 'processing', reviewed: false, message: '正在识别' },
    }))
    expect(migrated.recognition).toEqual({ status: 'idle', reviewed: false, message: '上次识别被中断，可以重新识别' })
  })

  it('creates only the structure needed by the selected type', () => {
    expect(defaultTypeContent('choice')).toEqual({
      choice: { mode: 'single', options: [], correctOptionIds: [] },
    })
    expect(defaultTypeContent('fill-blank')).toEqual({ fillBlank: { blanks: [] } })
  })

  it('formats choice and fill blank answers for legacy search', () => {
    expect(answerTextFor(base({
      questionType: 'choice',
      choice: { mode: 'multiple', options: [], correctOptionIds: ['A', 'C'] },
    }))).toBe('A、C')
    expect(answerTextFor(base({
      questionType: 'fill-blank',
      fillBlank: { blanks: [{ id: '1', answer: '甲' }, { id: '2', answer: '乙' }] },
    }))).toBe('甲\n乙')
  })

  it('keeps non-empty user text when OCR completes later', () => {
    const patch = applyParsedQuestion(base({ question: '我已修改' }), {
      question: '识别题干', answer: '识别答案', confidence: 82,
    })
    expect(patch.question).toBe('我已修改')
    expect(patch.answer).toBe('识别答案')
    expect(patch.recognition).toMatchObject({ status: 'done', confidence: 82, reviewed: false })
  })

  it('serializes typed responses into the existing review text field', () => {
    expect(serializeResponse(base({ questionType: 'choice' }), { selectedOptionIds: ['A', 'C'] })).toBe('A、C')
    expect(serializeResponse(base({ questionType: 'fill-blank' }), { blanks: ['甲', '乙'] })).toBe('甲\n乙')
    expect(serializeResponse(base({ questionType: 'short-answer' }), { text: '我的思路' })).toBe('我的思路')
  })

  it('allows organizing a question before classification and answer are filled', () => {
    expect(canCompleteOrganizer(base({ exam: '', subject: '', chapter: '', answer: '' }))).toBe(true)
    expect(canCompleteOrganizer(base({ question: '   ', exam: '考研', subject: '数学', chapter: '极限' }))).toBe(false)
  })
})
