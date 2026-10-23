import { createRequire } from 'node:module'
const require = createRequire('/Users/qichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')
const { chromium } = require('playwright')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const flat = '| “一”与其后面一个字（或标点）的搭配情况 | 频数 | |---|---| | “一个” | 6 | | “一些” | 4 | | “一穷” | 2 | | “一条” | 2 | | 其他 | `a` |'
const question = `统计“一”与其后面一个字的搭配情况，数据如下：\n${flat}\n求 $a$ 的值，并估计概率。`
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://api.deepseek.com/**', route => route.fulfill({ json: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ questionType: 'short-answer', question, answer: '', shortAnswer: { keyPoints: [] }, figures: [] }) } }] } }))
  await page.goto('http://127.0.0.1:5174/')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByLabel('启用联网辅助识别').check()
  await page.getByPlaceholder('输入你的 DeepSeek API Key').fill('synthetic-table-qa-key')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await page.getByText('设置已保存。点击 AI 辅助识别时发送图片。').waitFor()
  await page.locator('.topbar input[type=file]').setInputFiles('/var/folders/r8/j45pmbks5n168_sgwfd3nhsh0000gn/T/codex-clipboard-4afcb432-80f9-4be2-93f5-efa6aa285a24.png')
  await page.getByRole('dialog').locator('.question-type-options label').filter({ hasText: '简答题' }).click()
  await page.getByRole('button', { name: '创建 1 道错题', exact: true }).click()
  await page.getByRole('button', { name: 'AI 辅助识别', exact: true }).click()
  const suggestions = page.getByRole('region', { name: 'AI 识别建议' })
  await suggestions.getByRole('table').waitFor()
  assert(await suggestions.getByRole('row').count() === 6, 'AI suggestion table is missing rows')
  assert(!(await suggestions.innerText()).includes('|---|'), 'AI suggestion exposes flattened table markup')
  await page.getByRole('button', { name: '采用非冲突建议', exact: true }).click()
  const questionField = page.locator('.rich-text-field').filter({ has: page.getByRole('button', { name: '编辑题干文字', exact: true }) })
  await questionField.getByRole('table').waitFor()
  assert(!await page.getByRole('textbox', { name: '题干', exact: true }).count(), 'Default editing view still exposes table source')
  assert(await page.getByPlaceholder('输入参考答案或解题思路').inputValue() === '', 'Missing answer was invented')
  await page.screenshot({ path: '/tmp/notebook-table-inbox.png', fullPage: true })
  await page.getByRole('button', { name: '编辑题干文字', exact: true }).click()
  const editor = page.getByRole('textbox', { name: '题干', exact: true }), source = await editor.inputValue()
  assert(source.includes('\n| “一个” | 6 |'), 'Editing source has no row boundaries')
  await editor.fill(source.replace('| “一个” | 6 |', '| “一个” | 7 |'))
  await page.getByRole('button', { name: '查看题干排版', exact: true }).click()
  assert(await page.locator('.rich-field-preview tbody tr').first().locator('td').last().innerText() === '7', 'Edited table value was not retained')
  await page.getByPlaceholder('输入参考答案或解题思路').fill(String.raw`| X | P(X) |
|---|---|
| 0 | $\frac{1}{2}$ |`)
  await page.getByRole('button', { name: '查看参考答案 / 解题思路排版', exact: true }).click()
  await page.getByRole('button', { name: '完成并整理下一题' }).click()
  await page.getByText('收集箱已经整理干净').waitFor()
  await page.getByRole('button', { name: '全部错题', exact: true }).click()
  await page.locator('.table-row').first().click()
  await page.getByRole('dialog', { name: '错题详情' }).getByRole('table').first().waitFor()
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.getByRole('button', { name: '今日复习', exact: true }).click()
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '专注复习' })
  await dialog.getByRole('table').waitFor()
  assert(await dialog.locator('tbody tr').first().locator('td').last().innerText() === '7', 'Saved table changed on review')
  await page.waitForTimeout(500)
  await page.screenshot({ path: '/tmp/notebook-table-review.png', fullPage: true })
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 })
    assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), `Page overflow at ${width}`)
    const action = await dialog.getByRole('button', { name: '显示答案', exact: true }).boundingBox()
    assert(action && action.y + action.height <= 844, 'Review actions moved outside viewport')
  }
  await dialog.getByRole('button', { name: '显示答案', exact: true }).click()
  assert(await dialog.getByRole('table').count() === 2, 'Reference-answer table was not rendered')
  assert(await dialog.locator('.answer-text mfrac').count() === 1, 'Table formula failed to render')
  await page.screenshot({ path: '/tmp/notebook-table-review-narrow.png', fullPage: true })
  assert(!errors.length, errors.join('\n'))
  const choicePage = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  choicePage.on('pageerror', error => errors.push(error.message))
  await choicePage.addInitScript(() => {
    if (localStorage.getItem('mistake-notebook-v1')) return
    const now = new Date().toISOString()
    localStorage.setItem('mistake-notebook-v1', JSON.stringify({ version: 1, workspaceName: '独立选项表格测试', taxonomy: { exams: [] }, reviewSettings: { mode: 'adaptive', intervals: { again: 1, hard: 2, good: 4, easy: 7 } }, reviews: [], items: [{
      id: 'table-choice', status: 'inbox', question: '选择正确的分布表。', questionType: 'choice', answer: '',
      choice: { mode: 'single', correctOptionIds: ['A'], options: [{ id: 'A', label: 'A', text: '| X | P(X) |\n|---|---|\n| 0 | 0.5 |' }, { id: 'B', label: 'B', text: '普通选项' }] },
      exam: '', subject: '', chapter: '', cause: '', note: '', tags: [], images: [], createdAt: now, updatedAt: now,
      schedule: { due: '2020-01-01T00:00:00Z', reps: 0, stability: 1, difficulty: 5, lapses: 0 },
    }] }))
  })
  await choicePage.goto('http://127.0.0.1:5174/')
  await choicePage.getByRole('button', { name: '收集箱', exact: true }).click()
  await choicePage.getByRole('button', { name: '编辑选项 A文字', exact: true }).click()
  const optionEditor = choicePage.getByRole('textbox', { name: '选项 A', exact: true })
  assert((await optionEditor.inputValue()).includes('\n| 0 | 0.5 |'), 'Option source is not multiline')
  await optionEditor.fill((await optionEditor.inputValue()).replace('0.5', '0.25'))
  await choicePage.getByRole('button', { name: '查看选项 A排版', exact: true }).click()
  assert(await choicePage.getByRole('cell', { name: '0.25', exact: true }).count() === 1, 'Option edit not previewed')
  await choicePage.getByRole('button', { name: '完成并整理下一题' }).click()
  await choicePage.getByRole('button', { name: '今日复习', exact: true }).click()
  await choicePage.getByRole('button', { name: '开始复习', exact: true }).click()
  const choiceDialog = choicePage.getByRole('dialog', { name: '专注复习' })
  await choiceDialog.getByRole('table').waitFor()
  await choiceDialog.getByRole('radio', { name: '选项 A', exact: true }).check()
  assert(await choiceDialog.getByRole('radio', { name: '选项 A', exact: true }).isChecked(), 'Table option cannot be selected')
  for (const width of [1280, 390]) {
    await choicePage.setViewportSize({ width, height: 844 })
    assert(!await choicePage.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), 'Choice table overflows page')
    const action = await choiceDialog.getByRole('button', { name: '显示答案', exact: true }).boundingBox()
    assert(action && action.y + action.height <= 844, 'Choice action outside viewport')
  }
  await choicePage.screenshot({ path: '/tmp/notebook-table-choice.png', fullPage: true })
  await choiceDialog.getByRole('button', { name: '显示答案', exact: true }).click()
  assert(await choiceDialog.locator('.structured-answer table').count() === 1, 'Table option missing on reveal')
  assert(!errors.length, errors.join('\n'))
  console.log(JSON.stringify({ passed: true, aiTable: true, legacyOneLine: true, editable: true, detail: true, review: true, cellMath: true, narrow: true, optionTables: true }))
} finally { await browser.close() }
