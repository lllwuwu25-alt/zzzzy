import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, scryptSync, sign, verify } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const PRODUCT = 'mistake-notebook'
export const SIGNING_DOMAIN = Buffer.from('mistake-notebook-license-v1\0', 'utf8')
const MAX_VAULT = 64 * 1024 * 1024
const copy = value => structuredClone(value)
const hash = value => createHash('sha256').update(value).digest('hex')
const fail = message => { throw Error(message) }
const devicePattern = /^(?!0{64}$)[a-f0-9]{64}$/
const purchasePattern = /^CTB-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/
export function machineCode(deviceId) {
  if (!/^[a-f0-9]{64}$/i.test(deviceId)) fail('设备标识必须是完整的 64 位十六进制')
  return `CTB1-${deviceId.toUpperCase().match(/.{8}/g).join('-')}`
}
export function normalizeMachineCode(value) {
  if (typeof value !== 'string' || value.length > 160) fail('机器码格式不正确')
  const compact = value.trim().replace(/[\s-]/g, '').toLowerCase()
  if (!compact.startsWith('ctb1') || !devicePattern.test(compact.slice(4))) fail('请粘贴完整的 CTB1 机器码，不要手动省略字符')
  return compact.slice(4)
}
function passwordKey(password, salt) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) fail('保险库密码至少需要 12 个字符，最长 1024 个字符')
  return scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 })
}
function decode(value, bytes) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail('保险库损坏：编码无效')
  const data = Buffer.from(value, 'base64')
  if ((bytes && data.length !== bytes) || data.toString('base64') !== value) fail('保险库损坏：长度无效')
  return data
}
function encrypt(data, key, salt) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from('mistake-notebook-issuer-v1'))
  const plain = Buffer.from(JSON.stringify(data))
  if (plain.length > MAX_VAULT / 2) fail('保险库超过安全大小限制，请停止签发并联系维护者')
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]); plain.fill(0)
  return JSON.stringify({ version: 1, kdf: 'scrypt-32768-8-1', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') })
}
function atomicWrite(path, contents) {
  const temporary = `${path}.${randomUUID()}.tmp`
  let fd, renamed = false
  try {
    fd = openSync(temporary, 'wx', 0o600); writeFileSync(fd, contents); fsyncSync(fd); closeSync(fd); fd = undefined
    renameSync(temporary, path); renamed = true
    if (process.platform !== 'win32') { const directory = openSync(dirname(path), 'r'); try { fsyncSync(directory) } finally { closeSync(directory) } }
  } catch (error) {
    if (fd !== undefined) closeSync(fd)
    if (existsSync(temporary)) unlinkSync(temporary)
    if (renamed) error.commitMayHaveSucceeded = true
    throw error
  }
}
function acquireLock(path) {
  const lockPath = `${path}.lock`, token = randomUUID()
  let fd
  try { fd = openSync(lockPath, 'wx', 0o600) }
  catch { fail('保险库正被其他授权工具占用，或遗留锁文件。请确认工具已关闭后按说明处理锁文件，不要同时签发。') }
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, token })); fsyncSync(fd) }
  catch (error) { closeSync(fd); unlinkSync(lockPath); throw error }
  closeSync(fd)
  return () => {
    if (!existsSync(lockPath)) return
    try { if (JSON.parse(readFileSync(lockPath, 'utf8')).token === token) unlinkSync(lockPath) } catch { /* Never delete another session's lock. */ }
  }
}
function certificate(data, purchaseCode, deviceId) {
  const payload = Buffer.from(JSON.stringify({ schema: 1, product: PRODUCT, licenseId: randomUUID(), purchaseCode, deviceId, issuedAt: new Date().toISOString(), kind: 'perpetual', keyId: hash(Buffer.from(data.publicKeyHex, 'hex')).slice(0, 16) }))
  return { version: 1, payload: payload.toString('base64url'), signature: sign(null, Buffer.concat([SIGNING_DOMAIN, payload]), data.privateKey).toString('base64url') }
}
function validateData(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.purchases) || typeof data.privateKey !== 'string' || !/^[a-f0-9]{64}$/.test(data.publicKeyHex)) fail('保险库损坏：账本结构无效')
  const privateKey = createPrivateKey(data.privateKey)
  if (privateKey.asymmetricKeyType !== 'ed25519' || Buffer.from(createPublicKey(privateKey).export({ format: 'jwk' }).x, 'base64url').toString('hex') !== data.publicKeyHex) fail('保险库损坏：签名密钥不一致')
  const codes = new Set(), key = createPublicKey(privateKey)
  for (const order of data.purchases) {
    if (!purchasePattern.test(order.purchaseCode) || codes.has(order.purchaseCode) || !Array.isArray(order.active) || order.active.length > 2 || !Array.isArray(order.retired)) fail('保险库损坏：设备名额或购买记录异常')
    codes.add(order.purchaseCode)
    const activeIds = new Set()
    for (const [active, entries] of [[true, order.active], [false, order.retired]]) for (const entry of entries) {
      if (!devicePattern.test(entry.deviceId) || (active && activeIds.has(entry.deviceId))) fail('保险库损坏：设备记录异常')
      if (active) activeIds.add(entry.deviceId)
      const c = entry.certificate
      if (!c || c.version !== 1 || typeof c.payload !== 'string' || typeof c.signature !== 'string') fail('保险库损坏：设备证书缺失')
      const bytes = Buffer.from(c.payload, 'base64url'), payload = JSON.parse(bytes)
      if (!verify(null, Buffer.concat([SIGNING_DOMAIN, bytes]), key, Buffer.from(c.signature, 'base64url')) || payload.product !== PRODUCT || payload.deviceId !== entry.deviceId || payload.purchaseCode !== order.purchaseCode || payload.kind !== 'perpetual') fail('保险库损坏：设备证书与账本不一致')
    }
  }
}

