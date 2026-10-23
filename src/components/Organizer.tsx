import {MathText, hasMath} from './MathText'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArchiveRestore, BookOpenCheck, CalendarRange, Check, ChevronDown, ChevronRight, Clock3, FileArchive, FolderCog, History,
  FolderOpen, ImagePlus, Inbox, Layers3, Menu, NotebookTabs, PencilLine, Plus, RotateCcw,
  ScanText, Search, Settings, ShieldCheck, Trash2, Upload, X,
} from 'lucide-react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { AnnotatedImage } from './AnnotatedImage'
import { ActionButton } from './ActionButton'
import { CaptureImportDialog, type TypedImportGroup } from './CaptureImportDialog'
import { ImageEditor } from './ImageEditor'
import { QuestionTypeFields } from './QuestionTypeFields'
import { QuestionAnswerInput, QuestionAnswerReveal } from './QuestionAnswerInput'
import { ratingIntervalHint } from '../lib/fsrs'
import { parseNotebookBackup } from '../lib/notebook'
import { recognizeTypedImage } from '../lib/ocr'
import { parseRecognizedQuestion } from '../lib/ocr-parser'
import { applyParsedQuestion, canCompleteOrganizer } from '../lib/question-types'
import { selectDue, scheduleLabel, useNotebook } from '../store'
import type { ImageAsset, Mistake, Notebook, Page, Rating } from '../types'

