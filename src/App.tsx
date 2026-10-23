import { getMotionPreference } from './lib/preferences'
import { Organizer } from './components/Organizer'
import { SettingsPage } from './components/SettingsPage'
import { Field, Empty, ImageStrip, TaxonomySelect, fileToAsset, dataUrlToAsset, isSupportedImageFile, readableError } from './components/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArchiveRestore, BookOpenCheck, CalendarRange, Check, ChevronDown, ChevronRight, Clock3, FileArchive, FolderCog, History,
  FolderOpen, ImagePlus, Inbox, Layers3, Menu, NotebookTabs, PencilLine, Plus, RotateCcw,
  ScanText, Search, Settings, ShieldCheck, Trash2, Upload, X,
} from 'lucide-react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { AnnotatedImage } from './components/AnnotatedImage'
import { ActionButton } from './components/ActionButton'
import { CaptureImportDialog, type TypedImportGroup } from './components/CaptureImportDialog'
import { ImageEditor } from './components/ImageEditor'
import { QuestionTypeFields } from './components/QuestionTypeFields'
import { QuestionAnswerInput, QuestionAnswerReveal } from './components/QuestionAnswerInput'
import { ratingIntervalHint } from './lib/fsrs'
import { parseNotebookBackup } from './lib/notebook'
import { recognizeTypedImage } from './lib/ocr'
import { parseRecognizedQuestion } from './lib/ocr-parser'
import { applyParsedQuestion, canCompleteOrganizer } from './lib/question-types'
import { selectDue, scheduleLabel, useNotebook } from './store'
import type { ImageAsset, Mistake, Notebook, Page, Rating } from './types'

const navigation: Array<{ id: Page; label: string; icon: typeof Inbox }> = [
  { id: 'review', label: '今日复习', icon: BookOpenCheck },
  { id: 'inbox', label: '收集箱', icon: Inbox },
  { id: 'library', label: '全部错题', icon: Layers3 },
  { id: 'history', label: '复习记录', icon: History },
  { id: 'settings', label: '设置', icon: Settings },
]

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp'
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_CAPTURE_FILES = 50
const MAX_BACKUP_BYTES = 512 * 1024 * 1024
type PendingImport = { id: string; images: ImageAsset[]; skipped: number }

