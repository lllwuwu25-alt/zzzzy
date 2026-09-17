import { describe, expect, it } from 'vitest'
import { parseRecognizedQuestion, scoreOcrCandidate, selectBestCandidate } from './ocr-parser'

describe('typed OCR parsing', () => {
  it('splits Chinese choice options and leaves the answer empty', () => {
    const parsed = parseRecognizedQuestion('下列说法正确的是\nA. 甲\nB、乙\n（C）丙', 'choice', 84)
    expect(parsed.question).toBe('下列说法正确的是')
    expect(parsed.choice?.options.map((option) => [option.label, option.text])).toEqual([
      ['A', '甲'], ['B', '乙'], ['C', '丙'],
    ])
    expect(parsed.choice?.correctOptionIds).toEqual([])
    expect(parsed.answer).toBe('')
  })

  it('extracts an explicitly printed choice answer', () => {
    const parsed = parseRecognizedQuestion('选择正确选项\nA. 甲\nB. 乙\n答案：B', 'choice', 90)
    expect(parsed.choice?.correctOptionIds).toEqual(['B'])
    expect(parsed.answer).toBe('B')
  })

  it('extracts an explicitly printed answer from a fill blank question', () => {
    const parsed = parseRecognizedQuestion('中国的首都是____。\n答案：北京', 'fill-blank', 88)
    expect(parsed.question).toContain('____')
    expect(parsed.fillBlank?.blanks).toHaveLength(1)
    expect(parsed.fillBlank?.blanks[0].answer).toBe('北京')
  })

  it('creates empty blank answers when no answer is printed', () => {
    const parsed = parseRecognizedQuestion('光合作用需要____和____。', 'fill-blank', 75)
    expect(parsed.fillBlank?.blanks.map((blank) => blank.answer)).toEqual(['', ''])
    expect(parsed.answer).toBe('')
  })

  it('separates a short-answer reference answer and key points', () => {
    const parsed = parseRecognizedQuestion('说明光合作用的意义。\n参考答案：\n1. 储存太阳能\n2. 制造有机物', 'short-answer', 86)
    expect(parsed.question).toBe('说明光合作用的意义。')
    expect(parsed.answer).toBe('1. 储存太阳能\n2. 制造有机物')
    expect(parsed.shortAnswer?.keyPoints).toEqual(['储存太阳能', '制造有机物'])
  })
})

describe('OCR candidate selection', () => {
  it('rewards type structure instead of choosing confidence alone', () => {
    const plain = { text: '下列说法正确的是甲乙丙', confidence: 92, variant: 'enhanced' as const }
    const structured = { text: '下列说法正确的是\nA. 甲\nB. 乙\nC. 丙', confidence: 84, variant: 'binary' as const }
    expect(scoreOcrCandidate(structured, 'choice')).toBeGreaterThan(scoreOcrCandidate(plain, 'choice'))
    expect(selectBestCandidate([plain, structured], 'choice')).toEqual(structured)
  })
})
