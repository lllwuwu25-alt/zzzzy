#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { stdin, stdout } from 'node:process'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { IssuerVault, machineCode } from './core.mjs'

if (!stdin.isTTY || !stdout.isTTY) { console.error('请在本机终端交互运行授权工具；不接受管道密码或命令行密码。'); process.exit(1) }
let muted = false, vault
const output = new Writable({ write(chunk, _encoding, callback) { if (!muted) stdout.write(chunk); callback() } })
const rl = createInterface({ input: stdin, output, terminal: true, historySize: 0 })
async function ask(label, fallback) { const value = (await rl.question(`${label}${fallback ? ` [默认：${fallback}]` : ''}：`)).trim(); return value || fallback || '' }
async function password(label) {
  stdout.write(`${label}（输入不回显）：`); muted = true
  try { return await rl.question('') } finally { muted = false; stdout.write('\n') }
}
function writeNew(path, value) {
  const text = JSON.stringify(value, null, 2) + '\n'
  if (existsSync(path)) { if (readFileSync(path, 'utf8') === text) return; throw Error('目标文件已存在且内容不同，没有覆盖；请选择其他位置。') }
  writeFileSync(path, text, { flag: 'wx', mode: 0o600 })
}
function showOrders() {
  const orders = vault.list()
  if (!orders.length) console.log('还没有购买记录，请先选择“新建购买授权”。')
  orders.forEach((order, index) => {
    console.log(`\n${index + 1}. ${order.label} · 已签发 ${order.active.length}/2 台 · 换机 ${order.retired.length} 次\n   ${order.purchaseCode}`)
    order.active.forEach((entry, i) => console.log(`   设备 ${i + 1}：${entry.label || '未备注'}\n   ${machineCode(entry.deviceId)}`))
  })
  return orders
}
async function chooseOrder() {
  const orders = showOrders(); if (!orders.length) return
  const number = Number(await ask('选择购买记录的序号'))
  if (!Number.isInteger(number) || number < 1 || number > orders.length) throw Error('购买记录序号不正确')
  return orders[number - 1]
}
async function saveCertificate(certificate) {
  const payload = JSON.parse(Buffer.from(certificate.payload, 'base64url'))
  const directory = resolve(await ask('授权文件保存文件夹', join(homedir(), 'Downloads', '错题本授权文件')))
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, `${payload.licenseId}.ctb-license.json`)
  writeNew(path, certificate)
  console.log(`\n授权记录已经保存。请把这个文件发给用户：\n${path}\n文件丢失可用同一机器码重新导出，不占新名额。`)
}
async function readMachine(label) {
  const input = await ask(`${label}（可粘贴机器码，或输入 .ctb-request.json 文件完整路径）`)
  if (input.toLowerCase().startsWith('ctb1')) return input
  const request = JSON.parse(readFileSync(resolve(input), 'utf8'))
  if (request.version !== 1 || request.product !== 'mistake-notebook' || typeof request.machineCode !== 'string') throw Error('不是有效的错题本激活申请')
  return request.machineCode
}
try {
  console.log('\n错题本 · 卖家离线授权工具\n不会启动服务器或联网。请勿把此工具、保险库或密码发给买家。\n保险库和密码请分别离线备份，丢失后无法找回私钥。\n')
  const path = resolve(await ask('保险库文件位置', join(homedir(), '错题本授权管理', 'issuer.vault.json')))
  if (existsSync(path)) vault = IssuerVault.open(path, await password('保险库密码'))
  else {
    console.log('此位置没有保险库。如果你已有保险库，请退出并选择原文件；不要为同一产品随意创建新密钥。')
    if (await ask('确实首次初始化时请输入“创建”') !== '创建') throw Error('已取消，未生成私钥')
    const passphrase = await password('设置至少 12 位强密码')
    if (await password('再次输入密码') !== passphrase) throw Error('两次密码不一致，未生成私钥')
    vault = IssuerVault.create(path, passphrase)
    console.log(`保险库已加密保存：${path}\n正式打包前需要导出公钥配置。私钥绝不能进入项目或 CI。`)
  }
  for (;;) {
    console.log('\n1 新建购买授权\n2 签发 / 重新导出设备授权\n3 查看购买与设备记录\n4 人工换机（保留历史）\n5 导出发行公钥配置\n6 备份加密保险库\n0 锁定并退出')
    try {
      const choice = await ask('请选择')
      if (choice === '0') break
      if (choice === '1') {
        const order = vault.createPurchase(await ask('订单备注（避免记录不必要的个人信息）'))
        console.log(`已创建购买授权，最多签发两台设备：\n${order.purchaseCode}`)
      } else if (choice === '2') {
        const order = await chooseOrder(); if (!order) continue
        const code = await readMachine('用户机器码'), label = await ask('设备备注（可留空）')
        await saveCertificate(vault.issue(order.purchaseCode, code, label))
      } else if (choice === '3') showOrders()
      else if (choice === '4') {
        const order = await chooseOrder(); if (!order) continue
        const oldCode = await readMachine('被替换的旧机器码'), newCode = await readMachine('新机器码')
        const label = await ask('新设备备注'), reason = await ask('换机原因（至少 3 字）')
        console.log('注意：旧设备不会收到通知，旧授权仍可能离线使用。本操作只改变签发账本，不是远程撤销。')
        const confirmed = await ask('理解并同意后请输入“确认换机”') === '确认换机'
        await saveCertificate(vault.replace(order.purchaseCode, oldCode, newCode, label, reason, confirmed))
      } else if (choice === '5') {
        const outputPath = resolve(await ask('公钥配置输出位置', join(homedir(), 'Downloads', 'license-public-key.json')))
        writeNew(outputPath, vault.publicConfig())
        console.log(`公钥已导出：${outputPath}\n这个文件可以复制到项目 src-tauri/license-public-key.json；它不包含私钥。`)
      } else if (choice === '6') {
        const backupPath = resolve(await ask('备份文件位置（不能与原文件相同）'))
        if (backupPath === path) throw Error('备份位置不能与原保险库相同')
        writeFileSync(backupPath, readFileSync(path), { flag: 'wx', mode: 0o600 })
        console.log('加密保险库已备份。只使用一份主账本签发，不要在多个备份副本同时发授权。')
      } else console.log('请选择 0–6。')
    } catch (error) { console.error(`没有完成：${error.message}\n记录不会被清空；若授权已记账但文件未导出，请用相同机器码重新导出。`) }
  }
} catch (error) { console.error(`未能打开授权工具：${error.message}`); process.exitCode = 1 }
finally { vault?.close(); rl.close() }
