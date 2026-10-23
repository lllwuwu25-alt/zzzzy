import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPublicKey, verify } from 'node:crypto'
import { IssuerVault, machineCode, normalizeMachineCode, SIGNING_DOMAIN } from './core.mjs'

const resources = [], pass = 'synthetic-test-password-not-production'
afterEach(() => { for (const resource of resources.splice(0).reverse()) resource() })
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'ctb-issuer-test-'))
  resources.push(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'issuer.vault.json')
  const vault = IssuerVault.create(path, pass)
  resources.push(() => vault.close())
  return { directory, path, vault }
}
const device = n => n.toString(16).padStart(64, '0')

test('normalizes complete machine codes and rejects empty or truncated identifiers', () => {
  assert.equal(normalizeMachineCode(machineCode(device(1))), device(1))
  assert.equal(normalizeMachineCode(machineCode(device(1)).toLowerCase().replaceAll('-', ' ')), device(1))
  for (const value of ['', 'CTB1-abc', device(1), machineCode('0'.repeat(64))]) assert.throws(() => normalizeMachineCode(value))
})

test('encrypts all issuer secrets and ledger data; wrong passwords do not erase the vault', () => {
  const { path, vault } = fixture(), purchase = vault.createPurchase('合成订单')
  const encrypted = readFileSync(path, 'utf8')
  assert(!encrypted.includes('PRIVATE KEY'))
  assert(!encrypted.includes(purchase.purchaseCode))
  assert(!encrypted.includes('合成订单'))
  const config = vault.publicConfig()
  assert.match(config.publicKeyHex, /^[a-f0-9]{64}$/)
  assert.deepEqual(Object.keys(config).sort(), ['algorithm', 'product', 'publicKeyHex', 'version'])
  vault.close()
  assert.throws(() => IssuerVault.open(path, 'wrong password'), /密码|损坏/)
  assert.equal(readFileSync(path, 'utf8'), encrypted)
  const reopened = IssuerVault.open(path, pass); resources.push(() => reopened.close())
  assert.equal(reopened.list()[0].purchaseCode, purchase.purchaseCode)
})

test('issues only two distinct devices and returns the same durable certificate for retries', () => {
  const { path, vault } = fixture(), purchase = vault.createPurchase('两设备')
  const a = vault.issue(purchase.purchaseCode, machineCode(device(1)), '电脑一')
  const b = vault.issue(purchase.purchaseCode, machineCode(device(2)), '电脑二')
  assert.deepEqual(vault.issue(purchase.purchaseCode, machineCode(device(1)), '重试'), a)
  const before = readFileSync(path, 'utf8')
  assert.throws(() => vault.issue(purchase.purchaseCode, machineCode(device(3)), '第三台'), /两台|2/)
  assert.equal(readFileSync(path, 'utf8'), before)
  assert.equal(vault.list()[0].active.length, 2)
  const payload = JSON.parse(Buffer.from(a.payload, 'base64url'))
  assert.equal(payload.deviceId, device(1)); assert.equal(payload.kind, 'perpetual')
  assert.equal(payload.product, 'mistake-notebook'); assert(!('expiresAt' in payload))
  const publicKey = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(vault.publicConfig().publicKeyHex, 'hex').toString('base64url') }, format: 'jwk' })
  assert(verify(null, Buffer.concat([SIGNING_DOMAIN, Buffer.from(a.payload, 'base64url')]), publicKey, Buffer.from(a.signature, 'base64url')))
  assert(!verify(null, Buffer.from(a.payload, 'base64url'), publicKey, Buffer.from(a.signature, 'base64url')))
  vault.close()
  const reopened = IssuerVault.open(path, pass); resources.push(() => reopened.close())
  assert.deepEqual(reopened.issue(purchase.purchaseCode, machineCode(device(2)), '重开'), b)
})

test('records manual replacement with explicit acknowledgement instead of silently revoking old licenses', () => {
  const { vault } = fixture(), { purchaseCode } = vault.createPurchase('换机')
  const old = vault.issue(purchaseCode, machineCode(device(1)), '旧电脑')
  vault.issue(purchaseCode, machineCode(device(2)), '第二台')
  assert.throws(() => vault.replace(purchaseCode, machineCode(device(1)), machineCode(device(3)), '新电脑', '更换电脑', false), /确认/)
  assert.throws(() => vault.replace(purchaseCode, machineCode(device(1)), machineCode(device(3)), '新电脑', '', true), /原因/)
  const next = vault.replace(purchaseCode, machineCode(device(1)), machineCode(device(3)), '新电脑', '原电脑故障，更换设备', true)
  assert.notDeepEqual(old, next)
  assert.equal(vault.list()[0].active.length, 2)
  assert.equal(vault.list()[0].retired.length, 1)
  assert.equal(vault.list()[0].retired[0].reason, '原电脑故障，更换设备')
  assert.throws(() => vault.issue(purchaseCode, machineCode(device(1)), '旧机再次申请'), /两台|2/)
})

test('rejects a second issuer process and never replaces an existing vault during initialization', () => {
  const { path } = fixture(), before = readFileSync(path, 'utf8')
  assert.throws(() => IssuerVault.open(path, pass), /占用|锁/)
  assert.throws(() => IssuerVault.create(path, pass), /存在|占用|锁/)
  assert.equal(readFileSync(path, 'utf8'), before)
})

test('rejects corrupted encrypted vaults and unsafe short passwords', () => {
  const { path, vault } = fixture(); vault.close()
  const contents = JSON.parse(readFileSync(path, 'utf8')); contents.ciphertext = contents.ciphertext.slice(0, -8) + 'AAAAAAAA'
  writeFileSync(path, JSON.stringify(contents))
  assert.throws(() => IssuerVault.open(path, pass), /密码|损坏/)
  assert.throws(() => IssuerVault.create(join(tmpdir(), 'must-not-create-ctb-vault'), '123'), /12/)
})

test('does not hand out a certificate when the encrypted ledger cannot commit', () => {
  const { directory, vault } = fixture(), { purchaseCode } = vault.createPurchase('故障写入')
  const moved = `${directory}-moved`; renameSync(directory, moved)
  resources.push(() => rmSync(moved, { recursive: true, force: true }))
  assert.throws(() => vault.issue(purchaseCode, machineCode(device(1)), '写入中断'))
  assert.equal(vault.list()[0].active.length, 0)
  renameSync(moved, directory)
  const license = vault.issue(purchaseCode, machineCode(device(1)), '恢复')
  assert(license.signature)
  assert.equal(vault.list()[0].active.length, 1)
})
