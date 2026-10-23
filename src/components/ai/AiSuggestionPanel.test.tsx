import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AiSuggestionPanel } from './AiSuggestionPanel'

it('renders an existing flattened table as readable rows and columns', () => {
  const value = '| “一”与其后面一个字（或标点）的搭配情况 | 频数 | |---|---| | “一个” | 6 | | “一些” | 4 | | “一穷” | 2 | | “一条” | 2 | | 其他 | `a` |'
  const html = renderToStaticMarkup(<AiSuggestionPanel images={[]} suggestions={[{ key: 'question', label: '题干', before: '', value, conflict: false }]} model="test" canUndo={false} onApply={() => {}} onUndo={() => {}} onDismiss={() => {}} />)
  expect(html).toContain('<table')
  expect(html.match(/<tr>/g)).toHaveLength(6)
  expect(html.match(/<td[ >]/g)).toHaveLength(10)
  expect(html).not.toContain('|---|')
  expect(html).not.toContain('`a`')
})

it('keeps option labels and correctness markers outside table rows in suggestions', () => {
  const value = { mode: 'single', correctOptionIds: ['A'], options: [
    { id: 'A', label: 'A', text: '| X | P(X) |\n|---|---|\n| 0 | 0.5 |' },
    { id: 'B', label: 'B', text: '| X | P(X) |\n|---|---|\n| 1 | 0.25 |' },
  ] }
  const html = renderToStaticMarkup(<AiSuggestionPanel images={[]} suggestions={[{ key: 'choice', label: '选项', before: '', value, conflict: false }]} model="test" canUndo={false} onApply={() => {}} onUndo={() => {}} onDismiss={() => {}} />)
  expect(html.match(/<table>/g)).toHaveLength(2)
  expect(html.match(/<td[ >]/g)).toHaveLength(4)
  expect(html).not.toContain('|---|')
  expect(html).toContain('A. ✓')
})
