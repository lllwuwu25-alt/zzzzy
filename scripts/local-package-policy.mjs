import { mkdtempSync, rmSync, readdirSync, lstatSync, readFileSync, statfsSync, cpSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { join, relative, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { IssuerVault } from '../tools/license-admin/core.mjs'

export const ISSUER_FILES = Object.freeze([
  'tools/license-desktop/main.mjs', 'tools/license-desktop/preload.cjs',
  'tools/license-desktop/security.mjs', 'tools/license-desktop/service.mjs',
  'tools/license-desktop/ui/index.html', 'tools/license-desktop/ui/app.js', 'tools/license-desktop/ui/styles.css',
  'tools/license-admin/core.mjs',
])
export function makeTestConfig() {
  return { productName: '错题本本地测试版', identifier: 'local.mistake.notebook.localtest', app: { windows: [{ label: 'main', title: '错题本 · 本地测试版（不可售卖）', width: 1380, height: 860, minWidth: 900, minHeight: 640, center: true, resizable: true, dragDropEnabled: true }] } }
}
export function preflightSpace(available, required) {
  if (!Number.isFinite(available) || available < required) throw Error(`可用空间不足：本步至少需要 ${(required / 1024 ** 3).toFixed(1)} GiB。请腾出空间，不会删除个人文件。`)
}
export function checkSpace(path, required) { const info = statfsSync(path); preflightSpace(info.bavail * info.bsize, required) }
export function copyBundle(source, destination) { cpSync(source, destination, { recursive: true, dereference: false, verbatimSymlinks: true }) }
export async function withTestSigner(callback) {
  const directory = mkdtempSync(join(tmpdir(), 'ctb-local-build-'))
  let vault
  try {
    vault = IssuerVault.create(join(directory, 'synthetic.vault.json'), randomBytes(32).toString('base64url'))
    return await callback({ directory, vault, publicKeyHex: vault.publicConfig().publicKeyHex })
  } finally { vault?.close(); rmSync(directory, { recursive: true, force: true }) }
}
export async function withStagedCohort({ output, folderName, requiredFiles }, prepare) {
  const names = [folderName, ...requiredFiles]
  if (names.some(name => !name || basename(name) !== name || ['.', '..'].includes(name))) throw Error('交付文件名不正确')
  mkdirSync(output, { recursive: true })
  const target = join(output, folderName)
  if (existsSync(target)) throw Error('完整测试交付文件夹已存在，不会覆盖。请保留或移动整套旧文件后重试。')
  const stage = mkdtempSync(join(output, '.ctb-cohort-'))
  try {
    await prepare(stage)
    for (const name of requiredFiles) if (!existsSync(join(stage, name))) throw Error('交付文件未准备完整，没有发布测试包')
    if (existsSync(target)) throw Error('交付文件夹已存在，没有覆盖')
    // One same-filesystem directory rename publishes app + certificate + audit together.
    renameSync(stage, target)
    return target
  } finally { rmSync(stage, { recursive: true, force: true }) }
}
export function auditResources(root, kind) {
  const files = []
  function walk(directory) {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name), info = lstatSync(path), rel = relative(root, path).split('\\').join('/')
      if (info.isSymbolicLink()) throw Error(`资源中存在未批准的链接：${rel}`)
      if (info.isDirectory()) { walk(path); continue }
      if (!info.isFile()) throw Error(`资源类型不正确：${rel}`)
      if (/vault|ctb-license|ctb-request|\.pem$|notebook\.json|\.env|fixture|\.test\./i.test(rel)) throw Error(`资源可能包含秘密、题库或测试数据：${rel}`)
      if (kind === 'issuer' && ![...ISSUER_FILES, 'package.json'].includes(rel)) throw Error(`发码资源不在白名单内：${rel}`)
      if (kind === 'buyer' && /license-admin|license-desktop|core\.mjs|issuer|\.mjs$|\.ts$|\.map$/i.test(rel)) throw Error(`买家资源包含商家或开发资源：${rel}`)
      const contents = readFileSync(path)
      if (/-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{64}/.test(contents.toString('utf8'))) throw Error(`资源包含私钥秘密：${rel}`)
      files.push(rel)
    }
  }
  walk(root)
  return files.sort()
}
