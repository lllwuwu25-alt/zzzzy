import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire('/Users/qichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')
const { chromium } = require('playwright')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto('http://127.0.0.1:5174/')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  for (const name of ['墨青', '雾白', '暮紫', '夜读', '彩绘']) {
    await page.getByRole('radio', { name, exact: true }).locator('..').click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: '收起导航', exact: true }).click()
    await page.waitForTimeout(300)
    await page.evaluate(async () => {
      document.querySelector('.nav-collapse').click()
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const animations = document.getAnimations().filter(animation => animation.effect?.target?.closest('.sidebar'))
      for (const animation of animations) animation.pause()
    })
    for (const time of [90, 140, 200]) {
      const frame = await page.evaluate(time => {
        for (const animation of document.getAnimations().filter(animation => animation.effect?.target?.closest('.sidebar'))) animation.currentTime = time
        return { opacity: Number(getComputedStyle(document.querySelector('.brand-signature')).opacity), background: getComputedStyle(document.querySelector('.sidebar')).backgroundColor.match(/\d+/g).slice(0, 3).map(Number) }
      }, time)
      assert(frame.opacity > 0 && frame.opacity < 1, 'Capture must exercise the partially faded rendering, not the final state')
      const screenshot = await page.locator('.brand-signature').screenshot({ animations: 'allow' })
      const corner = await page.evaluate(async base64 => {
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], { type: 'image/png' }))
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
        const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0)
        return Array.from(context.getImageData(1, 1, 1, 1).data).slice(0, 3)
      }, screenshot.toString('base64'))
      assert(corner.every((channel, index) => Math.abs(channel - frame.background[index]) <= 2), `${name}: animation exposed an image background; pixel ${corner}, sidebar ${frame.background}, opacity ${frame.opacity}`)
    }
    await page.evaluate(() => { for (const animation of document.getAnimations()) animation.finish() })
  }
  console.log(JSON.stringify({ passed: true, themes: 5, intermediateFrames: 15, intermediateFadeBackground: true }))
} finally { await browser.close() }
