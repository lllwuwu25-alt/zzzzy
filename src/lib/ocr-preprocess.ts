export type OcrPreparedImage = {
  kind: 'enhanced' | 'binary'
  dataUrl: string
}

export function targetOcrSize(width: number, height: number) {
  const longest = Math.max(width, height)
  let scale = 1
  if (longest < 1400) scale = Math.min(2, 2600 / longest)
  else if (longest > 2600) scale = 2600 / longest
  scale = Math.round(scale * 1000) / 1000
  return { width: Math.round(width * scale), height: Math.round(height * scale), scale }
}

const loadImage = (dataUrl: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('图片无法读取'))
  image.src = dataUrl
})

function contentBounds(data: Uint8ClampedArray, width: number, height: number) {
  let left = width
  let right = 0
  let top = height
  let bottom = 0
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const offset = (y * width + x) * 4
      const alpha = data[offset + 3]
      const lightness = (data[offset] * 299 + data[offset + 1] * 587 + data[offset + 2] * 114) / 1000
      if (alpha > 16 && lightness < 242) {
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
    }
  }
  if (left > right || top > bottom) return { x: 0, y: 0, width, height }
  const pad = Math.max(12, Math.round(Math.min(width, height) * 0.012))
  const x = Math.max(0, left - pad)
  const y = Math.max(0, top - pad)
  return {
    x,
    y,
    width: Math.min(width, right + pad) - x,
    height: Math.min(height, bottom + pad) - y,
  }
}

function grayscale(data: ImageData) {
  const next = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height)
  for (let offset = 0; offset < next.data.length; offset += 4) {
    const value = Math.max(0, Math.min(255, Math.round((next.data[offset] * 299 + next.data[offset + 1] * 587 + next.data[offset + 2] * 114) / 1000)))
    const enhanced = value < 225 ? Math.max(0, Math.round((value - 128) * 1.28 + 128)) : 255
    next.data[offset] = enhanced
    next.data[offset + 1] = enhanced
    next.data[offset + 2] = enhanced
    next.data[offset + 3] = 255
  }
  return next
}

function otsuThreshold(data: Uint8ClampedArray) {
  const histogram = new Array<number>(256).fill(0)
  let pixels = 0
  for (let offset = 0; offset < data.length; offset += 4) {
    histogram[data[offset]] += 1
    pixels += 1
  }
  let total = 0
  histogram.forEach((count, value) => { total += value * count })
  let backgroundWeight = 0
  let backgroundSum = 0
  let bestVariance = -1
  let threshold = 180
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value]
    if (!backgroundWeight) continue
    const foregroundWeight = pixels - backgroundWeight
    if (!foregroundWeight) break
    backgroundSum += value * histogram[value]
    const backgroundMean = backgroundSum / backgroundWeight
    const foregroundMean = (total - backgroundSum) / foregroundWeight
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2
    if (variance > bestVariance) {
      bestVariance = variance
      threshold = value
    }
  }
  return Math.max(120, Math.min(220, threshold))
}

export async function preprocessForOcr(dataUrl: string): Promise<OcrPreparedImage[]> {
  const source = await loadImage(dataUrl)
  const size = targetOcrSize(source.naturalWidth, source.naturalHeight)
  const staging = document.createElement('canvas')
  staging.width = size.width
  staging.height = size.height
  const stagingContext = staging.getContext('2d', { willReadFrequently: true })
  if (!stagingContext) throw new Error('无法准备图片识别画布')
  stagingContext.fillStyle = '#fff'
  stagingContext.fillRect(0, 0, size.width, size.height)
  stagingContext.drawImage(source, 0, 0, size.width, size.height)
  const full = stagingContext.getImageData(0, 0, size.width, size.height)
  const bounds = contentBounds(full.data, size.width, size.height)

  const canvas = document.createElement('canvas')
  canvas.width = bounds.width
  canvas.height = bounds.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法准备图片识别画布')
  context.drawImage(staging, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height)

  const enhanced = grayscale(context.getImageData(0, 0, bounds.width, bounds.height))
  context.putImageData(enhanced, 0, 0)
  const enhancedUrl = canvas.toDataURL('image/png')

  const threshold = otsuThreshold(enhanced.data)
  for (let offset = 0; offset < enhanced.data.length; offset += 4) {
    const value = enhanced.data[offset] < threshold ? 0 : 255
    enhanced.data[offset] = value
    enhanced.data[offset + 1] = value
    enhanced.data[offset + 2] = value
  }
  context.putImageData(enhanced, 0, 0)
  return [
    { kind: 'enhanced', dataUrl: enhancedUrl },
    { kind: 'binary', dataUrl: canvas.toDataURL('image/png') },
  ]
}
