import { describe, expect, it } from 'vitest'
import { initialNotebook } from '../data'
import { parseNotebookBackup } from './notebook'

describe('notebook backup validation', () => {
  it('accepts a valid notebook backup', () => {
    expect(parseNotebookBackup(initialNotebook)).toEqual(initialNotebook)
  })

  it('rejects malformed items and executable image formats', () => {
    expect(() => parseNotebookBackup({ ...initialNotebook, items: [{}] })).toThrow()
    expect(() => parseNotebookBackup({
      ...initialNotebook,
      items: [{
        id: 'bad', status: 'inbox', exam: '', subject: '', chapter: '', question: '', answer: '', cause: '', note: '', tags: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        schedule: { due: new Date().toISOString(), stability: 1, difficulty: 5, reps: 0, lapses: 0 },
        images: [{ id: 'image', name: 'bad.svg', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=', rotation: 0, annotations: [] }],
      }],
    })).toThrow()
  })
})
