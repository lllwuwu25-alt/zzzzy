import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { ISSUER_FILES, auditResources, checkSpace, copyBundle } from './local-package-policy.mjs'

const root = resolve(import.meta.dirname, '..'), version = JSON.parse(readFileSync(join(root, 'package.json'))).version
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  if (result.error || result.status !== 0) throw Error(`本地构建步骤失败：${command}（${result.status ?? result.error?.code}）`)
}
export function makeDmg(appPath, outputPath, volumeName) {
  const staging = mkdtempSync(join(tmpdir(), 'ctb-dmg-'))
  try {
    // ditto preserves the signed bundle's macOS metadata.
    run('/usr/bin/ditto', [appPath, join(staging, appPath.split('/').at(-1))])
    symlinkSync('/Applications', join(staging, 'Applications'))
    run('/usr/bin/hdiutil', ['create', '-volname', volumeName, '-srcfolder', staging, '-ov', '-format', 'UDZO', outputPath])
  } finally { rmSync(staging, { recursive: true, force: true }) }
}
export function buildIssuer() {
  if (process.platform !== 'darwin' || process.arch !== 'x64') throw Error('本轮脚本仅生成当前 Intel Mac 本地包')
  checkSpace(root, 768 * 1024 ** 2)
  const output = join(root, 'local-deliverables'); mkdirSync(output, { recursive: true })
  const appPath = join(output, `错题本发码器-${version}-Intel-Mac.app`)
  if (existsSync(appPath)) throw Error('发码器交付物已存在，请先保留或移动旧产物，不会覆盖')
  const runtime = join(root, 'tools/license-desktop/node_modules/electron/dist/Electron.app')
  if (!existsSync(runtime)) throw Error('请先安装并校验独立 Electron 运行时')
  copyBundle(runtime, appPath)
  const resources = join(appPath, 'Contents/Resources'), packaged = join(resources, 'app')
  rmSync(join(resources, 'default_app.asar'), { force: true }); mkdirSync(packaged)
  cpSync(join(dirname(runtime), 'LICENSE'), join(resources, 'LICENSE.electron.txt'))
  cpSync(join(dirname(runtime), 'LICENSES.chromium.html'), join(resources, 'LICENSES.chromium.html'))
  for (const file of ISSUER_FILES) { mkdirSync(dirname(join(packaged, file)), { recursive: true }); cpSync(join(root, file), join(packaged, file)) }
  writeFileSync(join(packaged, 'package.json'), JSON.stringify({ name: 'mistake-notebook-issuer', productName: '错题本发码器', version, type: 'module', main: 'tools/license-desktop/main.mjs' }, null, 2))
  const manifest = auditResources(packaged, 'issuer')
  const plist = join(appPath, 'Contents/Info.plist'), buddy = '/usr/libexec/PlistBuddy'
  for (const [key, value] of Object.entries({ CFBundleIdentifier: 'local.mistake.notebook.issuer', CFBundleName: '错题本发码器', CFBundleDisplayName: '错题本发码器', CFBundleExecutable: 'MistakeNotebookIssuer', CFBundleShortVersionString: version, CFBundleVersion: version })) run(buddy, ['-c', `Set :${key} ${value}`, plist])
  renameSync(join(appPath, 'Contents/MacOS/Electron'), join(appPath, 'Contents/MacOS/MistakeNotebookIssuer'))
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appPath])
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath])
  writeFileSync(join(output, '发码器资源审计.json'), JSON.stringify({ version, runtime: readFileSync(join(dirname(runtime), 'version'), 'utf8').trim(), identifier: 'local.mistake.notebook.issuer', files: manifest, secretsIncluded: false }, null, 2))
  try { makeDmg(appPath, appPath.replace(/\.app$/, '.dmg'), '错题本发码器') } catch (error) { console.error(`DMG 未生成，已保留可运行 .app：${error.message}`) }
  console.log(`商家程序：${appPath}`)
  return appPath
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) buildIssuer()
