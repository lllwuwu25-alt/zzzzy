import type { Annotation, ImageAsset } from '../types'

export type Point = [number, number]
export type Bounds = { x: number; y: number; width: number; height: number }

export const imageCrop = (image: ImageAsset, width = image.sourceWidth ?? 1, height = image.sourceHeight ?? 1): Bounds =>
  image.crop ?? { x: 0, y: 0, width, height }

export function displaySize(image: ImageAsset, width = image.sourceWidth ?? 1, height = image.sourceHeight ?? 1) {
  const crop = imageCrop(image, width, height)
  return image.rotation % 180 === 0
    ? { width: crop.width, height: crop.height }
    : { width: crop.height, height: crop.width }
}

export function sourceToDisplay(image: ImageAsset, [x, y]: Point, width = image.sourceWidth ?? 1, height = image.sourceHeight ?? 1): Point {
  const crop = imageCrop(image, width, height)
  const px = x - crop.x
  const py = y - crop.y
  switch (((image.rotation % 360) + 360) % 360) {
    case 90: return [crop.height - py, px]
    case 180: return [crop.width - px, crop.height - py]
    case 270: return [py, crop.width - px]
    default: return [px, py]
  }
}

export function displayToSource(image: ImageAsset, [x, y]: Point, width = image.sourceWidth ?? 1, height = image.sourceHeight ?? 1): Point {
  const crop = imageCrop(image, width, height)
  switch (((image.rotation % 360) + 360) % 360) {
    case 90: return [y + crop.x, crop.height - x + crop.y]
    case 180: return [crop.width - x + crop.x, crop.height - y + crop.y]
    case 270: return [crop.width - y + crop.x, x + crop.y]
    default: return [x + crop.x, y + crop.y]
  }
}

export function annotationBounds(item: Annotation): Bounds {
  if (item.tool === 'text') {
    const size = item.fontSize ?? 18
    return { x: item.points[0], y: item.points[1] - size, width: Math.max(size, (item.text?.length ?? 1) * size * .62), height: size * 1.25 }
  }
  const xs = item.points.filter((_, index) => index % 2 === 0)
  const ys = item.points.filter((_, index) => index % 2 === 1)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
}

export function moveAnnotation(item: Annotation, dx: number, dy: number): Annotation {
  return { ...item, points: item.points.map((value, index) => value + (index % 2 ? dy : dx)) }
}

export function resizeAnnotation(item: Annotation, original: Bounds, next: Bounds): Annotation {
  if (item.tool === 'text') {
    const ratio = next.width / Math.max(1, original.width)
    return { ...item, points: [next.x, next.y + next.height * .8], fontSize: Math.max(10, Math.min(96, (item.fontSize ?? 18) * ratio)) }
  }
  return {
    ...item,
    points: item.points.map((value, index) => index % 2
      ? next.y + ((value - original.y) / Math.max(1, original.height)) * next.height
      : next.x + ((value - original.x) / Math.max(1, original.width)) * next.width),
  }
}

function pointSegmentDistance(point: Point, start: Point, end: Point) {
  const [x, y] = point, [x1, y1] = start, [x2, y2] = end
  const length = (x2 - x1) ** 2 + (y2 - y1) ** 2
  if (!length) return Math.hypot(x - x1, y - y1)
  const t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / length))
  return Math.hypot(x - (x1 + t * (x2 - x1)), y - (y1 + t * (y2 - y1)))
}

