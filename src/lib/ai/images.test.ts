import { expect, it } from 'vitest'
import { fitImageSize, validatePreparedImages } from './images'
it('preserves aspect ratio while limiting resolution', () => {
  expect(fitImageSize(4800, 1200)).toEqual({ width: 2400, height: 600 })
  expect(fitImageSize(400, 900)).toEqual({ width: 400, height: 900 })
})
it('rejects empty, oversized, malformed and excessive uploads', () => {
  const image = { id: 'one', name: 'one', dataUrl: 'data:image/png;base64,aGVsbG8=' }
  expect(() => validatePreparedImages(Array(8).fill(image))).not.toThrow()
  for (const images of [[], Array(9).fill(image), [{ ...image, dataUrl: 'data:image/png;base64,' + 'a'.repeat(17 * 1024 * 1024) }], [{ ...image, dataUrl: 'file://secret' }]]) expect(() => validatePreparedImages(images)).toThrow()
})