export function App() {
  const [page, setPage] = useState<Page>('review')
  const [mobileNav, setMobileNav] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => { document.documentElement.dataset.motion = getMotionPreference() }, [])
  const [dragActive, setDragActive] = useState(false)
  const [captureNotice, setCaptureNotice] = useState('')
  const [captureBusy, setCaptureBusy] = useState(false)
  const [importQueue, setImportQueue] = useState<PendingImport[]>([])
  const [captureFocus, setCaptureFocus] = useState<string>()
  const addTypedCaptures = useNotebook((state) => state.addTypedCaptures)
  const inboxCount = useNotebook((state) => state.items.filter((item) => item.status === 'inbox').length)
  const pendingImport = importQueue[0]

  const captureAssets = useCallback(async (images: ImageAsset[], skipped = 0) => {
    if (!images.length) { setCaptureNotice(skipped ? '没有找到可导入的图片，请使用 PNG、JPEG、WebP、GIF 或 BMP' : '没有可收录的图片'); return }
    setImportQueue((queue) => [...queue, { id: crypto.randomUUID(), images, skipped }])
  }, [])

  const completeImport = useCallback(async (groups: TypedImportGroup[]) => {
    const ids = await addTypedCaptures(groups.map(({ images, questionType }) => ({ images, questionType })))
    setCaptureFocus(ids[0])
    setPage('inbox')
    setImportQueue((queue) => queue.slice(1))
    setCaptureNotice(`已创建 ${ids.length} 道错题，正在本机识别文字`)
    window.setTimeout(() => setCaptureNotice(''), 3200)
  }, [addTypedCaptures])

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const allEntries = Array.from(files)
    const entries = allEntries.slice(0, MAX_CAPTURE_FILES)
    const supported = entries.filter(isSupportedImageFile)
    setCaptureBusy(true)
    const settled = await Promise.allSettled(supported.map(fileToAsset))
    setCaptureBusy(false)
    await captureAssets(settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []), allEntries.length - supported.length + settled.filter((result) => result.status === 'rejected').length)
  }, [captureAssets])

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? [])
      if (files.length) void addFiles(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addFiles])

  useEffect(() => {
    if (!isTauri()) return
    let mounted = true
    let dispose: (() => void) | undefined
    void import('@tauri-apps/api/webview').then(async ({ getCurrentWebview }) => {
      dispose = await getCurrentWebview().onDragDropEvent(async ({ payload }) => {
        if (!mounted) return
        if (payload.type === 'enter' || payload.type === 'over') setDragActive(true)
        if (payload.type === 'leave') setDragActive(false)
        if (payload.type === 'drop') {
          setDragActive(false); setCaptureBusy(true)
          try {
            const result = await invoke<{ images: Array<{ name: string; dataUrl: string }>; skipped: number }>('read_dropped_images', { paths: payload.paths })
            const settled = await Promise.allSettled(result.images.map((entry) => dataUrlToAsset(entry.name, entry.dataUrl)))
            await captureAssets(settled.flatMap((entry) => entry.status === 'fulfilled' ? [entry.value] : []), result.skipped + settled.filter((entry) => entry.status === 'rejected').length)
          } catch (error) {
            setCaptureNotice(readableError(error, '无法读取拖入的图片，请确认文件仍在原位置并重试。'))
          } finally { setCaptureBusy(false) }
        }
      })
    }).catch(() => {
      if (mounted) setCaptureNotice('拖入功能没有成功启动，请重新打开应用后重试。')
    })
    return () => { mounted = false; dispose?.() }
  }, [captureAssets])

  return (
    <div className={`app-shell ${collapsed ? 'nav-collapsed' : ''}`} onDragOver={(event) => { event.preventDefault(); if (!isTauri() && Array.from(event.dataTransfer.types).includes('Files')) setDragActive(true) }} onDragLeave={(event) => { if (!isTauri() && !event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false) }} onDrop={(event) => { event.preventDefault(); if (isTauri()) return; setDragActive(false); void addFiles(event.dataTransfer.files) }}>
      <a className="skip-link" href="#main">跳到主要内容</a>
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <div className="brand"><span className="brand-mark"><NotebookTabs size={22} /></span><div><strong>错题本</strong><small>本地学习工作台</small></div></div>
        <button className="nav-collapse icon-button" aria-label={collapsed ? '展开导航' : '收起导航'} onClick={() => setCollapsed((v) => !v)}><Menu size={18} /></button>
        <nav aria-label="主要导航" style={{ '--nav-index': navigation.findIndex((entry) => entry.id === page) } as React.CSSProperties}><span className="nav-selection" aria-hidden="true" />
          {navigation.map(({ id, label, icon: Icon }) => (
            <button title={label} aria-label={label} key={id} className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => { setPage(id); setMobileNav(false) }}>
              <Icon size={18} /><span>{label}</span>{id === 'inbox' && inboxCount > 0 && <b>{inboxCount}</b>}
            </button>
          ))}
        </nav>
        <div className="local-note"><ShieldCheck size={16} /><div><strong>全部保存在本地</strong><span>离线优先 · AI 按需启用</span></div></div>
      </aside>
      {mobileNav && <button className="scrim" aria-label="关闭导航" onClick={() => setMobileNav(false)} />}
      <section className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="打开导航" onClick={() => setMobileNav(true)}><Menu size={19} /></button>
          <div><strong>{navigation.find((item) => item.id === page)?.label}</strong><span>{page === 'review' ? '把注意力留给眼前这一题' : '错题资料仅保存在你的设备上'}</span></div>
          <CaptureButton onFiles={addFiles} />
        </header>
        <main id="main" className="page-transition" key={page}>
          {page === 'review' && <ReviewPage onGoInbox={() => setPage('inbox')} />}
          {page === 'inbox' && <InboxPage focusId={captureFocus} onFiles={addFiles} onSettings={() => setPage('settings')} />}
          {page === 'library' && <LibraryPage />}
          {page === 'history' && <HistoryPage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </section>
      {(dragActive || captureBusy) && <div className="drop-overlay"><div><ImagePlus size={28} /><strong>{captureBusy ? '正在读取图片…' : '松开后选择分组与题型'}</strong><span>确认题型后才会创建错题，此步骤仅在本机处理</span></div></div>}
      {pendingImport && <CaptureImportDialog images={pendingImport.images} skipped={pendingImport.skipped} onCancel={() => setImportQueue((queue) => queue.slice(1))} onComplete={completeImport} />}
      {captureNotice && <div className="toast" role="status">{captureNotice}</div>}
    </div>
  )
}

