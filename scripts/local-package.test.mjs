import { test } from 'node:test'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeTestConfig, withTestSigner, preflightSpace, auditResources, ISSUER_FILES, copyBundle, withStagedCohort } from './local-package-policy.mjs'

test('test configuration isolates app name/data and never modifies formal trust', () => {
  const formalFile = new URL('../src-tauri/license-public-key.json', import.meta.url)
  const before = readFileSync(formalFile, 'utf8'), config = makeTestConfig()
  assert.equal(config.identifier, 'local.mistake.notebook.localtest')
  assert.equal(config.productName, '错题本本地测试版')
  assert.notEqual(config.identifier, 'local.mistake.notebook')
  assert.equal(readFileSync(formalFile, 'utf8'), before)
  // A later formal release may legitimately configure its public key.
  assert.equal(typeof JSON.parse(before).publicKeyHex, 'string')
})
test('random test signer cleans encrypted secrets after success and failure', async () => {
  let temporary, publicKey
  await withTestSigner(async context => { temporary = context.directory; publicKey = context.publicKeyHex; assert(existsSync(context.directory)); assert.match(publicKey, /^[a-f0-9]{64}$/) })
  assert(!existsSync(temporary))
  await assert.rejects(withTestSigner(async context => { temporary = context.directory; assert.notEqual(context.publicKeyHex, publicKey); throw Error('synthetic build failed') }), /synthetic/)
  assert(!existsSync(temporary))
})
test('space guard fails early rather than creating incomplete output', () => {
  assert.throws(() => preflightSpace(1024, 2048), /空间/)
  assert.doesNotThrow(() => preflightSpace(4096, 2048))
})
test('resource audit rejects secrets, notebook data, seller code in buyer and unapproved seller files', () => {
  const root = mkdtempSync(join(tmpdir(), 'ctb-resource-policy-'))
  try {
    writeFileSync(join(root, 'index.html'), '<html>empty app</html>')
    assert.deepEqual(auditResources(root, 'buyer'), ['index.html'])
    for (const [name, contents] of [['issuer.vault.json', '{}'], ['notebook.json', '{}'], ['core.mjs', 'seller signing code'], ['private.pem', '-----BEGIN PRIVATE KEY-----\n' + 'A'.repeat(80)]]) {
      writeFileSync(join(root, name), contents)
      assert.throws(() => auditResources(root, 'buyer'), /资源|秘密|题库/)
      rmSync(join(root, name))
    }
    rmSync(join(root, 'index.html'))
    mkdirSync(join(root, 'tools/license-admin'), { recursive: true })
    writeFileSync(join(root, 'tools/license-admin/core.mjs'), 'export class IssuerVault {}')
    assert(ISSUER_FILES.includes('tools/license-admin/core.mjs'))
    assert.doesNotThrow(() => auditResources(root, 'issuer'))
    writeFileSync(join(root, 'extra.txt'), 'unapproved')
    assert.throws(() => auditResources(root, 'issuer'), /资源/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('copied macOS bundle preserves relative framework links and works without source runtime', () => {
  const root = mkdtempSync(join(tmpdir(), 'ctb-bundle-links-'))
  try {
    const source = join(root, 'Source.app'), destination = join(root, 'Copied.app')
    mkdirSync(join(source, 'Framework/Versions/A'), { recursive: true })
    writeFileSync(join(source, 'Framework/Versions/A/binary'), 'synthetic framework')
    symlinkSync('A', join(source, 'Framework/Versions/Current'))
    symlinkSync('Versions/Current/binary', join(source, 'Framework/binary'))
    copyBundle(source, destination)
    rmSync(source, { recursive: true })
    // Windows readlink normalizes separators even when the relative link is preserved.
    assert.equal(readlinkSync(join(destination, 'Framework/binary')).replaceAll('\\', '/'), 'Versions/Current/binary')
    assert.equal(readFileSync(join(destination, 'Framework/binary'), 'utf8'), 'synthetic framework')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('late package failure never publishes an app without its matching activation cohort', async () => {
  const output = mkdtempSync(join(tmpdir(), 'ctb-cohort-fail-'))
  try {
    await assert.rejects(withStagedCohort({ output, folderName: 'test-v1', requiredFiles: ['buyer.app', 'certificate.json', 'audit.json'] }, async stage => {
      mkdirSync(join(stage, 'buyer.app')); writeFileSync(join(stage, 'certificate.json'), 'new matching certificate')
      throw Error('late failure')
    }), /late failure/)
    assert(!existsSync(join(output, 'test-v1')))
    assert.deepEqual(fs.readdirSync(output), [])
    await withStagedCohort({ output, folderName: 'test-v1', requiredFiles: ['buyer.app', 'certificate.json', 'audit.json'] }, async stage => {
      mkdirSync(join(stage, 'buyer.app')); writeFileSync(join(stage, 'certificate.json'), 'matching certificate'); writeFileSync(join(stage, 'audit.json'), '{}')
    })
    assert.equal(readFileSync(join(output, 'test-v1/certificate.json'), 'utf8'), 'matching certificate')
  } finally { rmSync(output, { recursive: true, force: true }) }
})
test('existing activation cohort stops before running an expensive build and preserves previous files', async () => {
  const output = mkdtempSync(join(tmpdir(), 'ctb-cohort-existing-'))
  try {
    mkdirSync(join(output, 'test-v1')); writeFileSync(join(output, 'test-v1/certificate.json'), 'old certificate')
    let started = false
    await assert.rejects(withStagedCohort({ output, folderName: 'test-v1', requiredFiles: ['buyer.app', 'certificate.json'] }, async () => { started = true }), /存在/)
    assert.equal(started, false)
    assert.equal(readFileSync(join(output, 'test-v1/certificate.json'), 'utf8'), 'old certificate')
  } finally { rmSync(output, { recursive: true, force: true }) }
})
