import type { ImageAsset } from '../../types'
export type PreparedAiImage = { id: string; name: string; dataUrl: string }
export function fitImageSize(width: number, height: number) {
  const ratio = Math.min(1, 2400 / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) }
}
export function validatePreparedImages(images: PreparedAiImage[]) {
  if (!images.length || images.length > 8) throw new Error('每次请选择 1–8 张图片，更多图片请分批识别。')
  let bytes = 0
  for (const image of images) {
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(image.dataUrl)) throw new Error('图片读取失败，请重新选择。')
    const data = image.dataUrl.split(',')[1]
    bytes += data.length * .75 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)
  }
  if (bytes > 12 * 1024 * 1024) throw new Error('图片合计超过 12 MB，请减少图片后重试。')
}
export async function prepareAiImages(images: ImageAsset[], signal: AbortSignal): Promise<PreparedAiImage[]> {
  if (!images.length || images.length > 8) throw new Error('每次请选择 1–8 张图片。')
  const result: PreparedAiImage[] = []
  for (const asset of images) {
    signal.throwIfAborted()
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => signal.removeEventListener('abort', abort)
      const abort = () => { img.src = ''; cleanup(); reject(new DOMException('已取消', 'AbortError')) }
      img.onload = () => { cleanup(); resolve() }
      img.onerror = () => { cleanup(); reject(new Error('图片无法解码，请更换图片。')) }
      signal.addEventListener('abort', abort, { once: true }); img.src = asset.dataUrl
    })
    signal.throwIfAborted()
    const canvas = document.createElement('canvas'), size = fitImageSize(img.naturalWidth, img.naturalHeight)
    canvas.width = size.width; canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法准备图片，请重启应用后重试。')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size.width, size.height); ctx.drawImage(img, 0, 0, size.width, size.height)
    result.push({ id: asset.id, name: asset.name, dataUrl: canvas.toDataURL('image/jpeg', .92) })
  }
  validatePreparedImages(result)
  return result
}
