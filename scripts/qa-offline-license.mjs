import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { IssuerVault, machineCode } from '../tools/license-admin/core.mjs'
const require = createRequire('/Users/qichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')
const { chromium } = require('playwright')
const temporary = mkdtempSync(join(tmpdir(), 'ctb-license-browser-'))
let browser, vault
try {
  vault = IssuerVault.create(join(temporary, 'synthetic.vault.json'), 'synthetic-browser-test-password')
  const deviceId = '3'.repeat(64), { purchaseCode } = vault.createPurchase('Synthetic QA, not a customer')
  const certificate = JSON.stringify(vault.issue(purchaseCode, machineCode(deviceId), 'Synthetic desktop'))
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(({ code, purchaseCode, certificate }) => {
    const now = new Date().toISOString()
    const notebook = { version: 1, workspaceName: 'Synthetic license QA', taxonomy: { exams: [] }, reviewSettings: { mode: 'adaptive', intervals: { again: 1, hard: 2, good: 4, easy: 7 } }, reviews: [], items: [{ id: 'saved-item', status: 'ready', question: '原有题目：\n| 项目 | 值 |\n|---|---|\n| 甲 | 6 |', questionType: 'short-answer', answer: '原有答案', shortAnswer: { keyPoints: [] }, exam: '', subject: '', chapter: '', cause: '', note: '原有个人笔记', tags: [], images: [], createdAt: now, updatedAt: now, schedule: { due: '2020-01-01T00:00:00Z', reps: 0, stability: 1, difficulty: 5, lapses: 0 } }] }
    const required = { state: 'unactivated', canWrite: false, machineCode: code, platform: 'macos', purchaseCode: null, licenseId: null, message: '尚未激活。请把机器码发给卖家，获取本机永久离线授权。' }
    const active = { ...required, state: 'active', canWrite: true, purchaseCode, licenseId: 'synthetic-browser-license', message: '本机已获得永久离线授权，无需联网续期。' }
    const controls = { delayNextStatus: false, resolveStatus: null, writes: 0, exports: [] }
    window.__licenseTest = controls
    window.isTauri = true
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 1, unregisterCallback: () => {},
      invoke: async (command, args) => {
        if (command === 'get_license_status') {
          const current = localStorage.getItem('synthetic-license-active') ? active : required
          if (controls.delayNextStatus) { controls.delayNextStatus = false; return new Promise(resolve => { controls.resolveStatus = () => resolve(current) }) }
          return current
        }
        if (command === 'import_license') {
          if (args.contents !== certificate) throw '授权签名校验失败。原有授权和资料未被覆盖。'
          localStorage.setItem('synthetic-license-active', 'yes'); return active
        }
        if (command === 'read_app_notebook') return JSON.stringify(notebook)
        if (command === 'export_notebook_backup') { controls.exports.push(JSON.parse(args.contents)); return '/synthetic/backup.json' }
        if (command === 'export_license_request') { controls.exports.push({ machineCode: code }); return '/synthetic/request.json' }
        if (command === 'write_app_notebook' || command === 'write_workspace_notebook') { controls.writes++; if (!localStorage.getItem('synthetic-license-active')) throw '尚未激活'; return null }
        if (command === 'get_ai_settings') return { enabled: false, model: 'deepseek-flash', hasKey: false }
        if (command === 'plugin:event|listen') return 1
        if (command === 'plugin:event|unlisten') return null
        throw `Unexpected synthetic native call: ${command}`
      },
    }
  }, { code: machineCode(deviceId), purchaseCode, certificate })
  await page.goto('http://127.0.0.1:5174/')
  await page.getByRole('heading', { name: '把这台设备，变成你的学习工作台。' }).waitFor()
  assert.equal(await page.getByLabel('本机机器码').inputValue(), machineCode(deviceId))
  await page.getByRole('button', { name: '导出激活申请', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '激活申请已导出' }).waitFor()
  assert.equal(await page.evaluate(() => window.__licenseTest.exports[0].machineCode), machineCode(deviceId))
  await page.screenshot({ path: '/tmp/notebook-offline-activation.png', fullPage: true })
  await page.getByRole('button', { name: '查看与导出已有资料', exact: true }).click()
  await page.getByRole('table').waitFor()
  assert.equal(await page.getByRole('button', { name: '收录截图', exact: true }).count(), 0)
  await page.getByRole('button', { name: '导出完整备份', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '完整备份已导出' }).waitFor()
  const backup = await page.evaluate(() => window.__licenseTest.exports[1])
  assert.equal(backup.items[0].note, '原有个人笔记')
  assert(!JSON.stringify(backup).includes('synthetic-browser-license'))
  assert.equal(await page.evaluate(() => window.__licenseTest.writes), 0)
  await page.getByRole('button', { name: '返回激活', exact: true }).click()
  const input = page.getByLabel('选择授权文件', { exact: true })
  await input.setInputFiles({ name: 'bad.ctb-license.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
  await page.getByRole('alert').filter({ hasText: '签名校验失败' }).waitFor()
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), 'Activation overflows narrow window')
    await page.getByRole('button', { name: '导入授权文件', exact: true }).scrollIntoViewIfNeeded()
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  // Reproduce a delayed focus check arriving after a successful import.
  await page.evaluate(() => { window.__licenseTest.delayNextStatus = true; window.dispatchEvent(new Event('focus')) })
  await input.setInputFiles({ name: 'valid.ctb-license.json', mimeType: 'application/json', buffer: Buffer.from(certificate) })
  await page.getByRole('button', { name: '开始复习', exact: true }).waitFor()
  await page.evaluate(() => window.__licenseTest.resolveStatus?.())
  await page.waitForTimeout(200)
  assert(await page.getByRole('button', { name: '开始复习', exact: true }).isVisible(), 'Stale status overwrote successful activation')
  await page.reload(); await page.getByRole('button', { name: '开始复习', exact: true }).waitFor()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByText('已激活 · 永久离线', { exact: true }).waitFor()
  for (const skin of ['夜读', '彩绘']) {
    await page.getByRole('radio', { name: skin, exact: true }).locator('..').click()
    await page.getByRole('button', { name: '查看或导入授权', exact: true }).click()
    await page.waitForTimeout(250)
    await page.screenshot({ path: `/tmp/notebook-offline-activation-${skin}.png`, fullPage: true })
    await page.getByRole('button', { name: '返回工作台', exact: true }).click()
    await page.getByRole('button', { name: '设置', exact: true }).click()
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, ipcMock: true, readonlyExport: true, tamperedImport: true, staleStatus: true, reload: true, narrow: true, themes: true }))
} finally { await browser?.close(); vault?.close(); rmSync(temporary, { recursive: true, force: true }) }
