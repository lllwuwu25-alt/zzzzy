import { describe, expect, it } from 'vitest'
import { parseAiQuestion } from './schema'

describe('AI structured extraction', () => {
  it('keeps missing answers empty for each question type', () => {
    for (const questionType of ['choice', 'fill-blank', 'short-answer'] as const) {
      const raw = { questionType, question: '求解', answer: '', choice: { mode: 'single', options: [{ id: 'a', label: 'A', text: '甲' }, { id: 'b', label: 'B', text: '乙' }], correctOptionIds: [] }, fillBlank: { blanks: [{ id: 'blank-1', answer: '' }] }, shortAnswer: { keyPoints: [] } }
      expect(parseAiQuestion(JSON.stringify(raw), questionType).answer).toBe('')
    }
  })
  it('rejects malformed, empty, truncated, oversized and mismatched output', () => {
    for (const raw of ['', '<html>error</html>', '{"question":', 'x'.repeat(262145), JSON.stringify({ questionType: 'choice', question: 'q', answer: '' })]) expect(() => parseAiQuestion(raw, 'short-answer')).toThrow()
  })
  it('rejects duplicate options and invalid answer references', () => {
    const value = { questionType: 'choice', question: '选择', answer: '', choice: { mode: 'multiple', options: [{ id: 'a', label: 'A', text: '甲' }, { id: 'b', label: 'B', text: '乙' }], correctOptionIds: ['z'] } }
    expect(() => parseAiQuestion(JSON.stringify(value), 'choice')).toThrow()
    value.choice.options[1].id = 'a'; value.choice.correctOptionIds = []
    expect(() => parseAiQuestion(JSON.stringify(value), 'choice')).toThrow()
  })
})
