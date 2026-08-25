import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, Crop, Eraser, Focus, Highlighter, MousePointer2, Move, PenLine, Redo2, RotateCw, Shapes, Square, Type, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { annotationBounds, cropFromDisplayRect, displaySize, displayToSource, eraseAt, migrateImage, moveAnnotation, renderImageAsset, resizeAnnotation, sourceToDisplay, topHit, type Bounds, type Point } from '../lib/annotations'
import type { Annotation, ImageAsset, Tool } from '../types'

const tools: Array<{ id: Tool; label: string; icon: typeof PenLine }> = [
  { id: 'select', label: '选择', icon: MousePointer2 },
  { id: 'pen', label: '画笔', icon: PenLine },
  { id: 'highlighter', label: '荧光笔', icon: Highlighter },
  { id: 'text', label: '文字', icon: Type },
  { id: 'arrow', label: '箭头', icon: ArrowUpRight },
  { id: 'rect', label: '矩形', icon: Shapes },
  { id: 'ellipse', label: '椭圆', icon: Focus },
  { id: 'mask', label: '答案遮挡', icon: Square },
  { id: 'eraser', label: '橡皮擦', icon: Eraser },
]

type SaveState = 'saving' | 'saved' | 'failed'
type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se'
type Interaction =
  | { kind: 'draw'; start: Point; points: number[] }
  | { kind: 'erase'; annotations: Annotation[] }
  | { kind: 'move'; start: Point; annotation: Annotation }
  | { kind: 'resize'; start: Point; annotation: Annotation; bounds: Bounds; handle: ResizeHandle }
  | { kind: 'crop'; start: Point }
  | { kind: 'pan'; start: Point; scrollLeft: number; scrollTop: number }

