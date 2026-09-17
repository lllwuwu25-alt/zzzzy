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

  it('migrates legacy mistakes to short answer records', () => {
    const stamp = new Date().toISOString()
    const restored = parseNotebookBackup({
      ...initialNotebook,
      items: [{
        id: 'legacy', status: 'ready', exam: '考研', subject: '数学', chapter: '极限',
        question: '旧题', answer: '旧答案', cause: '', note: '', tags: [], images: [],
        createdAt: stamp, updatedAt: stamp,
        schedule: { due: stamp, stability: 1, difficulty: 5, reps: 0, lapses: 0 },
      }],
    })
    expect(restored.items[0]).toMatchObject({
      questionType: 'short-answer',
      shortAnswer: { keyPoints: [] },
      answer: '旧答案',
    })
  })
})
