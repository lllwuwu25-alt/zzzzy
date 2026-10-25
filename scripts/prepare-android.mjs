import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export function prepareManifest(source) {
  let result = source.replace(/android:allowBackup="[^"]*"/g, '').replace(/android:usesCleartextTraffic="[^"]*"/g, '')
  result = result.replace(/<application\s*/, '<application android:allowBackup="false" android:usesCleartextTraffic="false" ')
  if (!result.includes('.notebookfiles')) result = result.replace('</application>', '<provider android:name="androidx.core.content.FileProvider" android:authorities="${applicationId}.notebookfiles" android:exported="false" android:grantUriPermissions="true"><meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/notebook_capture_paths" /></provider></application>')
  // Do not request broad storage access: imports and exports use system pickers.
  return result
}
export function prepareGradle(source) {
  if (!/compileSdk\s*=\s*\d+/.test(source) || !/targetSdk\s*=\s*\d+/.test(source)) throw Error('Unknown Tauri Android template: SDK declarations were not found')
  return source.replace(/compileSdk\s*=\s*\d+/, 'compileSdk = 35').replace(/targetSdk\s*=\s*\d+/, 'targetSdk = 35')
}
export function prepareAndroid(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const project = resolve(root, 'src-tauri/gen/android'), manifest = resolve(project, 'app/src/main/AndroidManifest.xml'), gradle = resolve(project, 'app/build.gradle.kts')
  writeFileSync(manifest, prepareManifest(readFileSync(manifest, 'utf8')))
  writeFileSync(gradle, prepareGradle(readFileSync(gradle, 'utf8')))
  const target = resolve(project, 'app/src/main/java/local/mistake/notebook/mobile/NotebookMobilePlugin.kt')
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(resolve(root, 'src-tauri/android/NotebookMobilePlugin.kt'), target)
  const xml = resolve(project, 'app/src/main/res/xml/notebook_capture_paths.xml')
  mkdirSync(dirname(xml), { recursive: true })
  writeFileSync(xml, '<paths xmlns:android="http://schemas.android.com/apk/res/android"><cache-path name="capture" path="capture-imports/" /></paths>')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) prepareAndroid()
