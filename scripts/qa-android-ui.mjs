// Optional browser smoke test. The bridge is doubled: NOT Android/Feishu acceptance.
// Requires Playwright and a separately started VITE_ANDROID_TEST=true dev server.
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const require = createRequire(process.env.PLAYWRIGHT_REQUIRE_FROM || resolve('package.json'))
const { chromium } = require('playwright')
const output = resolve(process.env.QA_OUTPUT_DIR || 'local-deliverables/android-ui-qa')
const width = Number(process.env.QA_VIEWPORT_WIDTH || 393)
if (!Number.isInteger(width) || width < 320 || width > 600) throw Error('QA_VIEWPORT_WIDTH must be 320–600')
const base = new URL(process.env.QA_BASE_URL || 'http://127.0.0.1:5178/')
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw Error('This synthetic native bridge is only for local UI testing')
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: process.env.QA_BROWSER_CHANNEL || 'chrome' })
try {
  const context = await browser.newContext({ viewport: { width, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
  await context.addInitScript(() => {
    globalThis.isTauri = true
    let notebook = null
    window.__QA_WRITES__ = 0
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      if (command === 'read_app_notebook') return notebook
      if (command === 'write_app_notebook') { notebook = args.contents; window.__QA_WRITES__++; return null }
      if (command === 'get_license_status') return { state: 'development', canWrite: true, machineCode: null, platform: 'android', purchaseCode: null, licenseId: null, message: 'synthetic UI bridge' }
      if (command === 'get_ai_settings') return { enabled: false, hasKey: false, model: 'deepseek-flash' }
      if (command === 'pick_android_images') return { images: [{ name: 'UI测试.png', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nS8AAAAASUVORK5CYII=' }], skipped: 0 }
      throw Error('Unexpected UI bridge command: ' + command)
    } }
  })
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  const noOverflow = async () => { if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Horizontal overflow at ' + width) }
  await page.goto(base.href, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '先测试本机录题与复习' }).click()
  const capture = await page.getByRole('button', { name: '相册录题' }).boundingBox()
  if (!capture || capture.width < 80 || capture.height > 48) throw Error('Squeezed capture button: ' + JSON.stringify(capture))
  await page.getByRole('button', { name: '相册录题' }).click()
  await page.getByRole('dialog').waitFor()
  await noOverflow()
  await page.screenshot({ path: resolve(output, `phone-${width}-import.png`), fullPage: true })
  await page.getByText('简答题', { exact: true }).click()
  if (!await page.getByRole('radio', { name: /简答题/ }).isChecked()) throw Error('Question type card did not select radio')
  await page.getByRole('button', { name: '创建 1 道错题' }).click()
  const writes = await page.evaluate(() => window.__QA_WRITES__)
  await page.getByRole('textbox', { name: '题干', exact: true }).fill('移动端布局回归：1 + 1 = ？')
  await page.waitForFunction(previous => window.__QA_WRITES__ > previous, writes)
  const remove = await page.getByRole('button', { name: '移到回收站', exact: true }).boundingBox()
  if (!remove || remove.width < 90 || remove.height > 48) throw Error('Squeezed organizer action: ' + JSON.stringify(remove))
  await page.getByText('已创建 1 道错题，可直接填写或使用 AI 辅助识别', { exact: true }).waitFor({ state: 'hidden' })
  await noOverflow()
  await page.screenshot({ path: resolve(output, `phone-${width}-organizer.png`), fullPage: true })
  if (errors.length) throw Error(JSON.stringify(errors))
  console.log(JSON.stringify({ width, capture, remove, overflow: false, pageErrors: 0, result: 'PASS — UI bridge doubled, not a physical Android test' }))
} finally { await browser.close() }
