import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { IssuerVault, machineCode } from '../tools/license-admin/core.mjs'
const require = createRequire('/Users/qichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')
const { _electron } = require('playwright')
const root = resolve(import.meta.dirname, '..'), temporary = mkdtempSync(join(tmpdir(), 'ctb-desktop-gui-qa-'))
const executablePath = process.env.CTB_ISSUER_EXECUTABLE || join(root, 'tools/license-desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const password = 'synthetic-desktop-qa-not-production'
const code = n => machineCode(n.toString(16).padStart(64, '0'))
let app
async function launch() {
  app = await _electron.launch({ executablePath, timeout: 20000, args: [...(process.env.CTB_ISSUER_EXECUTABLE ? [] : [join(root, 'tools/license-desktop')]), `--user-data-dir=${join(temporary, 'profile')}`] })
  const page = await app.firstWindow()
  await page.getByRole('heading', { name: '错题本发码器', exact: true }).waitFor()
  page.setDefaultTimeout(10000)
  return page
}
// Only the QA main-process debugger supplies native dialog choices; production has no test IPC or flag.
async function saveTo(path) {
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => path ? ({ canceled: false, filePath: path }) : ({ canceled: true }) }, path)
}
async function openFrom(path) {
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => path ? ({ canceled: false, filePaths: [path] }) : ({ canceled: true, filePaths: [] }) }, path)
}
try {
  let page = await launch()
  const security = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    return { preferences: win.webContents.getLastWebPreferences(), version: process.versions.electron }
  })
  assert(security.preferences.sandbox && security.preferences.contextIsolation && !security.preferences.nodeIntegration)
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  assert.equal(await page.evaluate(() => window.issuer.invoke), undefined)
  await assert.rejects(page.evaluate(() => fetch('https://example.invalid')))
  if (process.argv.includes('--smoke')) { console.log(JSON.stringify({ passed: true, runtime: security.version, nativeWindow: true, isolatedBridge: true })); }
  else {
    const vaultPath = join(temporary, 'qa.vault.json')
    await page.getByRole('button', { name: '创建加密保险库', exact: true }).click()
    await page.getByLabel('设置密码', { exact: true }).fill('short')
    await page.getByLabel('再次输入密码', { exact: true }).fill('different')
    await page.getByLabel('我确认首次创建，并会分别备份保险库和密码').check()
    await page.getByRole('button', { name: '选择位置并创建', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: /12|一致/ }).waitFor()
    assert(!existsSync(vaultPath))
    await page.getByLabel('设置密码', { exact: true }).fill(password)
    await page.getByLabel('再次输入密码', { exact: true }).fill(password)
    await saveTo(vaultPath)
    await page.getByRole('button', { name: '选择位置并创建', exact: true }).click()
    await page.getByRole('heading', { name: '购买记录', exact: true }).waitFor()
    assert.equal(await page.locator('input[type=password]').count(), 0)
    await page.getByLabel('订单备注', { exact: true }).fill('合成 GUI 测试订单')
    await page.getByRole('button', { name: '新建购买记录', exact: true }).click()
    await page.getByText('已签发 0/2 台', { exact: true }).waitFor()
    const request = join(temporary, 'request.json')
    writeFileSync(request, JSON.stringify({ version: 1, product: 'mistake-notebook', machineCode: code(1), platform: 'macos' }))
    await openFrom(request)
    await page.getByRole('button', { name: '导入激活申请', exact: true }).click()
    assert.equal(await page.getByLabel('用户机器码', { exact: true }).inputValue(), code(1))
    await saveTo(null)
    await page.getByRole('button', { name: '签发并导出', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '已取消' }).waitFor()
    await page.getByText('已签发 0/2 台', { exact: true }).waitFor()
    const license = join(temporary, 'first.json')
    await saveTo(license)
    await page.getByRole('button', { name: '签发并导出', exact: true }).click()
    await page.getByText('已签发 1/2 台', { exact: true }).waitFor()
    const first = readFileSync(license, 'utf8')
    const retry = join(temporary, 'retry.json'); await saveTo(retry)
    await page.getByRole('button', { name: '重新导出', exact: true }).click()
    await page.getByRole('status').filter({ hasText: retry }).waitFor()
    assert.equal(readFileSync(retry, 'utf8'), first)
    const conflict = join(temporary, 'existing.json'); writeFileSync(conflict, 'important existing file')
    await page.getByLabel('用户机器码', { exact: true }).fill(code(1))
    await saveTo(conflict)
    await page.getByRole('button', { name: '签发并导出', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '没有覆盖' }).waitFor()
    assert.equal(readFileSync(conflict, 'utf8'), 'important existing file')
    await page.getByText('已签发 1/2 台', { exact: true }).waitFor()
    await saveTo(join(temporary, 'recovered.json'))
    await page.getByRole('button', { name: '签发并导出', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'recovered.json' }).waitFor()
    assert.equal(readFileSync(join(temporary, 'recovered.json'), 'utf8'), first)
    await page.getByLabel('用户机器码', { exact: true }).fill(code(2))
    await saveTo(join(temporary, 'second.json'))
    await page.getByRole('button', { name: '签发并导出', exact: true }).click()
    await page.getByText('已签发 2/2 台', { exact: true }).waitFor()
    await page.getByLabel('用户机器码', { exact: true }).fill(code(3))
    await saveTo(join(temporary, 'third.json'))
    await page.getByRole('button', { name: '签发并导出', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '两台' }).waitFor()
    assert(!existsSync(join(temporary, 'third.json')))
    await page.getByRole('button', { name: '人工换机', exact: true }).first().click()
    await page.getByText('旧离线授权不能远程撤销', { exact: true }).waitFor()
    await page.getByLabel('新机器码', { exact: true }).fill(code(3))
    await page.getByLabel('换机原因', { exact: true }).fill('合成测试换机')
    await page.getByRole('button', { name: '确认换机并导出', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '确认' }).waitFor()
    await page.getByLabel('我理解旧设备上的离线授权仍可能继续使用').check()
    await saveTo(join(temporary, 'replacement.json'))
    await page.getByRole('button', { name: '确认换机并导出', exact: true }).click()
    await page.getByText('换机历史 · 1 条', { exact: true }).waitFor()
    await saveTo(join(temporary, 'public.json'))
    await page.getByRole('button', { name: '导出发行公钥', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'public.json' }).waitFor()
    await saveTo(join(temporary, 'backup.vault.json'))
    await page.getByRole('button', { name: '备份保险库', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'backup.vault.json' }).waitFor()
    const backup = IssuerVault.open(join(temporary, 'backup.vault.json'), password)
    try { assert.equal(backup.list()[0].active.length, 2); assert.equal(backup.list()[0].retired.length, 1) } finally { backup.close() }
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: '/tmp/ctb-issuer-workbench.png' })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(680, 620))
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: '锁定保险库', exact: true }).focus()
    assert(await page.getByRole('button', { name: '锁定保险库', exact: true }).evaluate(el => el === document.activeElement))
    await page.getByRole('button', { name: '锁定保险库', exact: true }).click()
    await page.getByRole('button', { name: '打开已有保险库', exact: true }).waitFor()
    await app.close(); app = undefined
    page = await launch(); await openFrom(vaultPath)
    await page.getByRole('button', { name: '打开已有保险库', exact: true }).click()
    await page.getByLabel('保险库密码', { exact: true }).fill('incorrect-password')
    await page.getByRole('button', { name: '选择文件并解锁', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: /密码|损坏/ }).waitFor()
    await page.getByLabel('保险库密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '选择文件并解锁', exact: true }).click()
    await page.getByText('已签发 2/2 台', { exact: true }).waitFor()
    console.log(JSON.stringify({ passed: true, runtime: security.version, nativeElectron: true, packaged: Boolean(process.env.CTB_ISSUER_EXECUTABLE), createIssueRetryReplaceBackupRestart: true }))
  }
} finally { if (app) await app.close(); rmSync(temporary, { recursive: true, force: true }) }
