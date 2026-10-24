import { existsSync, realpathSync } from 'node:fs'
import { resolve, dirname, basename, relative, isAbsolute, join } from 'node:path'

const fields = {
  createVault: { password: 1024, confirmation: 1024, acknowledged: 'boolean' },
  openVault: { password: 1024 }, snapshot: {}, lock: {}, readRequest: {},
  createPurchase: { label: 120 },
  issue: { purchaseCode: 160, machineCode: 160, label: 120 },
  replace: { purchaseCode: 160, oldMachineCode: 160, machineCode: 160, label: 120, reason: 500, acknowledged: 'boolean' },
  exportPublicConfig: {}, backupVault: {},
}
export const METHODS = Object.freeze(Object.keys(fields))
export function validateCall(method, args) {
  if (!Object.hasOwn(fields, method) || !args || typeof args !== 'object' || Array.isArray(args)) throw Error('操作参数不正确')
  const schema = fields[method]
  if (Object.keys(args).some(key => !Object.hasOwn(schema, key))) throw Error('操作包含不支持的参数')
  for (const [key, type] of Object.entries(schema)) {
    if (type === 'boolean' ? typeof args[key] !== 'boolean' : typeof args[key] !== 'string' || args[key].length > type) throw Error('操作参数格式或长度不正确')
  }
}
export function isTrustedSender({ frameUrl, expectedUrl, isMainFrame }) {
  return isMainFrame === true && typeof expectedUrl === 'string' && expectedUrl.startsWith('file:') && frameUrl === expectedUrl
}
function canonical(path) {
  const absolute = resolve(path)
  if (existsSync(absolute)) return realpathSync(absolute)
  const parent = dirname(absolute)
  if (parent === absolute) return absolute
  return join(canonical(parent), basename(absolute))
}
export function assertSafeDestination(path, protectedRoots) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) throw Error('请选择有效的本地文件位置')
  const target = canonical(path)
  for (const root of protectedRoots) {
    const rel = relative(canonical(root), target)
    if (!rel || (!rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) && rel !== '..' && !isAbsolute(rel))) throw Error('不能在应用、项目或保险库目录中的受保护位置保存，请选择其他位置')
  }
  return target
}

export function safeError(error) {
  if (error?.code || typeof error?.message !== 'string' || !/[\u3400-\u9fff]/u.test(error.message)) return '本地文件操作失败，请检查文件权限、剩余空间和保存位置后重试。已记账的授权可用同一机器码重新导出。'
  return error.message.slice(0, 600)
}