export class IssuerVault {
  #path; #data; #key; #salt; #unlock; #closed = false; #uncertain = false
  constructor(path, data, key, salt, unlock) { this.#path = path; this.#data = data; this.#key = key; this.#salt = salt; this.#unlock = unlock }
  static create(filename, password) {
    const salt = randomBytes(16), key = passwordKey(password, salt), path = resolve(filename)
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    if (existsSync(path)) { key.fill(0); fail('保险库已存在，初始化不会覆盖。请选择“打开已有保险库”。') }
    const unlock = acquireLock(path)
    try {
      if (existsSync(path)) fail('保险库已存在，不允许覆盖')
      const { privateKey, publicKey } = generateKeyPairSync('ed25519')
      const data = { version: 1, privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKeyHex: Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex'), purchases: [] }
      atomicWrite(path, encrypt(data, key, salt))
      return new IssuerVault(path, data, key, salt, unlock)
    } catch (error) { key.fill(0); unlock(); throw error }
  }
  static open(filename, password) {
    const path = resolve(filename)
    if (!existsSync(path) || statSync(path).size > MAX_VAULT) fail('保险库不存在或超过大小限制；不会自动新建或重置')
    const unlock = acquireLock(path)
    let key
    try {
      const envelope = JSON.parse(readFileSync(path, 'utf8'))
      if (envelope.version !== 1 || envelope.kdf !== 'scrypt-32768-8-1') fail('保险库损坏或版本不支持')
      const salt = decode(envelope.salt, 16); key = passwordKey(password, salt)
      const cipher = createDecipheriv('aes-256-gcm', key, decode(envelope.iv, 12))
      cipher.setAAD(Buffer.from('mistake-notebook-issuer-v1')); cipher.setAuthTag(decode(envelope.tag, 16))
      const plain = Buffer.concat([cipher.update(decode(envelope.ciphertext)), cipher.final()])
      let data
      try { data = JSON.parse(plain.toString('utf8')) } finally { plain.fill(0) }
      validateData(data)
      return new IssuerVault(path, data, key, salt, unlock)
    } catch { key?.fill(0); unlock(); fail('密码不正确，或保险库已损坏。原文件未被修改，请勿重新初始化覆盖。') }
  }
  #check() { if (this.#closed) fail('保险库已关闭'); if (this.#uncertain) fail('上次提交状态不确定，请关闭并重新打开保险库，检查记录后重试') }
  #commit(next) {
    this.#check()
    try { atomicWrite(this.#path, encrypt(next, this.#key, this.#salt)) }
    catch (error) { if (error.commitMayHaveSucceeded) this.#uncertain = true; throw error }
    this.#data = next
  }
  createPurchase(label) {
    this.#check()
    if (typeof label !== 'string' || !label.trim() || label.length > 120) fail('请输入不超过 120 字的订单备注')
    const purchaseCode = `CTB-${randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g).join('-')}`
    const order = { purchaseCode, label: label.trim(), createdAt: new Date().toISOString(), active: [], retired: [] }
    const next = copy(this.#data); next.purchases.push(order); this.#commit(next)
    return { purchaseCode, label: order.label }
  }
  issue(purchaseCode, code, label = '') {
    this.#check()
    const deviceId = normalizeMachineCode(code), next = copy(this.#data), order = next.purchases.find(entry => entry.purchaseCode === purchaseCode)
    if (!order) fail('购买授权码不存在，请先创建购买记录，不会自动添加订单')
    const existing = order.active.find(entry => entry.deviceId === deviceId)
    if (existing) return copy(existing.certificate)
    if (order.active.length >= 2) fail('这份购买授权已签发两台设备。换机请使用人工换机流程。')
    if (typeof label !== 'string' || label.length > 120) fail('设备备注不能超过 120 字')
    const signed = certificate(next, purchaseCode, deviceId)
    order.active.push({ deviceId, label: label.trim(), issuedAt: new Date().toISOString(), certificate: signed })
    this.#commit(next)
    return copy(signed)
  }
  replace(purchaseCode, oldCode, newCode, label, reason, acknowledged) {
    this.#check()
    if (acknowledged !== true) fail('必须确认：旧授权无法远程撤销，仍可能在离线旧设备继续使用')
    if (typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 500) fail('请填写 3–500 字的换机原因')
    if (typeof label !== 'string' || label.length > 120) fail('设备备注不能超过 120 字')
    const oldId = normalizeMachineCode(oldCode), newId = normalizeMachineCode(newCode), next = copy(this.#data)
    const order = next.purchases.find(entry => entry.purchaseCode === purchaseCode)
    if (!order) fail('购买授权码不存在')
    const index = order.active.findIndex(entry => entry.deviceId === oldId)
    if (index < 0) fail('原设备不在当前有效签发记录中；若已换机，请用新机器码重新下载授权')
    if (order.active.some(entry => entry.deviceId === newId)) fail('新设备已经拥有授权，请使用重新下载，不要重复换机')
    const signed = certificate(next, purchaseCode, newId)
    const [retired] = order.active.splice(index, 1)
    order.retired.push({ ...retired, retiredAt: new Date().toISOString(), reason: reason.trim(), replacedBy: newId })
    order.active.push({ deviceId: newId, label: label.trim(), issuedAt: new Date().toISOString(), certificate: signed })
    this.#commit(next)
    return copy(signed)
  }
  list() {
    this.#check()
    return this.#data.purchases.map(({ purchaseCode, label, createdAt, active, retired }) => ({ purchaseCode, label, createdAt, active: active.map(({ certificate: _, ...entry }) => copy(entry)), retired: retired.map(({ certificate: _, ...entry }) => copy(entry)) }))
  }
  publicConfig() { this.#check(); return { version: 1, algorithm: 'Ed25519', product: PRODUCT, publicKeyHex: this.#data.publicKeyHex } }
  close() { if (this.#closed) return; this.#closed = true; this.#key.fill(0); this.#data = undefined; this.#unlock() }
}
