import { describe, expect, it } from 'vitest'
import { targetOcrSize } from './ocr-preprocess'

describe('OCR preprocessing dimensions', () => {
  it('enlarges small screenshots to make text easier to recognize', () => {
    expect(targetOcrSize(800, 500)).toEqual({ width: 1600, height: 1000, scale: 2 })
  })

  it('caps large images to control memory use', () => {
    expect(targetOcrSize(5000, 3000)).toEqual({ width: 2600, height: 1560, scale: 0.52 })
  })

  it('keeps medium images at their original size', () => {
    expect(targetOcrSize(2200, 1400)).toEqual({ width: 2200, height: 1400, scale: 1 })
  })
})
