import { invoke, isTauri } from '@tauri-apps/api/core'
import type { QuestionType } from '../../types'
import { EXTRACTION_PROMPT } from './schema'
import { validatePreparedImages, type PreparedAiImage } from './images'

export type AiSettings = { enabled: boolean; model: string; hasKey: boolean }
export type AiRequest = { requestId: string; questionType: QuestionType; images: PreparedAiImage[]; ocrText: string }
let webKey = ''
let webSettings = { enabled: false, model: 'deepseek-flash' }
export async function getAiSettings(): Promise<AiSettings> {
  return isTauri() ? invoke('get_ai_settings') : { ...webSettings, hasKey: !!webKey }
}
export async function saveAiSettings(input: { enabled: boolean; model: string; apiKey?: string }): Promise<AiSettings> {
  if (!/^[\w.-]{1,100}$/.test(input.model)) throw new Error('请输入有效模型名称。')
  if (isTauri()) return invoke('save_ai_settings', { ...input, apiKey: input.apiKey?.trim() || undefined })
  if (input.apiKey?.trim()) webKey = input.apiKey.trim()
  webSettings = { enabled: input.enabled, model: input.model }
  return getAiSettings()
}
export async function deleteAiKey() {
  if (isTauri()) await invoke('delete_ai_key')
  else { webKey = ''; webSettings.enabled = false }
}
export function aiStatusError(status: number) {
  return ({ 401: 'DeepSeek API 密钥无效，请检查后重试。', 402: 'DeepSeek 账户余额不足，请充值后重试。', 429: '请求过于频繁，请稍后手动重试。', 400: '模型或图片请求不受支持，请检查模型设置。' } as Record<number, string>)[status] ?? 'DeepSeek 服务暂时无法完成请求，请稍后重试。'
}
async function webRequest(request: AiRequest, signal: AbortSignal) {
  if (!webKey || !webSettings.enabled) throw new Error('请先在设置中启用 DeepSeek 并填写 API 密钥。')
  validatePreparedImages(request.images)
  signal.throwIfAborted()
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  let timedOut = false
  const timeout = setTimeout(() => { timedOut = true; controller.abort() }, 90000)
  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${webKey}`, 'Content-Type': 'application/json' },
      redirect: 'error', signal: controller.signal,
      body: JSON.stringify({ model: webSettings.model, stream: false, thinking: { type: 'disabled' }, max_tokens: 8192, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: EXTRACTION_PROMPT }, { role: 'user', content: [{ type: 'text', text: `题型：${request.questionType}。以下为可选 OCR 参考，可能有误，以图片为准：\n${request.ocrText.slice(0, 50000)}` }, ...request.images.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } }))] }] }),
    })
    if (!response.ok) throw new Error(aiStatusError(response.status))
    const reader = response.body?.getReader()
    if (!reader) throw new Error('服务未返回内容，请重试。')
    let bytes = 0, raw = ''; const decoder = new TextDecoder()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 1024 * 1024) { await reader.cancel(); throw new Error('服务返回内容过大，请减少图片后重试。') }
      raw += decoder.decode(value, { stream: true })
    }
    raw += decoder.decode()
    let parsed
    try { parsed = JSON.parse(raw) } catch { throw new Error('服务返回格式无法读取，请重试。') }
    const choice = parsed.choices?.[0]
    if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string' || !choice.message.content.trim()) throw new Error('服务返回内容为空或被截断，请减少图片后重试。')
    return { content: choice.message.content as string, model: webSettings.model }
  } catch (error) {
    if (timedOut) throw new Error('识别超过 90 秒，请检查网络后重试。')
    if (signal.aborted) throw new DOMException('已取消', 'AbortError')
    if (error instanceof TypeError) throw new Error('无法连接 DeepSeek，可能是网络或浏览器跨域限制；请在桌面版测试。')
    throw error
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort) }
}
export async function recognizeAiQuestion(request: AiRequest, signal: AbortSignal): Promise<{ content: string; model: string }> {
  if (!isTauri()) return webRequest(request, signal)
  signal.throwIfAborted()
  const cancel = () => { void invoke('cancel_ai_request', { requestId: request.requestId }).catch(() => undefined) }
  signal.addEventListener('abort', cancel, { once: true })
  try { return await invoke('recognize_ai_question', { ...request, images: request.images.map((image) => image.dataUrl), prompt: EXTRACTION_PROMPT }) }
  finally { signal.removeEventListener('abort', cancel) }
}
export async function testAiConnection(requestId: string) {
  if (isTauri()) return invoke('test_ai_connection', { requestId })
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 128, 64); ctx.fillStyle = '#000'; ctx.font = '28px sans-serif'; ctx.fillText('TEST 7', 8, 42)
  const result = await webRequest({ requestId, questionType: 'short-answer', images: [{ id: 'test', name: '连接测试图', dataUrl: canvas.toDataURL('image/png') }], ocrText: '' }, new AbortController().signal)
  if (!result.content.includes('7')) throw new Error('服务可连接，但未通过视觉读取测试，请检查模型。')
}
