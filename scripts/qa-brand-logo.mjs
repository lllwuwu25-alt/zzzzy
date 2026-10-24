import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const require = createRequire('/Users/qichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')
const { chromium } = require('playwright')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:5174/')
  await page.getByRole('button', { name: '今日复习', exact: true }).waitFor()
  const logo = page.getByRole('img', { name: 'CommonKind', exact: true })
  assert.equal(await logo.count(), 1, 'Show the supplied CommonKind wordmark once')
  assert.equal(await page.locator('.brand-signature').evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', 'Wordmark must not have a background plate')
  const original = readFileSync(new URL('../src/assets/commonkind-logo.png', import.meta.url))
  const source = await page.request.get(new URL(await logo.getAttribute('src'), page.url()).href)
  const hash = bytes => createHash('sha256').update(bytes).digest('hex')
  assert.equal(hash(await source.body()), hash(original), 'Logo must use the supplied, unmodified image')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  for (const [id, name] of [['ink', '墨青'], ['mist', '雾白'], ['plum', '暮紫'], ['night', '夜读'], ['paint', '彩绘']]) {
    await page.getByRole('radio', { name, exact: true }).locator('..').click()
    await logo.evaluate(image => image.decode())
    await page.waitForTimeout(300)
    const bounds = await page.locator('.brand-signature').boundingBox(), sidebar = await page.locator('.sidebar').boundingBox()
    assert(bounds.width >= 150 && bounds.height >= 28 && bounds.height <= 46, 'Wordmark should be readable without square-image whitespace')
    assert(bounds.x >= sidebar.x && bounds.x + bounds.width <= sidebar.x + sidebar.width && bounds.y + bounds.height <= 900, 'Wordmark must stay in its original sidebar position')
    const snapshot = await page.screenshot({ clip: bounds })
    const pixels = await page.evaluate(async base64 => {
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
      const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0)
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
      let black = 0, white = 0
      for (let y = 1; y < canvas.height - 1; y++) for (let x = 1; x < canvas.width - 1; x++) {
        const i = (y * canvas.width + x) * 4
        if (Math.max(data[i], data[i + 1], data[i + 2]) < 8) black++
        if (Math.min(data[i], data[i + 1], data[i + 2]) > 250) white++
      }
      return { black, white, corner: Array.from(data.slice(0, 3)) }
    }, snapshot.toString('base64'))
    const background = await page.locator('.sidebar').evaluate(element => getComputedStyle(element).backgroundColor.match(/\d+/g).slice(0, 3).map(Number))
    if (['ink', 'plum', 'night'].includes(id)) {
      assert(pixels.white > 80 && pixels.black < 10, 'Dark sidebars need solid white lettering without a black center or outline')
    } else {
      assert(pixels.black > 80 && pixels.white < 10, 'Light sidebars need solid black lettering without a white outline')
    }
    assert(pixels.corner.every((channel, index) => Math.abs(channel - background[index]) <= 2), 'Lettering must blend into the existing sidebar without a background plate')
    await page.screenshot({ path: `/tmp/notebook-brand-${id}.png` })
  }
  await page.getByRole('button', { name: '收起导航', exact: true }).click()
  assert(!await logo.isVisible(), 'Collapsed navigation must not squeeze the full wordmark')
  await page.getByRole('button', { name: '展开导航', exact: true }).click()
  assert(await logo.isVisible())
  await page.setViewportSize({ width: 1280, height: 540 })
  const navigation = await page.getByRole('navigation', { name: '主要导航' }).boundingBox()
  const collapse = await page.getByRole('button', { name: '收起导航', exact: true }).boundingBox()
  assert(collapse.y >= navigation.y + navigation.height + 8, 'Footer controls must not overlap navigation in a short window')
  await logo.scrollIntoViewIfNeeded()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '打开导航', exact: true }).click()
  assert(await logo.isVisible(), 'Branding should remain visible in the mobile navigation drawer')
  assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), 'Branding must not cause horizontal overflow')
  await page.screenshot({ path: '/tmp/notebook-brand-mobile.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, themes: 5, originalUnmodified: true, collapsed: true, shortWindow: true, mobile: true }))
} finally { await browser.close() }