function CaptureButton({ onFiles }: { onFiles: (files: FileList) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return <><button type="button" className="button primary capture-button" onClick={() => input.current?.click()}><ImagePlus size={17} />收录截图</button><input ref={input} hidden type="file" accept={IMAGE_ACCEPT} multiple onChange={(event) => { if (event.target.files?.length) onFiles(event.target.files); event.target.value = '' }} /></>
}

function CaptureDropZone({ onFiles, compact = false }: { onFiles: (files: FileList) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  return <><button type="button" className={`capture-dropzone ${compact ? 'compact' : ''}`} onClick={() => input.current?.click()}><ImagePlus size={compact ? 17 : 24} /><span><strong>{compact ? '拖入图片' : '把题目图片拖到这里'}</strong><small>{compact ? '或点击选择' : '支持 PNG、JPEG、WebP、GIF、BMP，也可以直接粘贴截图'}</small></span></button><input ref={input} hidden type="file" accept={IMAGE_ACCEPT} multiple onChange={(event) => { if (event.target.files?.length) onFiles(event.target.files); event.target.value = '' }} /></>
}

function ReviewPage({ onGoInbox }: { onGoInbox: () => void }) {
  const allItems = useNotebook((state) => state.items)
  const rate = useNotebook((state) => state.rate)
  const undo = useNotebook((state) => state.undoRating)
  const lastReview = useNotebook((state) => state.lastReview)
  const reviewSettings = useNotebook((state) => state.reviewSettings)
  const [queueIds, setQueueIds] = useState(() => selectDue(useNotebook.getState()).map((item) => item.id))
  const initialTotal = useRef(queueIds.length)
  const [revealed, setRevealed] = useState(false)
  const [answerText, setAnswerText] = useState('')
  const [ratingBusy, setRatingBusy] = useState(false)
  const [queueOpen, setQueueOpen] = useState(true)
  const [reviewError, setReviewError] = useState('')
  const startedAt = useRef(Date.now())
  const queue = queueIds.flatMap((id) => { const item = allItems.find((entry) => entry.id === id && entry.status === 'ready'); return item ? [item] : [] })
  const item = queue[0]
  const complete = !item

  const submitRating = async (rating: Rating) => {
    if (!item || ratingBusy) return
    setRatingBusy(true); setReviewError('')
    try {
      await rate(item.id, rating, answerText, Math.max(1, Math.round((Date.now() - startedAt.current) / 1000)))
      setQueueIds((ids) => ids.filter((id) => id !== item.id))
      setRevealed(false); setAnswerText(''); startedAt.current = Date.now()
    } catch { setReviewError('评分没有保存成功，请检查磁盘空间后重试。') }
    finally { setRatingBusy(false) }
  }

  const undoLast = async () => {
    if (!lastReview) return
    setReviewError('')
    try {
      await undo()
      setQueueIds((ids) => [lastReview.mistakeId, ...ids.filter((id) => id !== lastReview.mistakeId)])
      initialTotal.current = Math.max(initialTotal.current, queueIds.length + 1)
    } catch { setReviewError('撤销没有保存成功，请稍后重试。') }
  }

  if (complete) return (
    <div className="empty-focus">
      <span className="success-orb"><BookOpenCheck size={28} /></span>
      <h1>今天到期的题已经复习完了</h1>
      <p>做得不错。新的安排已根据本次反馈写入本地复习计划。</p>
      {reviewError && <p className="field-error" role="alert">{reviewError}</p>}
      <div className="button-row">
        {lastReview && <button className="button ghost" onClick={() => void undoLast()}><RotateCcw size={16} />撤销上一条评分</button>}
        <button className="button primary" onClick={onGoInbox}>整理收集箱</button>
      </div>
    </div>
  )

  return (
    <div className={`review-layout ${queueOpen ? '' : 'queue-hidden'}`}><button className="button ghost compact queue-toggle" aria-expanded={queueOpen} onClick={() => setQueueOpen((v) => !v)}>{queueOpen ? '收起队列' : '显示队列'}</button>
      <section className="review-canvas">
        <div className="breadcrumb"><span>{item.exam}</span><ChevronRight /><span>{item.subject}</span><ChevronRight /><strong>{item.chapter}</strong></div>
        <article className="question-sheet">
          <div className="question-heading"><div><span>本轮还剩 {queue.length} 题</span><h1>{item.question || '未填写题干'}</h1></div></div>
          <ImageStrip images={item.images} masked={!revealed} />
          {!revealed ? (
            <>
              <QuestionAnswerInput item={item} value={answerText} onChange={setAnswerText} />
              <div className="review-actions"><button className="button ghost" disabled={queue.length < 2} onClick={() => { setQueueIds((ids) => [...ids.slice(1), ids[0]]); setAnswerText(''); setRevealed(false); startedAt.current = Date.now() }}>暂时跳过</button><button className="button primary" onClick={() => setRevealed(true)}>显示答案</button></div>
            </>
          ) : (
            <div className="answer-reveal">
              <QuestionAnswerReveal item={item} />
              {item.cause && <div className="cause-block"><span>上次为什么错</span><p>{item.cause}</p></div>}
              <div className="rating-area"><span>这次掌握得怎么样？</span><div className="rating-grid">
                <RatingButton id="again" label="重来" hint={ratingIntervalHint('again', reviewSettings)} disabled={ratingBusy} onClick={submitRating} />
                <RatingButton id="hard" label="困难" hint={ratingIntervalHint('hard', reviewSettings)} disabled={ratingBusy} onClick={submitRating} />
                <RatingButton id="good" label="良好" hint={ratingIntervalHint('good', reviewSettings)} disabled={ratingBusy} onClick={submitRating} />
                <RatingButton id="easy" label="简单" hint={ratingIntervalHint('easy', reviewSettings)} disabled={ratingBusy} onClick={submitRating} />
              </div>{reviewError && <small className="field-error" role="alert">{reviewError}</small>}</div>
            </div>
          )}
        </article>
      </section>
      <aside className="queue-panel">
        <div className="queue-title"><div><span>今日队列</span><strong>{Math.max(0, initialTotal.current - queue.length)} / {initialTotal.current}</strong></div><div className="progress"><i style={{ width: `${initialTotal.current ? ((initialTotal.current - queue.length) / initialTotal.current) * 100 : 100}%` }} /></div><small>预计还需 {Math.max(2, queue.length * 3)} 分钟</small></div>
        <div className="queue-list">{queue.slice(1, 7).map((entry, position) => <button key={entry.id} onClick={() => setQueueIds((ids) => [entry.id, ...ids.filter((id) => id !== entry.id)])}><span>{position + 2}</span><div><strong>{entry.question}</strong><small>{entry.subject} · {entry.chapter}</small></div></button>)}</div>
      </aside>
    </div>
  )
}

function RatingButton({ id, label, hint, disabled, onClick }: { id: Rating; label: string; hint: string; disabled?: boolean; onClick: (id: Rating) => void | Promise<void> }) {
  return <button className={`rating ${id}`} disabled={disabled} onClick={() => void onClick(id)}><strong>{label}</strong><span>{hint}</span></button>
}

function InboxPage({ focusId, onFiles, onSettings }: { focusId?: string; onFiles: (files: FileList) => void; onSettings: () => void }) {
  const allItems = useNotebook((state) => state.items)
  const items = useMemo(() => allItems.filter((item) => item.status === 'inbox'), [allItems])
  const [selected, setSelected] = useState(items[0]?.id)
  const [successNotice, setSuccessNotice] = useState('')
  const successTimer = useRef<number | undefined>(undefined)
  const item = items.find((entry) => entry.id === selected) ?? items[0]
  useEffect(() => { if (!items.some((entry) => entry.id === selected)) setSelected(items[0]?.id) }, [items, selected])
  useEffect(() => { if (focusId && items.some((entry) => entry.id === focusId)) setSelected(focusId) }, [focusId, items])
  useEffect(() => () => window.clearTimeout(successTimer.current), [])
  const completeAndContinue = (id: string) => {
    setSelected(items.find((entry) => entry.id !== id)?.id ?? '')
    setSuccessNotice('已完成整理')
    window.clearTimeout(successTimer.current)
    successTimer.current = window.setTimeout(() => setSuccessNotice(''), 1800)
  }
  const notice = successNotice && <div className="success-toast" role="status"><span><Check size={15} /></span>{successNotice}</div>
  if (!item) return <><div className="empty-capture"><Empty title="收集箱已经整理干净" description="把题目截图拖到下方，系统会先替你稳稳保存下来。" icon={Inbox} compact /><CaptureDropZone onFiles={onFiles} /></div>{notice}</>
  return (
    <div className="inbox-layout">
      <aside className="inbox-list">
        <div className="panel-heading"><div><h1>待整理</h1><span>还剩 {items.length} 题</span></div></div>
        <CaptureDropZone onFiles={onFiles} compact />
        {items.map((entry) => <button key={entry.id} className={entry.id === item.id ? 'active' : ''} onClick={() => setSelected(entry.id)}><span>{entry.images[0] ? <AnnotatedImage image={entry.images[0]} showMasks alt="题目缩略图" /> : <ImagePlus />}</span><div><strong>{entry.question || `${entry.questionType === 'choice' ? '选择题' : entry.questionType === 'fill-blank' ? '填空题' : '简答题'} · 等待识别`}</strong><small>{new Date(entry.createdAt).toLocaleString('zh-CN')}</small></div></button>)}
      </aside>
      <Organizer key={item.id} item={item} onNext={completeAndContinue} remaining={items.length} onSettings={onSettings} />
      {notice}
    </div>
  )
}

function LibraryPage() {
  const all = useNotebook((state) => state.items)
  const trash = useNotebook((state) => state.trashItem)
  const restore = useNotebook((state) => state.restoreItem)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'active' | 'trash'>('active')
  const [exam, setExam] = useState('全部考试')
  const [subject, setSubject] = useState(''), [chapter, setChapter] = useState(''), [tag, setTag] = useState(''), [due, setDue] = useState('')
  const [selected, setSelected] = useState<Mistake>()
  const items = useMemo(() => all.filter((item) => (view === 'trash' ? item.status === 'trashed' : item.status === 'ready') && (exam === '全部考试' || item.exam === exam) && (!subject || item.subject === subject) && (!chapter || item.chapter === chapter) && (!tag || item.tags.includes(tag)) && (!due || (due === 'due' ? Date.parse(item.schedule.due) <= Date.now() : Date.parse(item.schedule.due) > Date.now())) && `${item.question} ${item.answer} ${item.cause} ${item.note} ${item.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())), [all, view, exam, query, subject, chapter, tag, due])
  const exams = Array.from(new Set(all.map((item) => item.exam).filter(Boolean)))
  return (
    <div className="page">
      <div className="page-heading"><div><h1>{view === 'trash' ? '回收站' : '全部错题'}</h1><p>{view === 'trash' ? '删除满 30 天后才会永久清理。' : '按考试、科目和章节找回每一道题。'}</p></div><button className="button ghost" onClick={() => setView(view === 'active' ? 'trash' : 'active')}>{view === 'active' ? <><Trash2 size={16} />回收站</> : <><ArchiveRestore size={16} />返回题库</>}</button></div>
      <div className="filterbar"><label className="search"><Search size={17} /><input aria-label="搜索错题" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索题目、答案、错因或标签" /></label><select aria-label="筛选考试" value={exam} onChange={(e) => {setExam(e.target.value);setSubject('');setChapter('')}}><option>全部考试</option>{exams.map((value) => <option key={value}>{value}</option>)}</select><select aria-label="筛选科目" value={subject} onChange={(e) => {setSubject(e.target.value);setChapter('')}}><option value="">全部科目</option>{Array.from(new Set(all.filter((i) => exam === '全部考试' || i.exam === exam).map((i) => i.subject).filter(Boolean))).map((v) => <option key={v}>{v}</option>)}</select><select aria-label="筛选章节" value={chapter} onChange={(e) => setChapter(e.target.value)}><option value="">全部章节</option>{Array.from(new Set(all.filter((i) => (exam === '全部考试' || i.exam === exam) && (!subject || i.subject === subject)).map((i) => i.chapter).filter(Boolean))).map((v) => <option key={v}>{v}</option>)}</select><select aria-label="筛选标签" value={tag} onChange={(e) => setTag(e.target.value)}><option value="">全部标签</option>{Array.from(new Set(all.flatMap((i) => i.tags))).map((v) => <option key={v}>{v}</option>)}</select><select aria-label="筛选到期状态" value={due} onChange={(e) => setDue(e.target.value)}><option value="">全部时间</option><option value="due">已到期</option><option value="future">未到期</option></select></div>
      <div className="table-list" role="list">
        {items.map((item) => <button key={item.id} className="table-row" onClick={() => setSelected(item)}><div className="row-main"><strong>{item.question}</strong><span>{item.exam} / {item.subject} / {item.chapter}</span></div><div className="tags">{item.tags.slice(0, 2).map((tag) => <i key={tag}>{tag}</i>)}</div><span className={`due ${scheduleLabel(item.schedule) === '到期' ? 'overdue' : ''}`}>{scheduleLabel(item.schedule)}</span><ChevronRight size={17} /></button>)}
        {!items.length && <Empty title="没有匹配的错题" description="调整筛选条件，或先从收集箱整理一道题。" icon={Search} compact />}
      </div>
      {selected && <DetailDrawer item={selected} onClose={() => setSelected(undefined)} onTrash={() => { trash(selected.id); setSelected(undefined) }} onRestore={() => { restore(selected.id); setSelected(undefined) }} />}
    </div>
  )
}

function DetailDrawer({ item, onClose, onTrash, onRestore }: { item: Mistake; onClose: () => void; onTrash: () => void; onRestore: () => void }) {
  const update = useNotebook((state) => state.updateItem)
  const taxonomy = useNotebook((state) => state.taxonomy)
  const addExam = useNotebook((state) => state.addExam)
  const addSubject = useNotebook((state) => state.addSubject)
  const addChapter = useNotebook((state) => state.addChapter)
  const [draft, setDraft] = useState(item)
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  const exams = taxonomy.exams
  const subjects = exams.find((entry) => entry.name === draft.exam)?.subjects ?? []
  const chapters = subjects.find((entry) => entry.name === draft.subject)?.chapters ?? []
  return <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><aside className="drawer" role="dialog" aria-modal="true" aria-label="错题详情"><header><div><span>{draft.exam || '未分类'} / {draft.subject || '未选择科目'} / {draft.chapter || '未选择章节'}</span><strong>错题详情</strong></div><button className="icon-button" aria-label="关闭详情" onClick={onClose}><X size={18} /></button></header><div className="drawer-body"><ImageStrip images={draft.images} /><div className="form-grid three taxonomy-grid"><TaxonomySelect label="考试" value={draft.exam} options={exams.map((entry) => entry.name)} addLabel="新增考试" onChange={(exam) => setDraft({ ...draft, exam, subject: '', chapter: '' })} onAdd={(name) => { const error = addExam(name); if (!error) setDraft({ ...draft, exam: name, subject: '', chapter: '' }); return error }} /><TaxonomySelect label="科目" value={draft.subject} options={subjects.map((entry) => entry.name)} addLabel="新增科目" disabled={!draft.exam} onChange={(subject) => setDraft({ ...draft, subject, chapter: '' })} onAdd={(name) => { const error = addSubject(draft.exam, name); if (!error) setDraft({ ...draft, subject: name, chapter: '' }); return error }} /><TaxonomySelect label="章节" value={draft.chapter} options={chapters} addLabel="新增章节" disabled={!draft.subject} onChange={(chapter) => setDraft({ ...draft, chapter })} onAdd={(name) => { const error = addChapter(draft.exam, draft.subject, name); if (!error) setDraft({ ...draft, chapter: name }); return error }} /></div><Field label="题干"><textarea value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} /></Field><QuestionTypeFields item={draft} onPatch={(patch) => setDraft((current) => ({ ...current, ...patch }))} /><Field label="错因"><textarea value={draft.cause} onChange={(e) => setDraft({ ...draft, cause: e.target.value })} /></Field><Field label="个人笔记"><textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></Field><Field label="标签"><input value={draft.tags.join('，')} onChange={(e) => setDraft({ ...draft, tags: e.target.value.split(/[，,]/).map((value) => value.trim()).filter(Boolean) })} placeholder="用逗号分隔" /></Field></div><footer>{item.status === 'trashed' ? <button className="button ghost" onClick={onRestore}><ArchiveRestore size={16} />恢复错题</button> : <button className="button danger" onClick={onTrash}><Trash2 size={16} />移到回收站</button>}<button className="button primary" disabled={!draft.question.trim()} onClick={() => { update(item.id, draft); onClose() }}>保存修改</button></footer></aside></div>
}

function HistoryPage() {
  const reviews = useNotebook((state) => state.reviews)
  const items = useNotebook((state) => state.items)
  const label: Record<Rating, string> = { again: '重来', hard: '困难', good: '良好', easy: '简单' }
  const dates = Array.from(new Set(reviews.map((r) => new Date(r.reviewedAt).toLocaleDateString('zh-CN'))))
  return <div className="page narrow"><div className="page-heading"><div><h1>复习记录</h1><p>每一次认真作答，都留下可回看的痕迹。</p></div></div>{dates.map((date) => <section className="history-group" key={date}><h2>{date}</h2>{reviews.filter((r) => new Date(r.reviewedAt).toLocaleDateString('zh-CN') === date).map((review) => <details className="history-record" key={review.id}><summary><span className={`rating-dot ${review.rating}`} /><div><strong>{items.find((i) => i.id === review.mistakeId)?.question || '已删除的错题'}</strong><small>{new Date(review.reviewedAt).toLocaleTimeString('zh-CN')} · 用时 {review.durationSeconds} 秒</small></div><b>{label[review.rating]}</b><ChevronDown size={15} /></summary><div className="history-evidence"><p>{review.answerText || '本次未输入文字答案'}</p><dl><div><dt>复习前到期</dt><dd>{new Date(review.before.due).toLocaleDateString('zh-CN')}</dd></div><div><dt>下次复习</dt><dd>{new Date(review.after.due).toLocaleDateString('zh-CN')}</dd></div><div><dt>累计复习</dt><dd>{review.after.reps} 次</dd></div></dl></div></details>)}</section>)}{!reviews.length && <Empty title="还没有复习记录" description="完成第一道到期错题后，这里会留下完整的作答与评分证据。" icon={History} compact />}</div>
}
