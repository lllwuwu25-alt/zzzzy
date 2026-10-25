import test from 'node:test'; import assert from 'node:assert/strict'
import { prepareManifest, prepareGradle } from './prepare-android.mjs'
import { readFileSync } from 'node:fs'
test('Android preparation disables backup and cleartext without broad file permissions', () => {
  const input = '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:allowBackup="true" android:usesCleartextTraffic="true"><activity /></application></manifest>'
  const result = prepareManifest(input)
  assert.match(result, /android:allowBackup="false"/)
  assert.match(result, /android:usesCleartextTraffic="false"/)
  assert.doesNotMatch(result, /MANAGE_EXTERNAL_STORAGE|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE/)
  assert.equal(prepareManifest(result), result)
})
test('Android 15 build targets API 35 and leaves signing out of source', () => {
  const input = 'android {\n compileSdk = 36\n defaultConfig {\n targetSdk = 36\n }\n}\n'
  const result = prepareGradle(input)
  assert.match(result, /compileSdk = 35/); assert.match(result, /targetSdk = 35/)
  assert.equal(prepareGradle(result), result); assert.doesNotMatch(result, /storePassword|keyPassword/)
})
test('test APK workflow never publishes a release or targets main', () => {
  const workflow = readFileSync(new URL('../.github/workflows/android-test.yml', import.meta.url), 'utf8')
  assert.match(workflow, /codex\/android-honor90-test/)
  assert.match(workflow, /android build --debug --apk --target aarch64 --ci/)
  assert.match(workflow, /VITE_ANDROID_TEST: 'true'/)
  assert.match(workflow, /contents: read/)
  assert.doesNotMatch(workflow, /contents: write|tauri-action|releaseName|tagName|gh release|branches:.*main/)
})
