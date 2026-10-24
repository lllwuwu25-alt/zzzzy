import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateCall, isTrustedSender, assertSafeDestination } from './security.mjs'

test('rejects extra IPC properties, unbounded strings and untrusted senders', () => {
  assert.doesNotThrow(() => validateCall('issue', { purchaseCode: 'CTB-test', machineCode: 'CTB1-test', label: '' }))
  for (const [method, args] of [['shell', {}], ['lock', { path: '/tmp' }], ['openVault', { password: 'x'.repeat(1025) }], ['issue', { purchaseCode: '', machineCode: '', privateKey: 'secret' }], ['snapshot', null]]) {
    assert.throws(() => validateCall(method, args))
  }
  const expectedUrl = 'file:///Applications/Issuer.app/ui/index.html'
  assert(isTrustedSender({ frameUrl: expectedUrl, expectedUrl, isMainFrame: true }))
  assert(!isTrustedSender({ frameUrl: expectedUrl, expectedUrl, isMainFrame: false }))
  assert(!isTrustedSender({ frameUrl: 'https://evil.invalid', expectedUrl, isMainFrame: true }))
  assert(!isTrustedSender({ frameUrl: expectedUrl + '?injected', expectedUrl, isMainFrame: true }))
})

test('blocks protected paths including symlink aliases and missing child directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'ctb-path-'))
  try {
    const protectedRoot = join(root, 'protected'); mkdirSync(protectedRoot)
    symlinkSync(protectedRoot, join(root, 'alias'))
    for (const path of [join(protectedRoot, 'new.vault.json'), join(root, 'alias', 'child', 'new.vault.json')]) {
      assert.throws(() => assertSafeDestination(path, [protectedRoot]), /位置|目录/)
    }
    assert.doesNotThrow(() => assertSafeDestination(join(root, 'safe.vault.json'), [protectedRoot]))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
