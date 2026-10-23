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

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp'
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_CAPTURE_FILES = 50
const MAX_BACKUP_BYTES = 512 * 1024 * 1024
export function ReviewCycleSettings() {
  const settings = useNotebook((state) => state.reviewSettings)
  const save = useNotebook((state) => state.setReviewSettings)
  const labels: Array<{ id: Rating; label: string; note: string }> = [
    { id: 'again', label: '重来', note: '忘记或答错' },
    { id: 'hard', label: '困难', note: '勉强想起' },
    { id: 'good', label: '良好', note: '正常掌握' },
    { id: 'easy', label: '简单', note: '非常熟悉' },
  ]
  return <div className="review-cycle-card"><div className="cycle-mode" role="radiogroup" aria-label="复习周期模式"><button type="button" role="radio" aria-checked={settings.mode === 'adaptive'} className={settings.mode === 'adaptive' ? 'active' : ''} onClick={() => save({ ...settings, mode: 'adaptive' })}><CalendarRange size={17} /><span><strong>自适应</strong><small>根据掌握程度自动调整</small></span></button><button type="button" role="radio" aria-checked={settings.mode === 'custom'} className={settings.mode === 'custom' ? 'active' : ''} onClick={() => save({ ...settings, mode: 'custom' })}><Settings size={17} /><span><strong>自定义</strong><small>按你设置的固定天数</small></span></button></div>{settings.mode === 'custom' && <div className="cycle-intervals">{labels.map(({ id, label, note }) => <label key={id}><span><strong>{label}</strong><small>{note}</small></span><span className="days-input"><input type="number" min="1" max="3650" step="1" value={settings.intervals[id]} onChange={(event) => save({ ...settings, intervals: { ...settings.intervals, [id]: Number(event.target.value) } })} /><i>天后</i></span></label>)}</div>}<p className="cycle-note">修改后只影响下一次评分，不会改动已有复习记录。</p></div>
}

export function TaxonomySelect({ label, value, options, addLabel, disabled, onChange, onAdd }: { label: string; value: string; options: string[]; addLabel: string; disabled?: boolean; onChange: (value: string) => void; onAdd: (value: string) => string | undefined }) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const submit = () => {
    const next = draft.trim()
    const message = onAdd(next)
    if (message) { setError(message); return }
    setDraft(''); setError(''); setAdding(false)
  }
  return <div className="field taxonomy-field"><span>{label}</span><div className="taxonomy-select-row"><select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">{disabled ? `请先选择上一级` : '请选择'}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select><button type="button" className="mini-add" disabled={disabled} aria-label={addLabel} title={addLabel} onClick={() => { setAdding((value) => !value); setError('') }}><Plus size={16} /></button></div>{adding && <div className="inline-add"><input autoFocus aria-label={addLabel} value={draft} onChange={(event) => { setDraft(event.target.value); setError('') }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submit() } if (event.key === 'Escape') setAdding(false) }} placeholder={addLabel.replace('新增', '输入')} /><button type="button" className="button primary" disabled={!draft.trim()} onClick={submit}>添加</button></div>}{error && <small className="field-error">{error}</small>}</div>
}

