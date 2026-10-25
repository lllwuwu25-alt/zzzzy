import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

export default defineConfig({
  plugins: [react(), { name: 'mobile-shell-manifest', generateBundle(_options, bundle) {
    const manifest = JSON.stringify(Object.keys(bundle).filter((name) => name.startsWith('assets/') && !name.endsWith('.map')).map((name) => `/${name}`))
    const version = createHash('sha256').update(manifest).digest('hex').slice(0, 16)
    this.emitFile({ type: 'asset', fileName: 'pwa-assets.json', source: manifest })
    this.emitFile({ type: 'asset', fileName: 'sw.js', source: readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8').replace("const VERSION = 'shell-v1';", `const VERSION = 'shell-${version}';`) })
  } }],
  server: { port: 5174, strictPort: true },
  clearScreen: false,
})
