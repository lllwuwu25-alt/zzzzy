import { describe, expect, it } from 'vitest'
import { normalizeRecognizedText } from './ocr'

describe('normalizeRecognizedText', () => {
  it('keeps paragraphs while removing OCR line noise', () => {
    expect(normalizeRecognizedText('  求极限  \r\n\r\n\r\n x → 0\t\n')).toBe('求极限\n\nx → 0')
  })
})
