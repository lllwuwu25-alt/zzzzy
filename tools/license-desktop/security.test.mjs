import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateCall, isTrustedSender, assertSafeDestination, secureWindowOptions, hardenContents, dispatchCall } from './security.mjs'

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

test('desktop boundary denies navigation, permissions, and foreign-frame business calls', async () => {
  const hooks = {}, session = {
    setPermissionRequestHandler(fn) { hooks.permission = fn },
    setPermissionCheckHandler(fn) { hooks.permissionCheck = fn },
    webRequest: { onBeforeRequest(fn) { hooks.network = fn } },
  }
  const contents = { session, on(name, fn) { hooks[name] = fn }, setWindowOpenHandler(fn) { hooks.window = fn } }
  hardenContents(contents, 'file:///app/ui/index.html')
  let prevented = false
  hooks['will-navigate']({ preventDefault() { prevented = true } }, 'https://example.invalid')
  assert(prevented); assert.equal(hooks.window({ url: 'https://example.invalid' }).action, 'deny')
  let allowed
  hooks.permission(null, 'camera', result => { allowed = result }); assert.equal(allowed, false)
  assert.equal(hooks.permissionCheck(null, 'clipboard-read'), false)
  let network
  hooks.network({ url: 'https://example.invalid' }, result => { network = result }); assert(network.cancel)
  hooks.network({ url: 'file:///app/ui/app.js' }, result => { network = result }); assert(!network.cancel)
  hooks.network({ url: 'file:///private/secret.txt' }, result => { network = result }); assert(network.cancel)
  const prefs = secureWindowOptions('/app/preload.cjs').webPreferences
  assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false)
  const service = { snapshot: async () => ({ unlocked: false }) }
  assert.deepEqual(await dispatchCall(service, 'snapshot', {}, { frameUrl: 'file:///app/ui/index.html', expectedUrl: 'file:///app/ui/index.html', isMainFrame: true }), { ok: true, value: { unlocked: false } })
  const foreign = await dispatchCall(service, 'snapshot', {}, { frameUrl: 'https://evil.invalid', expectedUrl: 'file:///app/ui/index.html', isMainFrame: true })
  assert.equal(foreign.ok, false)
  assert.equal((await dispatchCall(service, 'shell', {}, { frameUrl: 'file:///app/ui/index.html', expectedUrl: 'file:///app/ui/index.html', isMainFrame: true })).ok, false)
})

test('preload exposes only business operations and fixes each IPC channel', async () => {
  let bridge
  runInNewContext(readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8'), {
    require(name) {
      assert.equal(name, 'electron')
      return { contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'issuer'); bridge = value } },
        ipcRenderer: { invoke: async (channel, args) => ({ channel, args }) } }
    },
  })
  assert.deepEqual(Object.keys(bridge).sort(), ['snapshot', 'createVault', 'openVault', 'createPurchase', 'readRequest', 'issue', 'replace', 'exportPublicConfig', 'backupVault', 'lock'].sort())
  for (const name of Object.keys(bridge)) {
    const result = await bridge[name]({ label: 'synthetic' })
    assert.equal(result.channel, `issuer:${name}`)
  }
  assert.equal(bridge.invoke, undefined); assert.equal(bridge.readFile, undefined)
})
