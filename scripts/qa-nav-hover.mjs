import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
const require = createRequire('/Users/qichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')
const { chromium } = require('playwright')
const { PNG } = require('pngjs')
const output = '/private/tmp/notebook-nav-hover-qa'
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
  await page.goto(process.env.NOTEBOOK_QA_URL || 'http://127.0.0.1:5176/')
  const inbox = page.getByRole('button', { name: '收集箱', exact: true })
  await inbox.click()
  const selection = page.locator('.nav-selection')
  for (const theme of ['paint', 'ink', 'mist', 'plum', 'night']) {
    await page.evaluate(async theme => (await import('/src/lib/themes.ts')).applyTheme(theme), theme)
    await page.mouse.move(900, 70)
    await page.waitForTimeout(300)
    const border = await selection.evaluate(el => getComputedStyle(el).borderTopColor.match(/\d+/g).slice(0, 3).map(Number))
    for (const state of ['idle', 'hover']) {
      if (state === 'hover') { await inbox.hover(); await page.waitForTimeout(200) }
      const png = PNG.sync.read(await selection.screenshot({ path: `${output}/${theme}-${state}.png` }))
      for (const [edge, y] of [['top', 0], ['bottom', png.height - 1]]) {
        let visible = 0, samples = 0
        for (let x = Math.floor(png.width * .25); x < png.width * .75; x++) {
          const offset = (y * png.width + x) * 4
          if (border.every((channel, i) => Math.abs(channel - png.data[offset + i]) <= 4)) visible++
          samples++
        }
        assert(visible / samples > .9, `${theme} ${state}: ${edge} border is covered (${visible}/${samples} visible)`)
      }
    }
    // Hover feedback on an unselected item remains present.
    const library = page.getByRole('button', { name: '全部错题', exact: true })
    await page.mouse.move(900, 70)
    await page.waitForTimeout(200)
    const idle = await library.evaluate(el => getComputedStyle(el).backgroundColor)
    await library.hover(); await page.waitForTimeout(200)
    assert.notEqual(await library.evaluate(el => getComputedStyle(el).backgroundColor), idle)
  }
  await page.evaluate(async () => (await import('/src/lib/themes.ts')).applyTheme('paint'))
  await inbox.hover(); await page.waitForTimeout(300)
  await page.screenshot({ path: `${output}/paint-sidebar.png`, clip: { x: 0, y: 0, width: 216, height: 860 } })
  console.log(JSON.stringify({ passed: true, skins: 5, topAndBottomEdges: true, unselectedHover: true, output }))
} finally { await browser.close() }