export function CatalogManager() {
  const taxonomy = useNotebook((state) => state.taxonomy)
  const actions = useNotebook()
  const [exam, setExam] = useState('')
  const [subject, setSubject] = useState('')
  const [notice, setNotice] = useState('')
  const run = (operation: () => string | undefined, success = '') => { const error = operation(); setNotice(error ?? success); return error }
  return <div className="catalog-manager"><div className="catalog-tree"><div className="catalog-tree-heading"><div><strong>目录结构</strong><span>按层级展开，当前只显示正在整理的分支</span></div><span>{taxonomy.exams.length} 个考试</span></div><div className="catalog-tree-body">{taxonomy.exams.map((examEntry) => { const examOpen = exam === examEntry.name; return <div className={`tree-exam ${examOpen ? 'open' : ''}`} key={examEntry.name}><div className="tree-row exam-row"><button type="button" className="tree-toggle" aria-expanded={examOpen} onClick={() => { setExam(examOpen ? '' : examEntry.name); setSubject(''); setNotice('') }}>{examOpen ? <ChevronDown size={17} /> : <ChevronRight size={17} />}<strong>{examEntry.name}</strong><span>{examEntry.subjects.length} 个科目</span></button><TreeActions name={examEntry.name} label="考试" onRename={() => { const next = window.prompt('修改考试名称', examEntry.name); if (!next || next === examEntry.name) return; const error = run(() => actions.renameExam(examEntry.name, next), '考试名称已更新'); if (!error) setExam(next.trim()) }} onDelete={() => run(() => actions.deleteExam(examEntry.name))} /></div>{examOpen && <div className="tree-children subjects-branch">{examEntry.subjects.map((subjectEntry) => { const subjectOpen = subject === subjectEntry.name; return <div className={`tree-subject ${subjectOpen ? 'open' : ''}`} key={subjectEntry.name}><div className="tree-row subject-row"><button type="button" className="tree-toggle" aria-expanded={subjectOpen} onClick={() => { setSubject(subjectOpen ? '' : subjectEntry.name); setNotice('') }}>{subjectOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<strong>{subjectEntry.name}</strong><span>{subjectEntry.chapters.length} 个章节</span></button><TreeActions name={subjectEntry.name} label="科目" onRename={() => { const next = window.prompt('修改科目名称', subjectEntry.name); if (!next || next === subjectEntry.name) return; const error = run(() => actions.renameSubject(examEntry.name, subjectEntry.name, next), '科目名称已更新'); if (!error) setSubject(next.trim()) }} onDelete={() => run(() => actions.deleteSubject(examEntry.name, subjectEntry.name))} /></div>{subjectOpen && <div className="tree-children chapters-branch"><div className="chapter-list">{subjectEntry.chapters.map((chapter) => <div className="tree-row chapter-row" key={chapter}><span className="chapter-name">{chapter}</span><TreeActions name={chapter} label="章节" onRename={() => { const next = window.prompt('修改章节名称', chapter); if (next && next !== chapter) run(() => actions.renameChapter(examEntry.name, subjectEntry.name, chapter, next), '章节名称已更新') }} onDelete={() => run(() => actions.deleteChapter(examEntry.name, subjectEntry.name, chapter))} /></div>)}{!subjectEntry.chapters.length && <p className="tree-empty">还没有章节</p>}</div><CatalogAdd label="章节" onAdd={(value) => run(() => actions.addChapter(examEntry.name, subjectEntry.name, value), `已添加章节“${value}”`)} /></div>}</div>})}<CatalogAdd label="科目" onAdd={(value) => { const error = run(() => actions.addSubject(examEntry.name, value), `已添加科目“${value}”`); if (!error) setSubject(value); return error }} /></div>}</div>})}{!taxonomy.exams.length && <p className="tree-empty root-empty">还没有考试，请从下方创建第一个考试。</p>}</div><div className="catalog-root-add"><CatalogAdd label="考试" onAdd={(value) => { const error = run(() => actions.addExam(value), `已添加考试“${value}”`); if (!error) { setExam(value); setSubject('') }; return error }} /></div></div>{notice && <p className="catalog-notice" role="status">{notice}</p>}</div>
}

export function CatalogAdd({ label, onAdd }: { label: string; onAdd: (value: string) => string | undefined }) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const cancel = () => { setAdding(false); setDraft(''); setError('') }
  const submit = () => { const message = onAdd(draft); if (message) { setError(message); return }; cancel() }
  if (!adding) return <div className="catalog-add-wrap"><button type="button" className="catalog-add-trigger" onClick={() => setAdding(true)}><Plus size={15} />新增{label}</button></div>
  return <div className="catalog-add-wrap open"><div className="catalog-add"><input autoFocus value={draft} aria-label={`新增${label}`} onChange={(event) => { setDraft(event.target.value); setError('') }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submit() } if (event.key === 'Escape') cancel() }} placeholder={`输入${label}名称`} /><button type="button" className="confirm-add" disabled={!draft.trim()} aria-label={`添加${label}`} onClick={submit}><Plus size={16} /></button><button type="button" className="cancel-add" aria-label={`取消新增${label}`} onClick={cancel}><X size={16} /></button></div>{error && <small className="field-error">{error}</small>}</div>
}