export function hitAnnotation(item: Annotation, point: Point, tolerance = 10) {
  if (item.tool === 'text' || item.tool === 'rect' || item.tool === 'ellipse' || item.tool === 'mask') {
    const b = annotationBounds(item)
    if (item.tool === 'ellipse') {
      const rx = Math.max(1, b.width / 2), ry = Math.max(1, b.height / 2)
      return ((point[0] - b.x - rx) / rx) ** 2 + ((point[1] - b.y - ry) / ry) ** 2 <= 1.25
    }
    return point[0] >= b.x - tolerance && point[0] <= b.x + b.width + tolerance && point[1] >= b.y - tolerance && point[1] <= b.y + b.height + tolerance
  }
  for (let index = 0; index < item.points.length - 2; index += 2) {
    if (pointSegmentDistance(point, [item.points[index], item.points[index + 1]], [item.points[index + 2], item.points[index + 3]]) <= tolerance + item.width / 2) return true
  }
  return false
}

export function topHit(annotations: Annotation[], point: Point, tolerance = 10) {
  return [...annotations].reverse().find((item) => hitAnnotation(item, point, tolerance))
}

export function eraseAt(annotations: Annotation[], point: Point, radius: number): Annotation[] {
  const result: Annotation[] = []
  for (const item of annotations) {
    if (item.tool !== 'pen' && item.tool !== 'highlighter') {
      if (!hitAnnotation(item, point, radius)) result.push(item)
      continue
    }
    const runs: number[][] = []
    let run: number[] = []
    for (let index = 0; index < item.points.length; index += 2) {
      const outside = Math.hypot(item.points[index] - point[0], item.points[index + 1] - point[1]) > radius
      if (outside) run.push(item.points[index], item.points[index + 1])
      else if (run.length >= 4) { runs.push(run); run = [] }
      else run = []
    }
    if (run.length >= 4) runs.push(run)
    runs.forEach((points, index) => result.push({ ...item, id: index === 0 ? item.id : crypto.randomUUID(), points }))
  }
  return result
}

export function migrateImage(image: ImageAsset, width: number, height: number): ImageAsset {
  if (image.editorVersion === 2) return { ...image, sourceWidth: width, sourceHeight: height }
  const legacy = { ...image, sourceWidth: width, sourceHeight: height }
  return {
    ...legacy,
    editorVersion: 2,
    annotations: image.annotations.map((item) => ({
      ...item,
      coordinateSpace: 'source',
      fontSize: item.fontSize ?? 18,
      opacity: item.opacity ?? (item.tool === 'highlighter' ? .42 : 1),
      points: item.points.flatMap((_, index, values) => index % 2 ? [] : displayToSource(legacy, [values[index], values[index + 1]], width, height)),
    })),
  }
}

export function cropFromDisplayRect(image: ImageAsset, rect: Bounds, width: number, height: number): Bounds {
  const corners: Point[] = [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]]
  const source = corners.map((point) => displayToSource(image, point, width, height))
  const xs = source.map(([x]) => x), ys = source.map(([, y]) => y)
  const x = Math.max(0, Math.min(...xs)), y = Math.max(0, Math.min(...ys))
  return { x, y, width: Math.max(1, Math.min(width, Math.max(...xs)) - x), height: Math.max(1, Math.min(height, Math.max(...ys)) - y) }
}

export function renderImageAsset(context: CanvasRenderingContext2D, image: ImageAsset, source: CanvasImageSource, options: { scale?: number; showMasks?: boolean; selectedId?: string; preview?: Annotation; cropPreview?: Bounds } = {}) {
  const scale = options.scale ?? 1
  const width = image.sourceWidth ?? Number((source as HTMLImageElement).naturalWidth || (source as HTMLCanvasElement).width)
  const height = image.sourceHeight ?? Number((source as HTMLImageElement).naturalHeight || (source as HTMLCanvasElement).height)
  const crop = imageCrop(image, width, height)
  const size = displaySize(image, width, height)
  const canvas = context.canvas
  canvas.width = Math.max(1, Math.round(size.width * scale))
  canvas.height = Math.max(1, Math.round(size.height * scale))
  context.save(); context.scale(scale, scale)
  switch (((image.rotation % 360) + 360) % 360) {
    case 90: context.translate(crop.height, 0); context.rotate(Math.PI / 2); break
    case 180: context.translate(crop.width, crop.height); context.rotate(Math.PI); break
    case 270: context.translate(0, crop.width); context.rotate(-Math.PI / 2); break
  }
  context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
  context.restore()
  const items = options.preview ? [...image.annotations, options.preview] : image.annotations
  items.forEach((item) => {
    if (item.tool === 'mask' && options.showMasks === false) return
    renderAnnotation(context, image, item, scale)
  })
  if (options.selectedId) {
    const selected = items.find((item) => item.id === options.selectedId)
    if (selected) renderSelection(context, image, selected, scale)
  }
  if (options.cropPreview) {
    const r = options.cropPreview
    context.save(); context.scale(scale, scale); context.fillStyle = '#0f2d3377'; context.beginPath(); context.rect(0, 0, size.width, size.height); context.rect(r.x, r.y, r.width, r.height); context.fill('evenodd'); context.strokeStyle = '#0fa3a8'; context.lineWidth = 2 / scale; context.strokeRect(r.x, r.y, r.width, r.height); context.restore()
  }
}

