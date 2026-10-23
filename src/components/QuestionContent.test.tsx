import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuestionContent } from './QuestionContent'

it('renders formulas in table cells and escapes active HTML', () => {
  const html = renderToStaticMarkup(<QuestionContent text={String.raw`| 表达式 | 数值 |
|---|---|
| $\frac{\pi}{12}$ | <img src=x onerror=alert(1)> |
| 其他 | ` + '`a` |'} />)
  expect(html).toContain('<mfrac>')
  expect(html).toContain('<code>a</code>')
  expect(html).not.toContain('<img')
  expect(html).toContain('&lt;img')
})

it('places native tables outside headings and keeps surrounding question text', () => {
  const html = renderToStaticMarkup(<QuestionContent headingFirst text={'数据如下：\n| 项目 | 值 |\n|---|---|\n| 甲 | 6 |\n\n求未知数的值。'} />)
  expect(html).toMatch(/<h1>.*数据如下：.*<\/h1>/)
  expect(html).not.toMatch(/<h1>[^]*<table[^]*<\/h1>/)
  expect(html).toContain('求未知数的值。')
})
