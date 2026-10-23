import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { IssuerVault, machineCode } from '../tools/license-admin/core.mjs'

const root = resolve(import.meta.dirname, '..'), temporary = mkdtempSync(join(tmpdir(), 'ctb-native-license-qa-'))
const configurationBefore = readFileSync(join(root, 'src-tauri/license-public-key.json'), 'utf8')
let vault
try {
  vault = IssuerVault.create(join(temporary, 'synthetic.vault.json'), 'synthetic-interop-test-password')
  const { purchaseCode } = vault.createPurchase('Synthetic interoperability test; not a customer')
  const deviceId = '4'.repeat(64), certificate = vault.issue(purchaseCode, machineCode(deviceId), 'Synthetic machine')
  const fixture = join(temporary, 'fixture.json')
  writeFileSync(fixture, JSON.stringify({ publicKeyHex: vault.publicConfig().publicKeyHex, purchaseCode, deviceId, certificate }))
  const result = spawnSync('cargo', ['test', '--lib', '--offline', 'license_tests::node_issuer_interoperability_fixture_when_requested', '--', '--exact'], { cwd: join(root, 'src-tauri'), env: { ...process.env, CTB_INTEROP_FIXTURE: fixture }, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /1 passed/)
  // Execute the actual compiled build script: fail before any Tauri packaging when trust is absent.
  const build = join(root, 'src-tauri/target/debug/build')
  const candidates = readdirSync(build).filter(name => name.startsWith('mistake-notebook-')).map(name => join(build, name, process.platform === 'win32' ? 'build-script-build.exe' : 'build-script-build'))
    .filter(path => { try { return statSync(path).isFile() } catch { return false } }).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  assert(candidates.length, 'Run cargo test before this QA so its build script exists')
  writeFileSync(join(temporary, 'license-public-key.json'), JSON.stringify({ version: 1, algorithm: 'Ed25519', product: 'mistake-notebook', publicKeyHex: '' }))
  const denied = spawnSync(candidates[0], [], { cwd: temporary, env: { ...process.env, PROFILE: 'release', NOTEBOOK_LICENSE_PUBLIC_KEY: '' }, encoding: 'utf8' })
  assert.notEqual(denied.status, 0, 'Release without a verification key was allowed')
  assert.match(denied.stderr, /正式发行必须先配置/)
  for (const key of ['e28a8970753332bd72fef413e6b0b2ef1b4aadda7aa2c141f233712a6876b351', 'd4eec1869fb1b8a4e817516ad5a931557cb56805c3eb16e8f3a803d647df7869']) {
    const fixtureDenied = spawnSync(candidates[0], [], { cwd: temporary, env: { ...process.env, PROFILE: 'release', NOTEBOOK_LICENSE_PUBLIC_KEY: key }, encoding: 'utf8' })
    assert.notEqual(fixtureDenied.status, 0, 'Release with a published fixture signer was allowed')
    assert.match(fixtureDenied.stderr, /不得使用公开的测试公钥发行/, 'Must reject fixture trust before invoking Tauri packaging')
  }
  assert.equal(readFileSync(join(root, 'src-tauri/license-public-key.json'), 'utf8'), configurationBefore, 'QA must never modify the configured production trust root')
  console.log(JSON.stringify({ passed: true, nodeToRust: true, releaseFailsClosed: true, fixtureKeysRejected: true, productionKeysNotCreated: true }))
} finally { vault?.close(); rmSync(temporary, { recursive: true, force: true }) }