export function renderAnnotation(context: CanvasRenderingContext2D, image: ImageAsset, item: Annotation, scale = 1) {
  const displayPoints = item.points.flatMap((_, index, values) => index % 2 ? [] : sourceToDisplay(image, [values[index], values[index + 1]]))
  context.save(); context.scale(scale, scale)
  context.globalAlpha = item.opacity ?? 1
  context.strokeStyle = item.color; context.fillStyle = item.color; context.lineWidth = item.width; context.lineCap = 'round'; context.lineJoin = 'round'
  if (item.tool === 'pen' || item.tool === 'highlighter') {
    context.beginPath(); displayPoints.forEach((value, index) => { if (index % 2) return; index ? context.lineTo(value, displayPoints[index + 1]) : context.moveTo(value, displayPoints[index + 1]) }); context.stroke()
  } else if (item.tool === 'text') {
    context.font = `${item.fontSize ?? 18}px system-ui`; context.textBaseline = 'alphabetic'; context.fillText(item.text ?? '', displayPoints[0], displayPoints[1])
  } else {
    const [x1, y1, x2, y2] = displayPoints
    const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1)
    if (item.tool === 'mask') context.fillRect(x, y, w, h)
    else if (item.tool === 'rect') context.strokeRect(x, y, w, h)
    else if (item.tool === 'ellipse') { context.beginPath(); context.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); context.stroke() }
    else {
      context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke()
      const angle = Math.atan2(y2 - y1, x2 - x1)
      context.beginPath(); context.moveTo(x2, y2); context.lineTo(x2 - 12 * Math.cos(angle - .45), y2 - 12 * Math.sin(angle - .45)); context.lineTo(x2 - 12 * Math.cos(angle + .45), y2 - 12 * Math.sin(angle + .45)); context.closePath(); context.fill()
    }
  }
  context.restore()
}

function renderSelection(context: CanvasRenderingContext2D, image: ImageAsset, item: Annotation, scale: number) {
  const bounds = annotationBounds(item)
  const corners = [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y], [bounds.x, bounds.y + bounds.height], [bounds.x + bounds.width, bounds.y + bounds.height]] as Point[]
  const display = corners.map((point) => sourceToDisplay(image, point))
  const xs = display.map(([x]) => x), ys = display.map(([, y]) => y)
  const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y
  context.save(); context.scale(scale, scale); context.strokeStyle = '#0fa3a8'; context.lineWidth = 1.5 / scale; context.setLineDash([5 / scale, 4 / scale]); context.strokeRect(x, y, w, h); context.setLineDash([]); context.fillStyle = '#fff'; context.strokeStyle = '#0b7075'
  ;[[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(([hx, hy]) => { context.beginPath(); context.rect(hx - 4 / scale, hy - 4 / scale, 8 / scale, 8 / scale); context.fill(); context.stroke() }); context.restore()
}
