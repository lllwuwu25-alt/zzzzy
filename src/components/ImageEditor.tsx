import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Crop, Eraser, Highlighter, MousePointer2, PenLine, Redo2, RotateCw, Shapes, Square, Type, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { Annotation, ImageAsset, Tool } from '../types'

const tools: Array<{ id: Tool; label: string; icon: typeof PenLine }> = [
  { id: 'select', label: '选择', icon: MousePointer2 },
  { id: 'pen', label: '画笔', icon: PenLine },
  { id: 'highlighter', label: '荧光笔', icon: Highlighter },
  { id: 'text', label: '文字', icon: Type },
  { id: 'arrow', label: '箭头', icon: ArrowUpRight },
  { id: 'rect', label: '形状', icon: Shapes },
  { id: 'mask', label: '答案遮挡', icon: Square },
  { id: 'eraser', label: '橡皮擦', icon: Eraser },
]

export function ImageEditor({ image, onSave, onClose }: { image: ImageAsset; onSave: (image: ImageAsset) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(image)
  const [tool, setTool] = useState<Tool>('pen')
  const [zoom, setZoom] = useState(1)
  const [history, setHistory] = useState<Annotation[][]>([image.annotations])
  const [historyIndex, setHistoryIndex] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const drawing = useRef<number[] | null>(null)

  const commit = (annotations: Annotation[]) => {
    const nextHistory = history.slice(0, historyIndex + 1)
    nextHistory.push(annotations)
    setHistory(nextHistory)
    setHistoryIndex(nextHistory.length - 1)
    setDraft((value) => ({ ...value, annotations }))
  }

  useEffect(() => {
    const source = new Image()
    source.src = draft.dataUrl
    source.onload = () => {
      imageRef.current = source
      draw()
    }
  }, [draft.dataUrl, draft.rotation, draft.annotations, zoom])

  const draw = () => {
    const canvas = canvasRef.current
    const source = imageRef.current
    if (!canvas || !source) return
    const rotated = draft.rotation % 180 !== 0
    canvas.width = (rotated ? source.height : source.width) * zoom
    canvas.height = (rotated ? source.width : source.height) * zoom
    const context = canvas.getContext('2d')
    if (!context) return
    context.save()
    context.scale(zoom, zoom)
    context.translate(canvas.width / zoom / 2, canvas.height / zoom / 2)
    context.rotate((draft.rotation * Math.PI) / 180)
    context.drawImage(source, -source.width / 2, -source.height / 2)
    context.restore()
    context.scale(zoom, zoom)
    draft.annotations.forEach((item) => renderAnnotation(context, item))
  }

  const position = (event: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return [(event.clientX - rect.left) / zoom, (event.clientY - rect.top) / zoom]
  }

  const pointerDown = (event: React.PointerEvent) => {
    if (tool === 'select') return
    const point = position(event)
    if (tool === 'eraser') {
      const remaining = draft.annotations.filter((item) => distanceToAnnotation(item, point) > 22)
      if (remaining.length !== draft.annotations.length) commit(remaining)
      return
    }
    if (tool === 'text') {
      const text = window.prompt('输入标注文字')
      if (text) commit([...draft.annotations, createAnnotation(tool, [...point, ...point], text)])
      return
    }
    drawing.current = point
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const pointerMove = (event: React.PointerEvent) => {
    if (!drawing.current || (tool !== 'pen' && tool !== 'highlighter')) return
    drawing.current.push(...position(event))
  }

  const pointerUp = (event: React.PointerEvent) => {
    if (!drawing.current) return
    const points = [...drawing.current, ...position(event)]
    drawing.current = null
    commit([...draft.annotations, createAnnotation(tool as Exclude<Tool, 'select' | 'eraser'>, points)])
  }

  const undo = () => {
    if (historyIndex === 0) return
    const next = historyIndex - 1
    setHistoryIndex(next)
    setDraft((value) => ({ ...value, annotations: history[next] }))
  }
  const redo = () => {
    if (historyIndex >= history.length - 1) return
    const next = historyIndex + 1
    setHistoryIndex(next)
    setDraft((value) => ({ ...value, annotations: history[next] }))
  }

  return (
    <div className="editor-overlay" role="dialog" aria-modal="true" aria-label="图片标注器">
      <header className="editor-header">
        <div>
          <strong>图片标注</strong>
          <span>原图始终保留，所有标注都可以继续修改</span>
        </div>
        <div className="button-row">
          <button className="button ghost" onClick={onClose}><X size={17} />取消</button>
          <button className="button primary" onClick={() => onSave(draft)}>保存标注</button>
        </div>
      </header>
      <div className="editor-tools" aria-label="标注工具">
        {tools.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`tool ${tool === id ? 'active' : ''}`} onClick={() => setTool(id)} title={label}>
            <Icon size={17} /><span>{label}</span>
          </button>
        ))}
        <span className="tool-divider" />
        <button className="tool" title="裁剪为当前画布"><Crop size={17} /><span>裁剪</span></button>
        <button className="tool" onClick={() => setDraft((value) => ({ ...value, rotation: (value.rotation + 90) % 360 }))}><RotateCw size={17} /><span>旋转</span></button>
        <button className="tool" disabled={historyIndex === 0} onClick={undo}><Undo2 size={17} /><span>撤销</span></button>
        <button className="tool" disabled={historyIndex >= history.length - 1} onClick={redo}><Redo2 size={17} /><span>重做</span></button>
        <span className="tool-divider" />
        <button className="icon-button" aria-label="缩小" onClick={() => setZoom((value) => Math.max(.3, value - .1))}><ZoomOut size={17} /></button>
        <span className="zoom-value">{Math.round(zoom * 100)}%</span>
        <button className="icon-button" aria-label="放大" onClick={() => setZoom((value) => Math.min(2, value + .1))}><ZoomIn size={17} /></button>
      </div>
      <div className="editor-stage">
        <canvas ref={canvasRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} />
      </div>
    </div>
  )
}