export function ImageEditor({ image, onChange, onClose }: { image: ImageAsset; onChange: (image: ImageAsset) => void | Promise<void>; onClose: () => void }) {
  const [draft, setDraft] = useState(image)
  const [tool, setTool] = useState<Tool>('pen')
  const [zoom, setZoom] = useState(1)
  const [color, setColor] = useState('#d14343')
  const [width, setWidth] = useState(4)
  const [fontSize, setFontSize] = useState(20)
  const [selectedId, setSelectedId] = useState<string>()
  const [preview, setPreview] = useState<Annotation>()
  const [working, setWorking] = useState<Annotation[]>()
  const [cropMode, setCropMode] = useState(false)
  const [cropPreview, setCropPreview] = useState<Bounds>()
  const [textEditor, setTextEditor] = useState<{ point: Point; value: string; id?: string }>()
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [historyIndex, setHistoryIndex] = useState(0)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const interaction = useRef<Interaction | undefined>(undefined)
  const history = useRef<ImageAsset[]>([image])
  const saveSequence = useRef(0)
  const onChangeRef = useRef(onChange)
  const workingRef = useRef<Annotation[] | undefined>(undefined)
  const cropPreviewRef = useRef<Bounds | undefined>(undefined)
  const textEditorRef = useRef(textEditor)
  onChangeRef.current = onChange
  textEditorRef.current = textEditor

  const save = useCallback(async (next: ImageAsset) => {
    const sequence = ++saveSequence.current
    setSaveState('saving')
    try {
      await onChangeRef.current(next)
      if (sequence === saveSequence.current) setSaveState('saved')
    } catch {
      if (sequence === saveSequence.current) setSaveState('failed')
    }
  }, [])

  const commit = useCallback((next: ImageAsset) => {
    const stack = history.current.slice(0, historyIndex + 1)
    stack.push(next)
    history.current = stack.slice(-100)
    const index = history.current.length - 1
    setHistoryIndex(index)
    setDraft(next)
    setPreview(undefined); setWorking(undefined); workingRef.current = undefined; setCropPreview(undefined); cropPreviewRef.current = undefined
    void save(next)
  }, [historyIndex, save])

  const applyHistory = useCallback((index: number) => {
    const next = history.current[index]
    if (!next) return
    setHistoryIndex(index); setDraft(next); setSelectedId(undefined)
    setPreview(undefined); setWorking(undefined); workingRef.current = undefined; setCropPreview(undefined); cropPreviewRef.current = undefined
    void save(next)
  }, [save])

  useEffect(() => {
    const source = new Image()
    source.onload = () => {
      imageRef.current = source
      const migrated = migrateImage(image, source.naturalWidth, source.naturalHeight)
      setDraft(migrated)
      history.current = [migrated]
      setHistoryIndex(0)
      if (image.editorVersion !== 2 || image.sourceWidth !== source.naturalWidth || image.sourceHeight !== source.naturalHeight) void save(migrated)
    }
    source.src = image.dataUrl
  }, [image.id, image.dataUrl, save])

  useEffect(() => {
    const canvas = canvasRef.current, source = imageRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !source || !context) return
    renderImageAsset(context, working ? { ...draft, annotations: working } : draft, source, { scale: zoom, showMasks: true, selectedId, preview, cropPreview })
  }, [draft, zoom, selectedId, preview, working, cropPreview])

  const sourcePosition = (event: { clientX: number; clientY: number }): Point => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return displayToSource(draft, [(event.clientX - rect.left) / zoom, (event.clientY - rect.top) / zoom])
  }
  const displayPosition = (event: { clientX: number; clientY: number }): Point => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return [(event.clientX - rect.left) / zoom, (event.clientY - rect.top) / zoom]
  }

  const annotationWithStyle = (toolId: Exclude<Tool, 'select' | 'eraser'>, points: number[], id: string = crypto.randomUUID(), text?: string): Annotation => ({
    id, tool: toolId, color: toolId === 'mask' ? '#1f2328' : toolId === 'highlighter' ? color : color,
    width: toolId === 'highlighter' ? Math.max(12, width * 4) : width,
    points, text, fontSize, opacity: toolId === 'highlighter' ? .38 : 1, coordinateSpace: 'source',
  })

  const handleAt = (item: Annotation, point: Point): ResizeHandle | undefined => {
    const b = annotationBounds(item), tolerance = 12 / zoom
    const handles: Array<[ResizeHandle, Point]> = [['nw', [b.x, b.y]], ['ne', [b.x + b.width, b.y]], ['sw', [b.x, b.y + b.height]], ['se', [b.x + b.width, b.y + b.height]]]
    return handles.find(([, handle]) => Math.hypot(handle[0] - point[0], handle[1] - point[1]) <= tolerance)?.[0]
  }

  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const display = displayPosition(event)
    if (spaceHeld) {
      const stage = stageRef.current!
      interaction.current = { kind: 'pan', start: [event.clientX, event.clientY], scrollLeft: stage.scrollLeft, scrollTop: stage.scrollTop }
      event.currentTarget.setPointerCapture(event.pointerId); return
    }
    if (cropMode) {
      interaction.current = { kind: 'crop', start: display }; const initial = { x: display[0], y: display[1], width: 1, height: 1 }; cropPreviewRef.current = initial; setCropPreview(initial)
      event.currentTarget.setPointerCapture(event.pointerId); return
    }
    const point = sourcePosition(event)
    if (tool === 'select') {
      const selected = selectedId ? draft.annotations.find((item) => item.id === selectedId) : undefined
      const handle = selected ? handleAt(selected, point) : undefined
      if (selected && handle) interaction.current = { kind: 'resize', start: point, annotation: selected, bounds: annotationBounds(selected), handle }
      else {
        const hit = topHit(draft.annotations, point, 9 / zoom)
        setSelectedId(hit?.id)
        if (hit) interaction.current = { kind: 'move', start: point, annotation: hit }
      }
      if (interaction.current) event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (tool === 'text') { setTextEditor({ point, value: '' }); return }
    if (tool === 'eraser') {
      const annotations = eraseAt(draft.annotations, point, Math.max(8, width * 2.5) / zoom)
      interaction.current = { kind: 'erase', annotations }; workingRef.current = annotations; setWorking(annotations); event.currentTarget.setPointerCapture(event.pointerId); return
    }
    interaction.current = { kind: 'draw', start: point, points: [...point] }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const active = interaction.current
    if (!active) return
    if (active.kind === 'pan') {
      const stage = stageRef.current!
      stage.scrollLeft = active.scrollLeft - (event.clientX - active.start[0]); stage.scrollTop = active.scrollTop - (event.clientY - active.start[1]); return
    }
    if (active.kind === 'crop') {
      const point = displayPosition(event)
      const rect = { x: Math.min(active.start[0], point[0]), y: Math.min(active.start[1], point[1]), width: Math.abs(point[0] - active.start[0]), height: Math.abs(point[1] - active.start[1]) }; cropPreviewRef.current = rect; setCropPreview(rect); return
    }
    const point = sourcePosition(event)
    if (active.kind === 'erase') {
      active.annotations = eraseAt(active.annotations, point, Math.max(8, width * 2.5) / zoom); workingRef.current = active.annotations; setWorking([...active.annotations]); return
    }
    if (active.kind === 'move') {
      const moved = moveAnnotation(active.annotation, point[0] - active.start[0], point[1] - active.start[1])
      const annotations = draft.annotations.map((item) => item.id === moved.id ? moved : item); workingRef.current = annotations; setWorking(annotations); return
    }
    if (active.kind === 'resize') {
      const b = active.bounds
      const opposite: Record<ResizeHandle, Point> = { nw: [b.x + b.width, b.y + b.height], ne: [b.x, b.y + b.height], sw: [b.x + b.width, b.y], se: [b.x, b.y] }
      const anchor = opposite[active.handle]
      const next = { x: Math.min(anchor[0], point[0]), y: Math.min(anchor[1], point[1]), width: Math.max(2, Math.abs(point[0] - anchor[0])), height: Math.max(2, Math.abs(point[1] - anchor[1])) }
      const resized = resizeAnnotation(active.annotation, b, next)
      const annotations = draft.annotations.map((item) => item.id === resized.id ? resized : item); workingRef.current = annotations; setWorking(annotations); return
    }
    const native = event.nativeEvent
    const samples = tool === 'pen' || tool === 'highlighter' ? (native.getCoalescedEvents?.() ?? [native]) : [native]
    if (tool === 'pen' || tool === 'highlighter') samples.forEach((sample) => active.points.push(...sourcePosition(sample)))
    else active.points = [active.start[0], active.start[1], ...point]
    setPreview(annotationWithStyle(tool as Exclude<Tool, 'select' | 'eraser'>, [...active.points], 'preview'))
  }

  const pointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const active = interaction.current
    interaction.current = undefined
    if (!active || active.kind === 'pan') return
    if (active.kind === 'crop') {
      const crop = cropPreviewRef.current
      if (crop && crop.width >= 8 && crop.height >= 8 && draft.sourceWidth && draft.sourceHeight) commit({ ...draft, crop: cropFromDisplayRect(draft, crop, draft.sourceWidth, draft.sourceHeight) })
      else setCropPreview(undefined)
      setCropMode(false); return
    }
    if (active.kind === 'erase' || active.kind === 'move' || active.kind === 'resize') {
      if (workingRef.current) commit({ ...draft, annotations: workingRef.current })
      return
    }
    const point = sourcePosition(event)
    const points = tool === 'pen' || tool === 'highlighter' ? [...active.points, ...point] : [active.start[0], active.start[1], ...point]
    if (points.length >= 4) commit({ ...draft, annotations: [...draft.annotations, annotationWithStyle(tool as Exclude<Tool, 'select' | 'eraser'>, points)] })
  }

  const cancelInteraction = () => { interaction.current = undefined; setPreview(undefined); setWorking(undefined); workingRef.current = undefined; setCropPreview(undefined); cropPreviewRef.current = undefined }

  const commitText = () => {
    const editor = textEditorRef.current
    if (!editor) return
    textEditorRef.current = undefined
    setTextEditor(undefined)
    const value = editor.value.trim()
    if (value) {
      const current = editor.id ? draft.annotations.find((item) => item.id === editor.id) : undefined
      const annotation = current ? { ...current, text: value, color, fontSize } : annotationWithStyle('text', [...editor.point, ...editor.point], undefined, value)
      commit({ ...draft, annotations: current ? draft.annotations.map((item) => item.id === current.id ? annotation : item) : [...draft.annotations, annotation] })
      setSelectedId(annotation.id)
    }
  }

  const doubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== 'select') return
    const hit = topHit(draft.annotations, sourcePosition(event.nativeEvent), 8 / zoom)
    if (hit?.tool === 'text') { setColor(hit.color); setFontSize(hit.fontSize ?? 18); setTextEditor({ point: [hit.points[0], hit.points[1]], value: hit.text ?? '', id: hit.id }) }
  }

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement
      if (event.code === 'Space' && !editing) { event.preventDefault(); setSpaceHeld(true) }
      if (editing) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); applyHistory(event.shiftKey ? Math.min(history.current.length - 1, historyIndex + 1) : Math.max(0, historyIndex - 1)) }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) { event.preventDefault(); commit({ ...draft, annotations: draft.annotations.filter((item) => item.id !== selectedId) }); setSelectedId(undefined) }
      else if (event.key === 'Escape') { setSelectedId(undefined); setCropMode(false); cancelInteraction() }
    }
    const keyUp = (event: KeyboardEvent) => { if (event.code === 'Space') setSpaceHeld(false) }
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp)
    return () => { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp) }
  }, [applyHistory, commit, draft, historyIndex, selectedId])

  const fit = () => {
    const stage = stageRef.current
    if (!stage) return
    const size = displaySize(draft)
    setZoom(Math.max(.25, Math.min(4, (stage.clientWidth - 72) / size.width, (stage.clientHeight - 72) / size.height)))
  }

  const textPosition = textEditor ? sourceToDisplay(draft, textEditor.point) : undefined

  return (
    <div className="editor-overlay" role="dialog" aria-modal="true" aria-label="图片标注器">
      <header className="editor-header">
        <div><strong>图片批注</strong><span>原图不会改变，完成的操作会实时保存</span></div>
        <div className="editor-save-actions">
          <span className={`save-state ${saveState}`} role="status">{saveState === 'saving' ? '保存中…' : saveState === 'failed' ? '保存失败，请重试' : <><Check size={14} />已保存</>}</span>
          {saveState === 'failed' && <button className="button ghost" onClick={() => void save(draft)}>重试保存</button>}
          <button className="button primary" disabled={saveState !== 'saved'} title={saveState === 'saved' ? undefined : '等待保存成功后即可完成'} onClick={onClose}><Check size={17} />完成</button>
        </div>
      </header>
      <div className="editor-tools" aria-label="标注工具">
        {tools.map(({ id, label, icon: Icon }) => <button key={id} className={`tool ${tool === id && !cropMode ? 'active' : ''}`} onClick={() => { setTool(id); setCropMode(false); setSelectedId(undefined) }} title={label} aria-pressed={tool === id && !cropMode}><Icon size={17} /><span>{label}</span></button>)}
        <span className="tool-divider" />
        <button className={`tool ${cropMode ? 'active' : ''}`} onClick={() => { setCropMode((value) => !value); setSelectedId(undefined) }} aria-pressed={cropMode}><Crop size={17} /><span>裁剪</span></button>
        <button className="tool" onClick={() => commit({ ...draft, crop: undefined })} disabled={!draft.crop}><X size={17} /><span>重置裁剪</span></button>
        <button className="tool" onClick={() => commit({ ...draft, rotation: (draft.rotation + 90) % 360 })}><RotateCw size={17} /><span>旋转</span></button>
        <button className="tool" disabled={historyIndex === 0} onClick={() => applyHistory(historyIndex - 1)}><Undo2 size={17} /><span>撤销</span></button>
        <button className="tool" disabled={historyIndex >= history.current.length - 1} onClick={() => applyHistory(historyIndex + 1)}><Redo2 size={17} /><span>重做</span></button>
      </div>
      <div className="editor-options">
        <label>颜色<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
        <label>粗细<input type="range" min="1" max="20" value={width} onChange={(event) => setWidth(Number(event.target.value))} /><span>{width}px</span></label>
        <label>字号<input type="range" min="12" max="72" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /><span>{fontSize}px</span></label>
        <span className="editor-option-spacer" />
        <button className="icon-button" aria-label="缩小" onClick={() => setZoom((value) => Math.max(.25, value - .1))}><ZoomOut size={17} /></button>
        <span className="zoom-value">{Math.round(zoom * 100)}%</span>
        <button className="icon-button" aria-label="放大" onClick={() => setZoom((value) => Math.min(4, value + .1))}><ZoomIn size={17} /></button>
        <button className="button ghost compact" onClick={fit}><Move size={15} />适合窗口</button>
      </div>
      <div ref={stageRef} className={`editor-stage ${spaceHeld ? 'panning' : ''}`} onWheel={(event) => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); setZoom((value) => Math.max(.25, Math.min(4, value * (event.deltaY > 0 ? .9 : 1.1)))) } }}>
        <div className="editor-canvas-wrap">
          <canvas ref={canvasRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelInteraction} onDoubleClick={doubleClick} />
          {textEditor && textPosition && <input autoFocus className="canvas-text-editor" style={{ left: textPosition[0] * zoom, top: textPosition[1] * zoom, color, fontSize: fontSize * zoom }} value={textEditor.value} onChange={(event) => setTextEditor({ ...textEditor, value: event.target.value })} onBlur={commitText} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitText() } else if (event.key === 'Escape') setTextEditor(undefined) }} aria-label="标注文字" />}
        </div>
      </div>
    </div>
  )
}