export function TreeActions({ name, label, onRename, onDelete }: { name: string; label: string; onRename: () => void; onDelete: () => void }) {
  return <div className="tree-actions"><button type="button" aria-label={`重命名${label}${name}`} title="重命名" onClick={onRename}><PencilLine size={14} /></button><button type="button" className="danger-icon" aria-label={`删除${label}${name}`} title="删除" onClick={onDelete}><Trash2 size={14} /></button></div>
}

export function ImageStrip({ images, masked = false, onEdit, onReorder, onDelete, onReplace }: { images: ImageAsset[]; masked?: boolean; onEdit?: (image: ImageAsset) => void; onReorder?: (images: ImageAsset[]) => void; onDelete?: (index: number) => void; onReplace?: (index: number, file?: File) => void }) {
  if (!images.length) return null
  return <div className="image-strip">{images.map((image, index) => <figure key={image.id}><AnnotatedImage image={image} showMasks={masked || Boolean(onEdit)} alt={`题目截图 ${index + 1}`} />{(onEdit || onDelete || onReplace) && <div className="image-actions">{onEdit && <button className="button ghost" type="button" onClick={() => onEdit(image)}><PencilLine size={15} />标注</button>}{onReplace && <ReplaceImageButton onSelect={(file) => onReplace(index, file)} />}{onDelete && <button className="button danger icon-only" type="button" aria-label={`删除第 ${index + 1} 张图片`} onClick={() => onDelete(index)}><Trash2 size={15} /></button>}</div>}{onReorder && index > 0 && <button className="image-order" type="button" aria-label="向前移动" onClick={() => { const next = [...images]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onReorder(next) }}>←</button>}</figure>)}</div>
}

export function ReplaceImageButton({ onSelect }: { onSelect: (file?: File) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return <><button className="button ghost" type="button" onClick={() => input.current?.click()}><Upload size={15} />替换</button><input ref={input} hidden type="file" accept={IMAGE_ACCEPT} onChange={(event) => { void onSelect(event.target.files?.[0]); event.target.value = '' }} /></>
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label> }
export function Empty({ title, description, icon: Icon, compact = false }: { title: string; description: string; icon: typeof Inbox; compact?: boolean }) { return <div className={`empty ${compact ? 'compact' : ''}`}><span><Icon size={24} /></span><h2>{title}</h2><p>{description}</p></div> }

export async function fileToAsset(file: File): Promise<ImageAsset> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file)
  })
  return dataUrlToAsset(file.name || `截图-${Date.now()}.png`, dataUrl)
}

export function isSupportedImageFile(file: File) {
  return file.size > 0 && file.size <= MAX_IMAGE_BYTES && (/^(image\/(png|jpe?g|webp|gif|bmp))$/i.test(file.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name))
}

export async function dataUrlToAsset(name: string, dataUrl: string): Promise<ImageAsset> {
  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const source = new Image()
    source.onload = () => resolve({ width: source.naturalWidth, height: source.naturalHeight })
    source.onerror = reject; source.src = dataUrl
  })
  return { id: crypto.randomUUID(), name, dataUrl, rotation: 0, annotations: [], editorVersion: 2, sourceWidth: dimensions.width, sourceHeight: dimensions.height }
}

export function readableError(error: unknown, fallback: string) {
  if (typeof error === 'string' && error.trim()) return error
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}
