import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { IssuerVault, machineCode } from '../license-admin/core.mjs'
import { createIssuerService } from './service.mjs'

const cleanup = [], password = 'synthetic-UI-test-password-only'
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
const code = n => machineCode(n.toString(16).padStart(64, '0'))
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'ctb-gui-service-'))
  cleanup.push(() => rmSync(directory, { force: true, recursive: true }))
  const paths = { vault: join(directory, 'test.vault.json'), output: join(directory, 'certificate.json'), request: null }
  const service = createIssuerService({ dialogs: {
    chooseVault: async () => paths.vault,
    chooseOutput: async () => paths.output,
    chooseRequest: async () => paths.request,
  }, protectedRoots: [] })
  cleanup.push(() => service.lock())
  return { directory, paths, service }
}
async function unlocked() {
  const f = fixture()
  await f.service.createVault({ password, confirmation: password, acknowledged: true })
  await f.service.createPurchase({ label: '合成订单' })
  f.purchaseCode = (await f.service.snapshot()).purchases[0].purchaseCode
  return f
}

test('creation requires confirmation, never overwrites, cancel creates nothing and lock releases vault', async () => {
  const { service, paths } = fixture()
  await assert.rejects(service.createVault({ password, confirmation: 'different', acknowledged: true }), /一致/)
  await assert.rejects(service.createVault({ password: 'short', confirmation: 'short', acknowledged: true }), /12/)
  await assert.rejects(service.createVault({ password, confirmation: password, acknowledged: false }), /确认/)
  assert(!existsSync(paths.vault))
  const path = paths.vault; paths.vault = null
  assert.deepEqual(await service.createVault({ password, confirmation: password, acknowledged: true }), { cancelled: true })
  paths.vault = path
  await service.createVault({ password, confirmation: password, acknowledged: true })
  const before = readFileSync(path, 'utf8')
  await service.lock()
  await assert.rejects(service.createVault({ password, confirmation: password, acknowledged: true }), /存在/)
  await assert.rejects(service.openVault({ password: 'incorrect password' }), /密码|损坏/)
  assert.equal(readFileSync(path, 'utf8'), before)
  await service.openVault({ password })
  assert((await service.snapshot()).unlocked)
})

test('cancel output uses no seat, two devices work, retries are identical and third rejects', async () => {
  const { service, paths, directory, purchaseCode } = await unlocked()
  paths.output = null
  assert.deepEqual(await service.issue({ purchaseCode, machineCode: code(1), label: '' }), { cancelled: true })
  assert.equal((await service.snapshot()).purchases[0].active.length, 0)
  paths.output = join(directory, 'one.json')
  await service.issue({ purchaseCode, machineCode: code(1), label: '设备一' })
  const first = readFileSync(paths.output, 'utf8')
  paths.output = join(directory, 'again.json')
  await service.issue({ purchaseCode, machineCode: code(1), label: '' })
  assert.equal(readFileSync(paths.output, 'utf8'), first)
  paths.output = join(directory, 'two.json')
  await service.issue({ purchaseCode, machineCode: code(2), label: '' })
  paths.output = join(directory, 'three.json')
  await assert.rejects(service.issue({ purchaseCode, machineCode: code(3), label: '' }), /两台/)
  assert(!existsSync(paths.output))
  const snapshot = JSON.stringify(await service.snapshot())
  for (const secret of ['PRIVATE KEY', password, 'certificate', 'signature', 'payload']) assert(!snapshot.includes(secret))
})

test('conflicting output never overwrites, committed license can be recovered without another seat', async () => {
  const { service, paths, directory, purchaseCode } = await unlocked()
  writeFileSync(paths.output, 'existing important file')
  await assert.rejects(service.issue({ purchaseCode, machineCode: code(1), label: '' }), /导出|存在/)
  assert.equal(readFileSync(paths.output, 'utf8'), 'existing important file')
  assert.equal((await service.snapshot()).purchases[0].active.length, 1)
  paths.output = join(directory, 'recovered.json')
  await service.issue({ purchaseCode, machineCode: code(1), label: '' })
  const issued = readFileSync(paths.output, 'utf8')
  await service.lock(); await service.openVault({ password })
  paths.output = join(directory, 'after-restart.json')
  await service.issue({ purchaseCode, machineCode: code(1), label: '' })
  assert.equal(readFileSync(paths.output, 'utf8'), issued)
  assert.equal((await service.snapshot()).purchases[0].active.length, 1)
})

test('filesystem failure is recoverable and leaves no partial output', async () => {
  const { service, paths, directory, purchaseCode } = await unlocked()
  paths.output = join(directory, 'missing-parent', 'license.json')
  await assert.rejects(service.issue({ purchaseCode, machineCode: code(1), label: '' }), /导出|保存/)
  assert(!existsSync(paths.output))
  mkdirSync(join(directory, 'missing-parent'))
  await service.issue({ purchaseCode, machineCode: code(1), label: '' })
  assert.equal((await service.snapshot()).purchases[0].active.length, 1)
})

test('replacement needs explicit warning acknowledgement and retains history; backup reopens', async () => {
  const { service, paths, directory, purchaseCode } = await unlocked()
  await service.issue({ purchaseCode, machineCode: code(1), label: '旧电脑' })
  paths.output = join(directory, 'replacement.json')
  const args = { purchaseCode, oldMachineCode: code(1), machineCode: code(2), label: '新电脑', reason: '旧电脑故障', acknowledged: false }
  await assert.rejects(service.replace(args), /确认/)
  await assert.rejects(service.replace({ ...args, acknowledged: true, reason: '' }), /原因/)
  await service.replace({ ...args, acknowledged: true })
  const order = (await service.snapshot()).purchases[0]
  assert.equal(order.active.length, 1); assert.equal(order.retired.length, 1)
  paths.output = join(directory, 'public.json'); await service.exportPublicConfig()
  const publicConfig = JSON.parse(readFileSync(paths.output))
  paths.output = join(directory, 'backup.vault.json'); await service.backupVault()
  const backup = IssuerVault.open(paths.output, password)
  try { assert.deepEqual(backup.publicConfig(), publicConfig); assert.deepEqual(backup.list()[0], order) } finally { backup.close() }
})

test('request import bounds and validates input without accepting extra fields', async () => {
  const { service, paths, directory } = fixture()
  assert.deepEqual(await service.readRequest(), { cancelled: true })
  paths.request = join(directory, 'request.json')
  writeFileSync(paths.request, JSON.stringify({ version: 1, product: 'mistake-notebook', machineCode: code(1), platform: 'macos' }))
  assert.equal((await service.readRequest()).machineCode, code(1))
  for (const contents of ['not json', 'x'.repeat(32769), JSON.stringify({ version: 1, product: 'other', machineCode: code(1) }), JSON.stringify({ version: 1, product: 'mistake-notebook', machineCode: code(1), extra: 'untrusted' })]) {
    writeFileSync(paths.request, contents); await assert.rejects(service.readRequest(), /申请|格式|大小/)
  }
})

test('queued lock cannot race an outstanding signature or leave the vault open', async () => {
  const { service, paths, purchaseCode } = await unlocked()
  const signing = service.issue({ purchaseCode, machineCode: code(1), label: '' })
  const locking = service.lock()
  await signing; await locking
  assert(existsSync(paths.output)); assert.equal((await service.snapshot()).unlocked, false)
  await assert.rejects(service.createPurchase({ label: 'locked' }), /打开|解锁/)
  const reopened = IssuerVault.open(paths.vault, password)
  try { assert.equal(reopened.list()[0].active.length, 1) } finally { reopened.close() }
})
