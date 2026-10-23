import { describe, expect, it } from 'vitest'
import { hasQuestionTable, parseQuestionContent, questionSummary } from './question-content'

describe('question tables', () => {
  it('keeps table markup out of compact list and animation titles', () => {
    expect(questionSummary('| 搭配情况 | 频数 | |---|---| | “一个” | 6 |')).toBe('表格题：搭配情况 / 频数')
    expect(questionSummary('统计频数如下：\n| 名称 | 值 |\n|---|---|\n|甲|6|')).toBe('统计频数如下：')
    expect(questionSummary('求极限')).toBe('求极限')
  })
  it('recovers the supplied one-line frequency table without changing values', () => {
    expect(parseQuestionContent('| 搭配情况 | 频数 | |---|---| | “一个” | 6 | | “一些” | 4 | | 其他 | `a` |')).toEqual([{ type: 'table', headers: ['搭配情况', '频数'], rows: [['“一个”', '6'], ['“一些”', '4'], ['其他', '`a`']], alignments: ['left', 'left'] }])
  })
  it('keeps adjacent collapsed tables separate', () => {
    const tables = parseQuestionContent('| H | N | |---|---| | A | 6 | | H2 | N2 | |---|---| | B | 2 |')
    expect(tables).toEqual([
      { type: 'table', headers: ['H', 'N'], rows: [['A', '6']], alignments: ['left', 'left'] },
      { type: 'table', headers: ['H2', 'N2'], rows: [['B', '2']], alignments: ['left', 'left'] },
    ])
  })
  it('keeps surrounding paragraphs and multiple tables in the original order', () => {
    const blocks = parseQuestionContent('数据如下：| 类别 | 数值 | |---|---| | 甲 | 6 | 求 a 的值。\n\n第二表\n名称 | 概率\n--- | ---:\n乙 | $1/2$\n\n继续作答')
    expect(blocks.map(block => block.type)).toEqual(['text', 'table', 'text', 'table', 'text'])
    expect(blocks[0]).toMatchObject({ text: '数据如下：' })
    expect(blocks[2]).toMatchObject({ text: expect.stringContaining('求 a 的值。') })
    expect(blocks[3]).toMatchObject({ headers: ['名称', '概率'], alignments: ['left', 'right'] })
    expect(blocks[4]).toMatchObject({ text: expect.stringContaining('继续作答') })
  })
  it('does not split formula bars, code, escaped pipes or emoji-prefixed cells', () => {
    const blocks = parseQuestionContent('| 表达式 | 值 |\n|---|---|\n| $|x|$ | 2 |\n| `a|b` | 3 |\n| 😀甲\\|乙 | $\\|v\\|$ |')
    expect(blocks[0]).toMatchObject({ rows: [['$|x|$', '2'], ['`a|b`', '3'], ['😀甲|乙', '$\\|v\\|$']] })
  })
  it('preserves empty cells, alignment and a single-column table', () => {
    expect(parseQuestionContent('| A | B |\n|:---|:---:|\n| | 2 |')[0]).toMatchObject({ rows: [['', '2']], alignments: ['left', 'center'] })
    expect(parseQuestionContent('| 结论 |\n|---|\n| 保留 |')[0]).toMatchObject({ headers: ['结论'], rows: [['保留']] })
  })
  it('leaves prose pipes and incomplete or inconsistent table syntax readable', () => {
    expect(hasQuestionTable('P(A|B)，x | y')).toBe(false)
    expect(hasQuestionTable('| A | B |\n|---|')).toBe(false)
    const blocks = parseQuestionContent('| A | B |\n|---|---|\n| 保留 |\n下一段')
    expect(blocks[1]).toMatchObject({ type: 'text', text: '| 保留 |\n下一段' })
  })
})
