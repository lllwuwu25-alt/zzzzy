import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire('/Users/qichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')
const { chromium } = require('playwright')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto('http://127.0.0.1:5174/')
  await page.getByRole('button', { name: '收起导航', exact: true }).click()
  await page.waitForTimeout(300)
  const samples = await page.evaluate(() => new Promise(resolve => {
    const frames = [], start = performance.now()
    document.querySelector('.nav-collapse').click()
    function sample() {
      const sidebar = document.querySelector('.sidebar').getBoundingClientRect()
      const footer = document.querySelector('.sidebar-footer').getBoundingClientRect()
      const button = document.querySelector('.nav-collapse').getBoundingClientRect()
      frames.push({ time: Math.round(performance.now() - start), width: +sidebar.width.toFixed(1), footerHeight: +footer.height.toFixed(1), buttonY: +button.y.toFixed(1) })
      if (performance.now() - start < 350) requestAnimationFrame(sample)
      else resolve(frames)
    }
    requestAnimationFrame(sample)
  }))
  const stable = samples.at(-1)
  assert(samples.every(frame => Math.abs(frame.buttonY - stable.buttonY) <= .15), 'Collapse control must not jump vertically while expanding the sidebar')
  assert(samples.every(frame => Math.abs(frame.footerHeight - stable.footerHeight) <= 1), 'Footer content must not wrap and resize during sidebar expansion')
  const rapid = await page.evaluate(async () => {
    const heights = []
    for (let i = 0; i < 8; i++) {
      document.querySelector('.nav-collapse').click()
      await new Promise(resolve => setTimeout(resolve, 35))
      heights.push(document.querySelector('.sidebar-footer').getBoundingClientRect().height)
    }
    return heights
  })
  assert(Math.max(...rapid) - Math.min(...rapid) <= 1, 'Rapid toggles must preserve footer geometry')
  await page.waitForTimeout(300)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: '收起导航', exact: true }).focus()
  await page.keyboard.press('Enter')
  assert.equal(Math.round((await page.locator('.sidebar').boundingBox()).width), 72)
  await page.keyboard.press('Enter')
  assert.equal(Math.round((await page.locator('.sidebar').boundingBox()).width), 216)
  assert(await page.getByRole('button', { name: '收起导航', exact: true }).evaluate(button => button === document.activeElement), 'Keyboard focus must remain on the toggle')
  console.log(JSON.stringify({ passed: true, expansionFrames: samples.length, rapidToggle: true, keyboard: true, reducedMotion: true }))
} finally { await browser.close() }