function createAnnotation(tool: Exclude<Tool, 'select' | 'eraser'>, points: number[], text?: string): Annotation {
  const colors = { pen: '#d14343', highlighter: '#f2c94c99', text: '#0f2d33', arrow: '#d14343', rect: '#0fa3a8', mask: '#1f2328' }
  return { id: crypto.randomUUID(), tool, color: colors[tool], width: tool === 'highlighter' ? 18 : 3, points, text }
}

function renderAnnotation(context: CanvasRenderingContext2D, item: Annotation) {
  context.save()
  context.strokeStyle = item.color
  context.fillStyle = item.color
  context.lineWidth = item.width
  context.lineCap = 'round'
  if (item.tool === 'pen' || item.tool === 'highlighter') {
    context.beginPath()
    item.points.forEach((value, index) => {
      if (index % 2) return
      index === 0 ? context.moveTo(value, item.points[index + 1]) : context.lineTo(value, item.points[index + 1])
    })
    context.stroke()
  } else if (item.tool === 'text') {
    context.font = '16px system-ui'
    context.fillText(item.text ?? '', item.points[0], item.points[1])
  } else {
    const [x1, y1, x2, y2] = item.points
    if (item.tool === 'mask') context.fillRect(x1, y1, x2 - x1, y2 - y1)
    else if (item.tool === 'rect') context.strokeRect(x1, y1, x2 - x1, y2 - y1)
    else {
      context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke()
      const angle = Math.atan2(y2 - y1, x2 - x1)
      context.beginPath(); context.moveTo(x2, y2)
      context.lineTo(x2 - 12 * Math.cos(angle - .45), y2 - 12 * Math.sin(angle - .45))
      context.lineTo(x2 - 12 * Math.cos(angle + .45), y2 - 12 * Math.sin(angle + .45))
      context.closePath(); context.fill()
    }
  }
  context.restore()
}

function distanceToAnnotation(item: Annotation, [x, y]: number[]) {
  let min = Infinity
  for (let i = 0; i < item.points.length; i += 2) min = Math.min(min, Math.hypot(item.points[i] - x, item.points[i + 1] - y))
  return min
}
