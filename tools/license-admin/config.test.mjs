import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto'
import { resolveLicensePublicKey } from '../../scripts/check-license-config.mjs'

const configuration = { version: 1, product: 'mistake-notebook', algorithm: 'Ed25519', publicKeyHex: '' }
test('release preflight rejects absent, malformed, weak and public test trust roots', () => {
  for (const publicKeyHex of ['', 'private key text', '0'.repeat(64), 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a']) assert.throws(() => resolveLicensePublicKey({ ...configuration, publicKeyHex }))
  assert.throws(() => resolveLicensePublicKey({ ...configuration, product: 'other-product' }, '1'.repeat(64)))
})
test('uses a genuine public configuration when CI provides an empty optional override', () => {
  const { publicKey } = generateKeyPairSync('ed25519')
  const key = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex')
  assert.equal(resolveLicensePublicKey({ ...configuration, publicKeyHex: key }, ''), key)
  assert.equal(resolveLicensePublicKey(configuration, key.toUpperCase()), key)
  assert.throws(() => resolveLicensePublicKey({ ...configuration, publicKeyHex: key }, 'accidental-private-material'))
})
test('rejects the repository deterministic fixture public keys in files and CI overrides', () => {
  for (const seed of [71, 72]) {
    const fixture = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, seed)]), type: 'pkcs8', format: 'der' })
    const publicKeyHex = Buffer.from(createPublicKey(fixture).export({ format: 'jwk' }).x, 'base64url').toString('hex')
    assert.throws(() => resolveLicensePublicKey({ ...configuration, publicKeyHex }), /测试/)
    assert.throws(() => resolveLicensePublicKey(configuration, publicKeyHex.toUpperCase()), /测试/)
  }
})
