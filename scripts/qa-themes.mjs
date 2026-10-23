import { createRequire } from 'node:module'
const require = createRequire('/Users/qichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')
const { chromium } = require('playwright')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const assert = (condition, message) => { if (!condition) throw Error(message) }
const skins = [['ink', '墨青'], ['mist', '雾白'], ['plum', '暮紫'], ['night', '夜读'], ['paint', '彩绘']]
const errors = [], failures = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    if (localStorage.getItem('mistake-notebook-v1')) return
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 240
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 640, 240)
    ctx.fillStyle = '#234b63'; ctx.font = '28px sans-serif'; ctx.fillText('Synthetic table question', 24, 50)
    ctx.fillStyle = '#e5ac56'; ctx.fillRect(24, 85, 180, 100)
    const now = new Date().toISOString(), schedule = { due: '2020-01-01T00:00:00Z', stability: 1, difficulty: 5, reps: 0, lapses: 0 }
    const image = { id: 'theme-image', name: 'synthetic.png', dataUrl: canvas.toDataURL(), rotation: 0, annotations: [], editorVersion: 2, sourceWidth: 640, sourceHeight: 240 }
    const item = { id: 'theme-review', status: 'ready', exam: '主题测试', subject: '数学', chapter: '概率与统计', question: '请根据表格选择正确结论：\n| 项目 | 概率 |\n|---|---|\n| 甲 | $\\frac{1}{2}$ |\n| 乙 | $a$ |', questionType: 'choice', choice: { mode: 'single', options: [{ id: 'A', label: 'A', text: '$a=\\frac{1}{2}$' }, { id: 'B', label: 'B', text: '$a=1$' }], correctOptionIds: ['A'] }, answer: '', cause: '注意总概率为 1。', note: '', tags: ['待巩固'], images: [image], createdAt: now, updatedAt: now, schedule }
    localStorage.setItem('mistake-notebook-v1', JSON.stringify({ version: 1, workspaceName: '隔离主题测试', taxonomy: { exams: [{ name: '主题测试', subjects: [{ name: '数学', chapters: ['概率与统计'] }] }] }, reviewSettings: { mode: 'adaptive', intervals: { again: 1, hard: 2, good: 4, easy: 7 } }, items: [item, { ...item, id: 'theme-inbox', status: 'inbox', questionType: 'short-answer', choice: undefined, answer: '', shortAnswer: { keyPoints: [] } }], reviews: [{ id: 'theme-history', mistakeId: item.id, rating: 'good', answerText: 'A', reviewedAt: now, durationSeconds: 30, before: schedule, after: { ...schedule, reps: 1, stability: 3 } }] }))
  })
  await page.goto('http://127.0.0.1:5174/')
  await page.getByRole('button', { name: '开始复习', exact: true }).waitFor()
  async function navigate(name) {
    if (await page.getByRole('button', { name: '打开导航', exact: true }).isVisible()) await page.getByRole('button', { name: '打开导航', exact: true }).click()
    await page.getByRole('button', { name, exact: true }).click()
    await page.waitForTimeout(250)
  }
  async function audit(stage, scope = '.app-shell') {
    const findings = await page.evaluate(selector => {
      const root = document.querySelector(selector), issues = []
      const rgb = color => (color.match(/[\d.]+/g) ?? []).map(Number)
      const luminance = color => rgb(color).slice(0, 3).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0)
      function background(el) {
        for (let node = el; node; node = node.parentElement) {
          const color = getComputedStyle(node).backgroundColor, channels = rgb(color)
          if (channels.length === 3 || channels[3] === 1) return color
        }
        return 'rgb(255,255,255)'
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const text = walker.currentNode.textContent.trim(), el = walker.currentNode.parentElement
        if (!text || !el || el.closest('svg,math,[aria-hidden=true],:disabled,[aria-disabled=true],.theme-preview')) continue
        const rect = el.getBoundingClientRect(), style = getComputedStyle(el)
        if (rect.width < 2 || rect.height < 2 || rect.right <= 0 || rect.left >= innerWidth || rect.bottom <= 0 || rect.top >= innerHeight || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
        let faded = false; for (let node = el; node; node = node.parentElement) if (Number(getComputedStyle(node).opacity) < 1) faded = true
        if (faded) continue
        const values = [luminance(style.color), luminance(background(el))].sort((a, b) => b - a), ratio = (values[0] + .05) / (values[1] + .05)
        if (ratio < 4.5) issues.push({ text: text.slice(0, 35), ratio: +ratio.toFixed(2), color: style.color, background: background(el), class: el.className })
      }
      return issues
    }, scope)
    if (findings.length) failures.push({ stage, findings })
    assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), `${stage}: horizontal overflow`)
  }
  const original = await page.evaluate(async () => JSON.parse(await (await import('/src/lib/web-notebook-storage.ts')).readWebNotebook()).items[0].images[0].dataUrl)
  for (const [id, name] of skins) {
    await navigate('设置')
    await page.getByRole('radio', { name, exact: true }).locator('..').click()
    await page.waitForTimeout(250)
    assert(await page.locator('html').getAttribute('data-theme') === id, `${name} not applied`)
    await audit(`${id}: settings`)
    await page.screenshot({ path: `/tmp/notebook-theme-${id}-settings.png`, fullPage: true })
    await page.reload(); await page.getByRole('button', { name: '开始复习', exact: true }).waitFor(); await page.waitForTimeout(250)
    assert(await page.locator('html').getAttribute('data-theme') === id, `${name} not persisted after reload`)
    await audit(`${id}: home`)
    await page.screenshot({ path: `/tmp/notebook-theme-${id}.png`, fullPage: true })
    await page.getByRole('button', { name: '开始复习', exact: true }).click()
    const review = page.getByRole('dialog', { name: '专注复习' })
    await review.getByRole('table').waitFor(); await page.waitForTimeout(500)
    assert(await review.locator('mfrac').count() >= 2, `${name}: math rendering missing`)
    await audit(`${id}: review`, '.deck-card')
    await page.screenshot({ path: `/tmp/notebook-theme-${id}-review.png`, fullPage: true })
    await review.getByRole('button', { name: '显示答案', exact: true }).click()
    await page.waitForTimeout(250); await audit(`${id}: reveal`, '.deck-card')
    await page.getByRole('button', { name: '关闭复习卡片', exact: true }).click()
    await navigate('全部错题'); await audit(`${id}: library`)
    await page.locator('.table-row').first().click(); await audit(`${id}: detail`, '.drawer')
    await page.getByRole('button', { name: '关闭详情', exact: true }).click()
    await navigate('复习记录'); await audit(`${id}: history`)
    await navigate('收集箱'); await audit(`${id}: inbox`)
    await page.getByRole('button', { name: '标注', exact: true }).click()
    const editor = page.getByRole('dialog', { name: '图片标注器' })
    await editor.locator('canvas').waitFor(); await audit(`${id}: editor`, '.editor-overlay')
    assert(await editor.locator('canvas').evaluate(canvas => getComputedStyle(canvas).backgroundColor) === 'rgb(255, 255, 255)', 'Source canvas paper was recolored')
    await editor.getByRole('button', { name: '完成', exact: true }).click()
    const current = await page.evaluate(async () => JSON.parse(await (await import('/src/lib/web-notebook-storage.ts')).readWebNotebook()).items[0].images[0].dataUrl)
    assert(current === original, 'Theme changed original image data')
    await page.locator('.topbar input[type=file]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(original.split(',')[1], 'base64') })
    await page.getByRole('dialog').waitFor(); await audit(`${id}: import`, '.capture-dialog')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await navigate('设置'); await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('radio', { name, exact: true }).locator('..').scrollIntoViewIfNeeded(); await audit(`${id}: narrow settings`)
    await navigate('今日复习'); await page.getByRole('button', { name: '开始复习', exact: true }).click()
    await review.getByRole('table').waitFor()
    const box = await review.getByRole('button', { name: '显示答案', exact: true }).boundingBox()
    assert(box && box.y + box.height < 844, `${name}: narrow review actions hidden`)
    await page.getByRole('button', { name: '关闭复习卡片', exact: true }).click()
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  await navigate('设置')
  await page.getByRole('radio', { name: '墨青', exact: true }).focus(); await page.keyboard.press('ArrowRight')
  assert(await page.getByRole('radio', { name: '雾白', exact: true }).isChecked(), 'Native radio keyboard navigation failed')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('radio', { name: '彩绘', exact: true }).locator('..').click()
  assert(await page.locator('body').evaluate(el => getComputedStyle(el).transitionDuration) === '0s', 'Reduced motion ignored')
  await page.setViewportSize({ width: 720, height: 800 })
  await page.evaluate(() => { document.documentElement.style.zoom = '2' })
  await page.getByRole('radio', { name: '彩绘', exact: true }).locator('..').scrollIntoViewIfNeeded()
  assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), 'Settings overflow at 200% zoom')
  await page.screenshot({ path: '/tmp/notebook-theme-zoom.png', fullPage: true })
  await page.evaluate(() => { document.documentElement.style.zoom = '' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'notebook-theme') throw Error('synthetic denied preference'); return set.call(this, key, value) } })
  await page.getByRole('radio', { name: '夜读', exact: true }).locator('..').click()
  await page.getByText('已切换为夜读，但无法记住选择；请检查浏览器存储权限。', { exact: true }).waitFor()
  await navigate('今日复习'); await navigate('设置')
  assert(await page.getByRole('radio', { name: '夜读', exact: true }).isChecked(), 'Session appearance lost when storage was blocked')
  assert(!errors.length, JSON.stringify(errors))
  assert(!failures.length, JSON.stringify(failures, null, 2))
  console.log(JSON.stringify({ passed: true, skins: 5, pages: 8, persistence: true, contrast: true, keyboard: true, reducedMotion: true, narrow: true, imagesUnchanged: true, storageWarning: true }))
} finally { await browser.close() }
