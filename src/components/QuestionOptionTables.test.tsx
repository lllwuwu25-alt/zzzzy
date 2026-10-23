import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuestionAnswerInput } from './QuestionAnswerInput'
import { QuestionTypeFields } from './QuestionTypeFields'
import type { Mistake } from '../types'

const item: Mistake = {
  id: 'table-choice', questionType: 'choice', answer: '',
  status: 'ready', question: '选择正确的分布表', exam: '', subject: '', chapter: '',
  cause: '', note: '', tags: [], images: [],
  createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z',
  schedule: { due: '2026-10-23T00:00:00.000Z', stability: 1, difficulty: 5, reps: 0, lapses: 0 },
  choice: { mode: 'single', correctOptionIds: [], options: [
    { id: 'A', label: 'A', text: '| X | P(X) |\n|---|---|\n| 0 | 0.5 |' },
    { id: 'B', label: 'B', text: '普通选项' },
  ] },
}

it('shows choice-option tables before revealing the answer', () => {
  const html = renderToStaticMarkup(<QuestionAnswerInput item={item} value="" onChange={() => {}} />)
  expect(html).toContain('<table>')
  expect(html).toContain('type="radio"')
  expect(html).not.toContain('|---|')
  for (const [label] of html.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/g)) expect(label).not.toContain('<table>')
  expect(html).toContain('普通选项')
})

it('offers formatted preview and multiline editing for a table option', () => {
  const html = renderToStaticMarkup(<QuestionTypeFields item={item} onPatch={() => {}} />)
  expect(html).toContain('<table>')
  expect(html).toContain('编辑选项 A文字')
  expect(html).not.toContain('|---|')
})
