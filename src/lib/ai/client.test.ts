import { afterEach, expect, it, vi } from 'vitest'
import { getAiSettings, saveAiSettings, recognizeAiQuestion, deleteAiKey } from './client'
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))
afterEach(async () => { await deleteAiKey(); vi.unstubAllGlobals() })
it('requires a session key before sending and never returns the stored key', async () => {
  await expect(recognizeAiQuestion({ requestId: 'one', questionType: 'short-answer', images: [], ocrText: '' }, new AbortController().signal)).rejects.toThrow('密钥')
  await saveAiSettings({ enabled: true, model: 'deepseek-flash', apiKey: 'test-session-secret' })
  expect(JSON.stringify(await getAiSettings())).not.toContain('test-session-secret')
})
it('does not return raw service error bodies or repeat a paid request', async () => {
  await saveAiSettings({ enabled: true, model: 'deepseek-flash', apiKey: 'test-session-secret' })
  let calls = 0
  vi.stubGlobal('fetch', async () => { calls++; return new Response('private body', { status: 401 }) })
  await expect(recognizeAiQuestion({ requestId: 'two', questionType: 'short-answer', images: [{ id: 'a', name: 'a', dataUrl: 'data:image/png;base64,aGVsbG8=' }], ocrText: '' }, new AbortController().signal)).rejects.toThrow('密钥')
  expect(calls).toBe(1)
})