import { Field, ImageStrip, TaxonomySelect, fileToAsset, isSupportedImageFile } from './shared'
import { AiAssistant } from './ai/AiAssistant'
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp'
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_CAPTURE_FILES = 50
const MAX_BACKUP_BYTES = 512 * 1024 * 1024
export function Organizer({ item, onNext, remaining, onSettings }: { item: Mistake; onNext: (id: string) => void; remaining: number; onSettings: () => void }) {
  const save = useNotebook((state) => state.saveOrganized)
  const updateItem = useNotebook((state) => state.updateItem)
  const updateItemNow = useNotebook((state) => state.updateItemNow)
  const trash = useNotebook((state) => state.trashItem)
  const taxonomy = useNotebook((state) => state.taxonomy)
  const addExam = useNotebook((state) => state.addExam)
  const addSubject = useNotebook((state) => state.addSubject)
  const addChapter = useNotebook((state) => state.addChapter)
  const [form, setForm] = useState(item)
  const [editingImage, setEditingImage] = useState<ImageAsset>()
  const [ocrDraft, setOcrDraft] = useState('')
  const [ocrStatus, setOcrStatus] = useState<'idle' | 'recognizing' | 'done' | 'error'>('idle')
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrMessage, setOcrMessage] = useState('')
  const [extrasOpen, setExtrasOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editorTab, setEditorTab] = useState<'content' | 'images'>('content')
  const [imageZoom, setImageZoom] = useState(1)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [fieldFeedback, setFieldFeedback] = useState(false)
  const persistence = useRef(Promise.resolve())
  const revision = useRef(0)
  const mounted = useRef(true)
  const finishing = useRef(false)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const currentForm = useRef(form); currentForm.current = form
  const ocrSession = useRef(0)
  const imageInput = useRef<HTMLInputElement>(null)
  const autoOcrItem = useRef<string | undefined>(undefined)
  useEffect(() => {
    setForm(item)
    setOcrDraft(item.images.map((image) => image.recognizedText).filter(Boolean).join('\n\n'))
    setOcrStatus(item.recognition?.status === 'error' ? 'error' : item.recognition?.status === 'done' ? 'done' : 'idle')
    setOcrProgress(item.recognition?.status === 'done' ? 100 : 0)
    setOcrMessage(item.recognition?.message ?? '')
    setExtrasOpen(Boolean(item.cause.trim() || item.note.trim() || item.tags.length))
    setSaving(false)
  }, [item.id])
  const exams = taxonomy.exams
  const subjects = exams.find((entry) => entry.name === form.exam)?.subjects ?? []
  const chapters = subjects.find((entry) => entry.name === form.subject)?.chapters ?? []
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; window.clearTimeout(feedbackTimer.current) } }, [])
  const patchFields = (values: Partial<Mistake>) => {
    if (finishing.current) return
    const next = { ...currentForm.current, ...values }
    currentForm.current = next; setForm(next)
    const version = ++revision.current
    setSaveState('saving')
    persistence.current = persistence.current.catch(() => undefined).then(() => updateItemNow(item.id, next)).then(() => {
      if (mounted.current && version === revision.current) setSaveState('saved')
    }).catch(() => { if (mounted.current) setSaveState('error') })
  }
  const patch = <K extends keyof Mistake>(key: K, value: Mistake[K]) => patchFields({ [key]: value })
  const applyAiPatch = (values: Partial<Mistake>) => {
    patchFields(values); setFieldFeedback(true); window.clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => setFieldFeedback(false), 500)
  }
  const patchReviewed = (values: Partial<Mistake>) => patchFields({ ...values, recognition: form.recognition ? { ...form.recognition, reviewed: true } : { status: 'idle', reviewed: true } })
  const saveNext = async () => {
    if (!canCompleteOrganizer(form) || saving) return
    finishing.current = true
    setSaving(true)
    try {
      await persistence.current
      await save(item.id, currentForm.current)
      onNext(item.id)
    } catch {
      setOcrStatus('error')
      setOcrMessage('保存失败，请检查磁盘空间后重试。当前内容仍保留在页面中。')
    } finally {
      finishing.current = false
      setSaving(false)
    }
  }
  const addImages = async (files?: FileList | null) => {
    if (!files?.length) return
    const entries = Array.from(files).slice(0, MAX_CAPTURE_FILES)
    const supported = entries.filter(isSupportedImageFile)
    const settled = await Promise.allSettled(supported.map(fileToAsset))
    const assets = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
    if (assets.length) patch('images', [...form.images, ...assets])
    const skipped = files.length - supported.length + settled.filter((result) => result.status === 'rejected').length
    if (skipped) { setOcrStatus('error'); setOcrMessage(`已跳过 ${skipped} 个不支持、损坏或超过 25 MB 的文件。`) }
    if (imageInput.current) imageInput.current.value = ''
  }
  const replaceImage = async (index: number, file?: File) => {
    if (!file || !isSupportedImageFile(file)) { setOcrStatus('error'); setOcrMessage('请选择 25 MB 以内的 PNG、JPEG、WebP、GIF 或 BMP 图片。'); return }
    try {
      const asset = await fileToAsset(file)
      const images = [...form.images]
      images[index] = { ...asset, id: images[index].id }
      patch('images', images)
    } catch { setOcrStatus('error'); setOcrMessage('这张图片无法读取，原图片没有被替换。') }
  }
  const recognizeAllImages = async () => {
    if (!form.images.length || ocrStatus === 'recognizing') return
    setOcrStatus('recognizing'); setOcrProgress(0); setOcrMessage('正在准备本地识别…')
    const nextImages = [...form.images]
    const run = ++ocrSession.current, snapshot = form
    await updateItemNow(item.id, { recognition: { status: 'processing', reviewed: false, message: '正在本机识别图片文字' } }).catch(() => undefined)
    try {
      const confidences: number[] = []
      for (let index = 0; index < nextImages.length; index += 1) {
        setOcrMessage(`正在识别第 ${index + 1} / ${nextImages.length} 张`)
        const result = await recognizeTypedImage(nextImages[index].dataUrl, form.questionType, ({ progress }) => setOcrProgress(Math.round(((index + progress) / nextImages.length) * 100)))
        if (run !== ocrSession.current || currentForm.current.id !== snapshot.id) return
        confidences.push(result.confidence)
        nextImages[index] = { ...nextImages[index], recognizedText: result.text, recognizedAt: new Date().toISOString() }
        if (snapshot.images.some((image, i) => image.dataUrl !== currentForm.current.images[i]?.dataUrl)) { setOcrStatus('idle'); return }
      }
      const text = nextImages.map((image) => image.recognizedText?.trim()).filter(Boolean).join('\n\n')
      const confidence = confidences.length ? confidences.reduce((total, value) => total + value, 0) / confidences.length : 0
      const parsed = parseRecognizedQuestion(text, form.questionType, Math.round(confidence))
      const latest = currentForm.current
      if (latest.questionType !== snapshot.questionType || latest.images.map((i) => i.id).join() !== snapshot.images.map((i) => i.id).join()) { setOcrStatus('idle'); return }
      const recognizedPatch = applyParsedQuestion({ ...latest, images: nextImages }, parsed)
      for (const key of ['question', 'answer', 'choice', 'fillBlank', 'shortAnswer'] as const) {
        if (JSON.stringify(snapshot[key]) !== JSON.stringify(latest[key])) delete recognizedPatch[key]
      }
      const images = latest.images.map((image, index) => ({ ...image, recognizedText: nextImages[index].recognizedText, recognizedAt: nextImages[index].recognizedAt }))
      const finalPatch = { ...recognizedPatch, images }
      patchFields(finalPatch)
      await persistence.current
      setOcrDraft(text)
      setOcrProgress(100)
      setOcrStatus('done')
      setOcrMessage(text ? recognizedPatch.recognition?.message ?? '识别完成，请确认内容' : '没有识别到清晰文字，可以手动填写或换一张更清楚的图片')
    } catch {
      if (run !== ocrSession.current || currentForm.current.id !== snapshot.id) return
      setOcrStatus('error')
      setOcrMessage('识别失败。请确认图片清晰，并重新尝试。')
      await updateItemNow(item.id, { recognition: { status: 'error', reviewed: false, message: '识别失败，请重试或手动填写' } }).catch(() => undefined)
    }
  }
  useEffect(() => {
    if (item.images.length && item.recognition?.status === 'idle' && autoOcrItem.current !== item.id) {
      autoOcrItem.current = item.id
      void recognizeAllImages()
    }
    return () => { ocrSession.current++; autoOcrItem.current = undefined }
  }, [item.id])
  return (
    <section className={`organizer ${fieldFeedback ? 'fields-adopted' : ''}`}>
      <header><div><span>整理错题</span><strong>{remaining > 1 ? `完成后继续下一题 · 还剩 ${remaining} 题` : '这是收集箱中的最后一题'}</strong></div></header>
      <div className="editor-view-tabs" role="tablist" aria-label="整理视图"><button role="tab" aria-selected={editorTab === 'content'} onClick={() => setEditorTab('content')}>题目内容</button><button role="tab" aria-selected={editorTab === 'images'} onClick={() => setEditorTab('images')}>原图 · {form.images.length}</button></div>
      <div inert={saving} className={`organizer-scroll editor-tab-${editorTab}`} style={{ '--image-zoom': imageZoom } as React.CSSProperties}>
        <section className="organizer-section organizer-images"><div className="section-label"><div><strong>题目图片</strong><span>{form.images.length ? `${form.images.length} 张 · 可标注、排序或替换` : '可选，不上传云端'}</span></div><div className="button-row"><button className="button ghost compact" type="button" disabled={!form.images.length || ocrStatus === 'recognizing'} onClick={() => void recognizeAllImages()}><ScanText size={15} />{ocrStatus === 'recognizing' ? `${ocrProgress}%` : ocrStatus === 'idle' ? '识别文字' : '重新识别'}</button><button className="button ghost compact" type="button" onClick={() => imageInput.current?.click()}><ImagePlus size={15} />添加图片</button></div><input ref={imageInput} hidden type="file" accept={IMAGE_ACCEPT} multiple onChange={(event) => void addImages(event.target.files)} /></div>{form.images.length ? <ImageStrip images={form.images} onEdit={setEditingImage} onReorder={(images) => patch('images', images)} onDelete={(index) => patch('images', form.images.filter((_, position) => position !== index))} onReplace={replaceImage} /> : <div className="image-empty"><ImagePlus size={22} /><span>选择图片，或直接拖到窗口</span></div>}
        {(ocrStatus !== 'idle' || ocrDraft) && <div className={`ocr-panel ${ocrStatus}`}><div className="ocr-panel-heading"><div><ScanText size={16} /><div><strong>{ocrStatus === 'recognizing' ? `正在识别 ${ocrProgress}%` : ocrStatus === 'error' ? '识别未完成' : '文字已识别'}</strong><span>{ocrMessage || '识别在本机完成'}</span></div></div>{ocrStatus === 'recognizing' && <div className="ocr-progress" aria-label={`识别进度 ${ocrProgress}%`}><i style={{ width: `${ocrProgress}%` }} /></div>}</div>{ocrDraft && <details className="ocr-details"><summary>查看识别原文</summary><textarea aria-label="识别出的图片文字" value={ocrDraft} onChange={(event) => setOcrDraft(event.target.value)} /><div className="button-row"><button type="button" className="button ghost compact" onClick={() => patchReviewed({ question: `${form.question.trim()}${form.question.trim() ? '\n\n' : ''}${ocrDraft}` })}>追加到题干</button><button type="button" className="button primary compact" onClick={() => patchReviewed({ question: ocrDraft })}>替换题干</button></div></details>}</div>}</section>
        <div className="image-zoom-controls"><button className="button ghost compact" onClick={() => setImageZoom((v) => Math.max(.5, v - .25))} aria-label="缩小原图">−</button><span>{Math.round(imageZoom * 100)}%</span><button className="button ghost compact" onClick={() => setImageZoom((v) => Math.min(3, v + .25))} aria-label="放大原图">＋</button><button className="button ghost compact" onClick={() => setImageZoom(1)}>适合窗口</button></div>
        <AiAssistant item={form} onPatch={applyAiPatch} onSettings={onSettings} />
        <section className="organizer-section essential-fields">
          <Field label="题干"><textarea value={form.question} onChange={(e) => patchReviewed({ question: e.target.value })} placeholder="检查识别结果，补全题目文字" />{hasMath(form.question)&&<div className="math-field-preview"><small>排版预览</small><MathText text={form.question}/></div>}</Field>
          <QuestionTypeFields item={form} onPatch={patchFields} />
        </section>
        <section className="organizer-section classification-section">
          <div className="compact-section-heading"><div><strong>分类</strong><span>{[form.exam, form.subject, form.chapter].filter(Boolean).join(' / ') || '可稍后补充'}</span></div></div>
          <div className="form-grid three taxonomy-grid">
            <TaxonomySelect label="考试" value={form.exam} options={exams.map((entry) => entry.name)} addLabel="新增考试" onChange={(exam) => patchFields({ exam, subject: '', chapter: '' })} onAdd={(name) => { const error = addExam(name); if (!error) patchFields({ exam: name, subject: '', chapter: '' }); return error }} />
            <TaxonomySelect label="科目" value={form.subject} options={subjects.map((entry) => entry.name)} addLabel="新增科目" disabled={!form.exam} onChange={(subject) => patchFields({ subject, chapter: '' })} onAdd={(name) => { const error = addSubject(form.exam, name); if (!error) patchFields({ subject: name, chapter: '' }); return error }} />
            <TaxonomySelect label="章节" value={form.chapter} options={chapters} addLabel="新增章节" disabled={!form.subject} onChange={(chapter) => patch('chapter', chapter)} onAdd={(name) => { const error = addChapter(form.exam, form.subject, name); if (!error) patch('chapter', name); return error }} />
          </div>
        </section>
        <section className={`organizer-section extras-section ${extrasOpen ? 'open' : ''}`}>
          <button type="button" className="extras-toggle" aria-expanded={extrasOpen} onClick={() => setExtrasOpen((open) => !open)}><span><strong>补充信息</strong><small>{form.cause || form.note || form.tags.length ? '已填写部分内容' : '错因、笔记和标签（可选）'}</small></span><ChevronDown size={17} /></button>
          {extrasOpen && <div className="extras-content"><div className="form-grid two"><Field label="错因"><textarea value={form.cause} onChange={(e) => patch('cause', e.target.value)} placeholder="例如：概念不清、计算失误" /></Field><Field label="个人笔记"><textarea value={form.note} onChange={(e) => patch('note', e.target.value)} placeholder="给下次复习留一句提醒" /></Field></div><Field label="标签"><input value={form.tags.join('，')} onChange={(e) => patch('tags', e.target.value.split(/[，,]/).map((value) => value.trim()).filter(Boolean))} placeholder="用逗号分隔，例如：易错，二刷" /></Field></div>}
        </section>
      </div>
      <footer className="organizer-footer"><div className="organizer-save-note"><ShieldCheck size={15} /><span role="status">{saveState === 'saving' ? '正在保存草稿…' : saveState === 'error' ? '草稿保存失败，请点击重试' : '草稿已保存在本机'}</span>{saveState === 'error' && <button className="button compact ghost" onClick={() => patchFields(currentForm.current)}>重试保存</button>}</div><div className="button-row"><button className="button danger quiet-danger" onClick={() => { trash(item.id); onNext(item.id) }}><Trash2 size={15} />移到回收站</button><ActionButton className="primary" busy={saving} busyLabel="正在完成" disabled={!canCompleteOrganizer(form)} onClick={() => void saveNext()}>完成并整理下一题{remaining - 1 > 0 ? ` · ${remaining - 1}` : ''}</ActionButton></div></footer>
      {editingImage && <ImageEditor image={editingImage} onClose={() => setEditingImage(undefined)} onChange={async (image) => { const images = form.images.map((entry) => entry.id === image.id ? image : entry); await updateItemNow(item.id, { images }); setForm((state) => ({ ...state, images })); setEditingImage(image) }} />}
    </section>
  )
}
