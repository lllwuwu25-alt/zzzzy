import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { makeTestConfig, withTestSigner, auditResources, checkSpace, copyBundle } from './local-package-policy.mjs'
import { run, makeDmg } from './build-license-desktop.mjs'
import { machineCode } from '../tools/license-admin/core.mjs'
const root = resolve(import.meta.dirname, '..')

export function localDeviceId() {
  const info = execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8' })
  const raw = info.match(/"IOPlatformUUID"\s*=\s*"([A-Fa-f0-9-]+)"/)?.[1]?.replaceAll('-', '').toLowerCase()
  if (!raw || !/^[a-f0-9]{32}$/.test(raw) || /^0+$/.test(raw)) throw Error('无法读取本机稳定设备标识，未生成测试授权')
  return createHash('sha256').update('mistake-notebook/device/v1\0macos\0' + raw).digest('hex')
}
export async function buildLocalTest() {
  if (process.platform !== 'darwin' || process.arch !== 'x64') throw Error('本轮脚本仅生成当前 Intel Mac 本地测试包')
  checkSpace(root, 2 * 1024 ** 3)
  const trustFile = join(root, 'src-tauri/license-public-key.json'), before = readFileSync(trustFile, 'utf8')
  const version = JSON.parse(readFileSync(join(root, 'package.json'))).version
  const output = join(root, 'local-deliverables'); mkdirSync(output, { recursive: true })
  const appPath = join(output, `错题本-本地测试版-${version}-Intel-Mac.app`)
  if (existsSync(appPath)) throw Error('本地测试交付物已存在，请保留或移动旧文件后再构建')
  await withTestSigner(async ({ directory, vault, publicKeyHex }) => {
    const config = makeTestConfig(), configFile = join(directory, 'tauri.localtest.json'), icons = join(directory, 'icons')
    run('npm', ['run', 'tauri', '--', 'icon', 'src-tauri/icons/icon.png', '--output', icons])
    config.bundle = { targets: ['app'], icon: [join(icons, 'icon.icns')], macOS: { signingIdentity: '-' } }
    writeFileSync(configFile, JSON.stringify(config))
    run('npm', ['run', 'tauri', '--', 'build', '--config', configFile, '--bundles', 'app'], { env: { ...process.env, NOTEBOOK_LICENSE_PUBLIC_KEY: publicKeyHex } })
    const built = join(root, 'src-tauri/target/release/bundle/macos/错题本本地测试版.app')
    copyBundle(built, appPath)
    const files = auditResources(join(appPath, 'Contents/Resources'), 'buyer')
    const executable = join(appPath, 'Contents/MacOS/mistake-notebook')
    const binary = readFileSync(executable)
    if (/-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{64}/.test(binary.toString('utf8'))) throw Error('买家程序秘密扫描未通过')
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath])
    const purchase = vault.createPurchase('本地测试专用，不可售卖')
    writeFileSync(join(output, '仅本机测试授权.ctb-license.json'), JSON.stringify(vault.issue(purchase.purchaseCode, machineCode(localDeviceId()), '本机 Intel Mac 测试'), null, 2), { flag: 'wx', mode: 0o600 })
    writeFileSync(join(output, '买家测试包资源审计.json'), JSON.stringify({ version, identifier: config.identifier, name: config.productName, testOnly: true, publicKeyHex, files, privateVaultIncluded: false, userNotebookIncluded: false }, null, 2))
    try { makeDmg(appPath, appPath.replace(/\.app$/, '.dmg'), '错题本本地测试版') } catch (error) { console.error(`DMG 未生成，已保留可运行 .app：${error.message}`) }
  })
  if (readFileSync(trustFile, 'utf8') !== before) throw Error('正式公钥配置被改变，请停止交付')
  console.log(`买家本地测试程序：${appPath}\n临时测试私钥已删除；本机测试授权单独保存，不在安装包内。`)
  return appPath
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) await buildLocalTest()
