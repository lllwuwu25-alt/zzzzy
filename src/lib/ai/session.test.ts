import { expect, it } from 'vitest'
import { createRecognitionSession, sameRecognitionSource } from './session'
import type { Mistake } from '../../types'
it('rejects stale, cancelled and cross-item results', () => {
  const session = createRecognitionSession()
  const a = session.start('a')
  const b = session.start('b')
  expect(session.isCurrent(a, 'a')).toBe(false)
  expect(session.isCurrent(b, 'a')).toBe(false)
  expect(session.isCurrent(b, 'b')).toBe(true)
  session.cancel()
  expect(session.isCurrent(b, 'b')).toBe(false)
})
it('invalidates suggestions after replacing source or changing type, not annotations', () => {
  const a = { id: 'q', questionType: 'choice', images: [{ id:'a', dataUrl:'original', annotations:[] }] } as unknown as Mistake
  expect(sameRecognitionSource(a, { ...a, questionType:'short-answer' })).toBe(false)
  expect(sameRecognitionSource(a, { ...a, images:[{...a.images[0],dataUrl:'replaced'}] })).toBe(false)
  expect(sameRecognitionSource(a, { ...a, note:'new note' })).toBe(true)
})
