import { openSync, closeSync, writeFileSync, readFileSync, fsyncSync, linkSync, unlinkSync, existsSync, statSync, constants } from 'node:fs'
import { basename, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { IssuerVault, machineCode, normalizeMachineCode } from '../license-admin/core.mjs'
import { assertSafeDestination, validateCall, safeError } from './security.mjs'

// Publish only fully written files, without replacing a conflicting destination.
function writeNew(path, contents) {
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents)
  if (existsSync(path)) {
    if (statSync(path).isFile() && statSync(path).size === bytes.length && readFileSync(path).equals(bytes)) return
    throw Error('目标文件已存在且内容不同，没有覆盖；请选择其他导出位置。')
  }
  const temporary = `${path}.${randomUUID()}.tmp`
  let fd
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
    writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined
    try { linkSync(temporary, path) }
    catch (error) {
      if (['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].includes(error.code)) throw Error('目标磁盘不支持安全的原子导出（如部分 exFAT/FAT32 移动盘）。请先保存到本机磁盘，再用 Finder 或资源管理器复制到备份介质；原保险库与已有文件未被覆盖。')
      throw error
    }
    unlinkSync(temporary)
    if (process.platform !== 'win32') {
      const directory = openSync(dirname(path), 'r')
      try { fsyncSync(directory) } finally { closeSync(directory) }
    }
  } finally {
    if (fd !== undefined) closeSync(fd)
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}
const json = value => JSON.stringify(value, null, 2) + '\n'

export function createIssuerService({ dialogs, protectedRoots }) {
  let vault, vaultPath, queue = Promise.resolve()
  function snapshot() { return { unlocked: Boolean(vault), vaultName: vaultPath ? basename(vaultPath) : null, purchases: vault ? vault.list() : [] } }
  function requireVault() { if (!vault) throw Error('请先打开并解锁保险库') }
  function destination(path) {
    const target = assertSafeDestination(path, protectedRoots)
    if (vaultPath && target === assertSafeDestination(vaultPath, [])) throw Error('输出文件不能覆盖当前保险库，请选择其他保存位置')
    return target
  }
  async function output(kind, defaultName, produce) {
    const selected = await dialogs.chooseOutput({ kind, defaultName })
    if (!selected) return { cancelled: true }
    const path = destination(selected)
    const contents = produce()
    try { writeNew(path, contents) }
    catch (error) { throw Error(`导出未完成：${safeError(error)}`) }
    return { cancelled: false, snapshot: snapshot(), outputPath: path }
  }
  const actions = {
    snapshot,
    async createVault({ password, confirmation, acknowledged }) {
      if (vault) throw Error('请先锁定当前保险库')
      if (!acknowledged) throw Error('请确认这是首次创建，并已了解备份要求')
      if (password !== confirmation) throw Error('两次密码不一致，未创建保险库')
      if (password.length < 12) throw Error('保险库密码至少需要 12 个字符')
      const path = await dialogs.chooseVault({ create: true })
      if (!path) return { cancelled: true }
      const target = assertSafeDestination(path, protectedRoots)
      vault = IssuerVault.create(target, password); vaultPath = target
      return { cancelled: false, snapshot: snapshot() }
    },
    async openVault({ password }) {
      if (vault) throw Error('请先锁定当前保险库')
      const path = await dialogs.chooseVault({ create: false })
      if (!path) return { cancelled: true }
      const target = assertSafeDestination(path, protectedRoots)
      vault = IssuerVault.open(target, password); vaultPath = target
      return { cancelled: false, snapshot: snapshot() }
    },
    createPurchase({ label }) { requireVault(); vault.createPurchase(label); return { cancelled: false, snapshot: snapshot() } },
    async readRequest() {
      const path = await dialogs.chooseRequest()
      if (!path) return { cancelled: true }
      try {
        const fd = openSync(path, constants.O_RDONLY)
        let bytes
        try {
          const info = statSync(path)
          if (!info.isFile() || info.size > 32768) throw Error('激活申请文件大小不正确（最多 32 KiB）')
          // Bounded read prevents a changing file from bypassing the size limit.
          bytes = Buffer.alloc(32769)
          const { readSync } = await import('node:fs')
          const length = readSync(fd, bytes, 0, bytes.length, 0)
          if (length > 32768) throw Error('激活申请文件大小不正确')
          bytes = bytes.subarray(0, length)
        } finally { closeSync(fd) }
        const value = JSON.parse(bytes.toString('utf8'))
        if (!value || value.version !== 1 || value.product !== 'mistake-notebook' || Object.keys(value).some(key => !['version', 'product', 'machineCode', 'platform'].includes(key)) || (value.platform !== undefined && (typeof value.platform !== 'string' || value.platform.length > 32))) throw Error('激活申请格式不正确')
        return { cancelled: false, machineCode: machineCode(normalizeMachineCode(value.machineCode)) }
      } catch { throw Error('无法读取激活申请：请选取有效的 .ctb-request.json 文件，大小不能超过 32 KiB。') }
    },
    issue({ purchaseCode, machineCode: code, label }) {
      requireVault(); normalizeMachineCode(code)
      return output('certificate', '错题本授权.ctb-license.json', () => json(vault.issue(purchaseCode, code, label)))
    },
    replace({ purchaseCode, oldMachineCode, machineCode: code, label, reason, acknowledged }) {
      requireVault(); normalizeMachineCode(code); normalizeMachineCode(oldMachineCode)
      return output('certificate', '错题本换机授权.ctb-license.json', () => json(vault.replace(purchaseCode, oldMachineCode, code, label, reason, acknowledged)))
    },
    exportPublicConfig() { requireVault(); return output('public-config', 'license-public-key.json', () => json(vault.publicConfig())) },
    backupVault() { requireVault(); vault.list(); return output('backup', '错题本加密备份.vault.json', () => readFileSync(vaultPath)) },
    lock() { vault?.close(); vault = undefined; vaultPath = undefined; return { cancelled: false, snapshot: snapshot() } },
  }
  return Object.fromEntries(Object.keys(actions).map(method => [method, (args = {}) => {
    const task = queue.then(async () => {
      validateCall(method, args)
      try { return await actions[method](args) } catch (error) { throw Error(safeError(error)) }
    })
    queue = task.catch(() => {})
    return task
  }]))
}
