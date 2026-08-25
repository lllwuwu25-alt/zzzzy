import type { Notebook } from './types'
export const initialNotebook: Notebook = {
  version: 1,
  workspaceName: '我的错题本',
  workspacePath: '',
  reviewSettings: {
    mode: 'adaptive',
    intervals: { again: 1, hard: 2, good: 4, easy: 7 },
  },
  taxonomy: { exams: [] },
  reviews: [],
  items: [],
}
