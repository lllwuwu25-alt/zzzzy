import { createPublicKey } from 'node:crypto'
import { readFileSync, appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function resolveLicensePublicKey(configuration, override) {
  if (!configuration || configuration.version !== 1 || configuration.algorithm !== 'Ed25519' || configuration.product !== 'mistake-notebook') throw Error('发行公钥配置格式不正确')
  const key = (override?.trim() || configuration.publicKeyHex || '').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(key)) throw Error('正式发行前必须配置 64 位十六进制 Ed25519 公钥。请用卖家工具导出；不要提供私钥或保险库密码。')
  // RFC vector and the two public signers used by src-tauri/src/license_tests.rs.
  const unsafe = ['00'.repeat(32), '01' + '00'.repeat(31), 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'e28a8970753332bd72fef413e6b0b2ef1b4aadda7aa2c141f233712a6876b351', 'd4eec1869fb1b8a4e817516ad5a931557cb56805c3eb16e8f3a803d647df7869']
  if (unsafe.includes(key)) throw Error('不得使用零值、弱公钥或公开测试密钥发行')
  createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(key, 'hex').toString('base64url') }, format: 'jwk' })
  return key
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const configuration = JSON.parse(readFileSync(resolve(import.meta.dirname, '../src-tauri/license-public-key.json'), 'utf8'))
    const key = resolveLicensePublicKey(configuration, process.env.NOTEBOOK_LICENSE_PUBLIC_KEY)
    if (process.argv.includes('--github-env')) {
      if (!process.env.GITHUB_ENV) throw Error('当前不是 GitHub Actions 环境，不能输出构建变量')
      appendFileSync(process.env.GITHUB_ENV, `NOTEBOOK_LICENSE_PUBLIC_KEY=${key}\n`)
    }
    console.log('发行公钥格式检查通过。Rust 构建还会验证公钥有效性；未读取私钥。')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
