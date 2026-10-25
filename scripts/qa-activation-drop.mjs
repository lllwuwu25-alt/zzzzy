// Browser integration only: native IPC is simulated. Rust tests verify the compiled ACL.
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const require = createRequire('/Users/qichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')
const { chromium } = require('playwright')
const base = process.env.NOTEBOOK_QA_URL || 'http://127.0.0.1:5176/'
const output = '/private/tmp/notebook-activation-drop-qa'
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1380, height: 860 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const controls = { callbacks: new Map(), listeners: new Map(), next: 0, reads: [], writes: [] }
    window.__dropQa = controls
    const notebook = { version: 1, workspaceName: '', items: [], reviews: [], taxonomy: { exams: [] }, reviewSettings: { mode: 'adaptive', intervals: { again: 1, hard: 2, good: 4, easy: 7 } } }
    window.isTauri = true
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_event, id) => controls.listeners.delete(id) }
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: callback => { const id = ++controls.next; controls.callbacks.set(id, callback); return id },
      unregisterCallback: id => controls.callbacks.delete(id),
      invoke: async (command, args) => {
        if (command === 'get_license_status') return { state: localStorage.getItem('qa-active') ? 'active' : 'unactivated', canWrite: !!localStorage.getItem('qa-active'), machineCode: 'CTB1-' + Array(8).fill('11111111').join('-'), platform: 'macos', purchaseCode: 'synthetic', licenseId: 'synthetic', message: '离线授权测试' }
        if (command === 'read_app_notebook') return JSON.stringify(notebook)
        if (command === 'get_ai_settings') return { enabled: false, model: 'deepseek-flash', hasKey: false }
        if (command === 'plugin:event|listen') { const id = ++controls.next; controls.listeners.set(id, args); return id }
        if (command === 'plugin:event|unlisten') { controls.listeners.delete(args.eventId); return null }
        if (command === 'read_dropped_images') {
          controls.reads.push(args.paths)
          return { images: args.paths.filter(path => path.endsWith('.png')).map(path => ({ name: path.split('/').at(-1), dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nS8AAAAASUVORK5CYII=' })), skipped: args.paths.filter(path => !path.endsWith('.png')).length }
        }
        if (command === 'write_app_notebook' || command === 'write_workspace_notebook') { controls.writes.push(JSON.parse(args.contents)); return null }
        throw Error(`Unexpected QA call: ${command}`)
      },
    }
    controls.emit = (event, payload) => {
      for (const [id, listener] of [...controls.listeners]) if (listener.event === event) controls.callbacks.get(listener.handler)?.({ event, id, payload })
    }
  })
  await page.goto(base)
  const qr = page.getByAltText('客服微信二维码', { exact: true })
  await qr.waitFor()
  assert(await qr.evaluate(image => image.complete && image.naturalWidth === 776))
  const asset = await (await page.request.get(new URL(await qr.getAttribute('src'), base).href)).body()
  assert.equal(createHash('sha256').update(asset).digest('hex'), createHash('sha256').update(readFileSync(new URL('../src/assets/customer-wechat-qr.png', import.meta.url))).digest('hex'))
  for (const [theme, width] of [['ink', 1380], ['night', 900], ['paint', 390]]) {
    await page.evaluate(async theme => (await import('/src/lib/themes.ts')).applyTheme(theme), theme)
    await page.setViewportSize({ width, height: 860 })
    await page.waitForTimeout(350) // Allow the existing theme color transition to settle.
    assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
    assert(await qr.evaluate(image => getComputedStyle(image).filter === 'none' && getComputedStyle(image).backgroundColor === 'rgb(255, 255, 255)'))
    await page.screenshot({ path: `${output}/activation-${theme}.png`, fullPage: true })
  }
  await page.evaluate(() => localStorage.setItem('qa-active', 'yes'))
  await page.setViewportSize({ width: 1380, height: 860 })
  await page.reload()
  await page.getByRole('button', { name: '收录截图', exact: true }).waitFor()
  await page.waitForFunction(() => window.__dropQa.listeners.size === 4)
  assert.equal(await page.getByText(/图片拖入暂不可用/).count(), 0)
  const emit = (event, paths) => page.evaluate(({ event, paths }) => window.__dropQa.emit(event, { paths, position: { x: 30, y: 30 } }), { event, paths })
  await emit('tauri://drag-enter', ['/synthetic/first.png'])
  await page.getByText('松开后选择分组与题型', { exact: true }).waitFor()
  await emit('tauri://drag-leave', [])
  await emit('tauri://drag-drop', ['/synthetic/first.png', '/synthetic/second.png', '/synthetic/notes.txt'])
  await page.getByRole('heading', { name: '这些图片应当怎样组成题目？' }).waitFor()
  await page.getByText('已跳过 1 个不支持的文件').waitFor()
  await page.getByRole('button', { name: /拆成 2 题/ }).click()
  const groups = page.locator('.import-type-group')
  await groups.nth(0).getByRole('radio', { name: /选择题/ }).locator('..').click()
  await groups.nth(1).getByRole('radio', { name: /填空题/ }).locator('..').click()
  assert(await groups.nth(0).getByRole('radio', { name: /选择题/ }).isChecked())
  assert(await groups.nth(1).getByRole('radio', { name: /填空题/ }).isChecked())
  await page.getByRole('button', { name: '创建 2 道错题', exact: true }).click()
  await page.getByText('已创建 2 道错题，可直接填写或使用 AI 辅助识别', { exact: true }).waitFor()
  const saved = await page.evaluate(() => window.__dropQa.writes.at(-1))
  assert.deepEqual(saved.items.map(item => item.questionType).sort(), ['choice', 'fill-blank'])
  assert.equal(saved.items.length, 2)
  await emit('tauri://drag-drop', ['/synthetic/third.png'])
  await page.getByRole('heading', { name: '选择这道题的题型' }).waitFor()
  await page.getByRole('dialog').getByRole('radio', { name: /简答题/ }).locator('..').click()
  await page.getByRole('button', { name: '创建 1 道错题', exact: true }).click()
  await page.getByText('已创建 1 道错题，可直接填写或使用 AI 辅助识别', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.__dropQa.writes.at(-1).items.length), 3)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, ipcSimulated: true, qrOriginalBytes: true, themes: 3, singleDrop: true, multiSplit: true, mixedFiles: true, strictModeListenerCount: 4, output }))
} finally { await browser.close() }
