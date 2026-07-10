import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArchiveRestore, BookOpenCheck, ChevronDown, ChevronRight, Clock3, FileArchive, FolderCog, History,
  FolderOpen, ImagePlus, Inbox, Layers3, ListFilter, Menu, MoreHorizontal, NotebookTabs, PencilLine, Plus, RotateCcw,
  Search, Settings, ShieldCheck, Trash2, Upload, X,
} from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { ImageEditor } from './components/ImageEditor'
import { selectDue, scheduleLabel, useNotebook } from './store'
import type { ImageAsset, Mistake, Notebook, Page, Rating } from './types'

const navigation: Array<{ id: Page; label: string; icon: typeof Inbox }> = [
  { id: 'review', label: '今日复习', icon: BookOpenCheck },
  { id: 'inbox', label: '收集箱', icon: Inbox },
  { id: 'library', label: '全部错题', icon: Layers3 },
  { id: 'history', label: '复习记录', icon: History },
  { id: 'settings', label: '设置', icon: Settings },
]

export function App() {
  const [page, setPage] = useState<Page>('review')
  const [mobileNav, setMobileNav] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [captureNotice, setCaptureNotice] = useState('')
  const addCapture = useNotebook((state) => state.addCapture)
  const inboxCount = useNotebook((state) => state.items.filter((item) => item.status === 'inbox').length)

  const addFiles = async (files: FileList | File[]) => {
    const images = await Promise.all(Array.from(files).filter((file) => file.type.startsWith('image/')).map(fileToAsset))
    if (images.length) {
      addCapture(images)
      setPage('inbox')
      setCaptureNotice(`已收录 ${images.length} 张图片，可稍后慢慢整理`)
      window.setTimeout(() => setCaptureNotice(''), 2600)
    }
  }

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'))
      if (files.length) void addFiles(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  return (
    <div className="app-shell" onDragOver={(event) => { event.preventDefault(); if (Array.from(event.dataTransfer.types).includes('Files')) setDragActive(true) }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false) }} onDrop={(event) => { event.preventDefault(); setDragActive(false); void addFiles(event.dataTransfer.files) }}>
      <a className="skip-link" href="#main">跳到主要内容</a>
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <div className="brand"><span className="brand-mark"><NotebookTabs size={22} /></span><div><strong>错题本</strong><small>本地学习工作台</small></div></div>
        <nav aria-label="主要导航">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => { setPage(id); setMobileNav(false) }}>
              <Icon size={18} /><span>{label}</span>{id === 'inbox' && inboxCount > 0 && <b>{inboxCount}</b>}
            </button>
          ))}
        </nav>
        <div className="local-note"><ShieldCheck size={16} /><div><strong>全部保存在本地</strong><span>无登录 · 无云端 · 无 AI</span></div></div>
      </aside>
      {mobileNav && <button className="scrim" aria-label="关闭导航" onClick={() => setMobileNav(false)} />}
      <section className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="打开导航" onClick={() => setMobileNav(true)}><Menu size={19} /></button>
          <div><strong>{navigation.find((item) => item.id === page)?.label}</strong><span>{page === 'review' ? '把注意力留给眼前这一题' : '错题资料仅保存在你的设备上'}</span></div>
          <CaptureButton onFiles={addFiles} />
        </header>
        <main id="main">
          {page === 'review' && <ReviewPage onGoInbox={() => setPage('inbox')} />}
          {page === 'inbox' && <InboxPage />}
          {page === 'library' && <LibraryPage />}
          {page === 'history' && <HistoryPage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </section>
      {dragActive && <div className="drop-overlay"><div><ImagePlus size={28} /><strong>松开即可收录图片</strong><span>图片会先进入收集箱，不会打断当前工作</span></div></div>}
      {captureNotice && <div className="toast" role="status">{captureNotice}</div>}
    </div>
  )
}

function CaptureButton({ onFiles }: { onFiles: (files: FileList) => void }) {
  return <label className="button primary capture-button"><ImagePlus size={17} />收录截图<input hidden type="file" accept="image/*" multiple onChange={(event) => { if (event.target.files?.length) onFiles(event.target.files); event.target.value = '' }} /></label>
}

function ReviewPage({ onGoInbox }: { onGoInbox: () => void }) {
  const allItems = useNotebook((state) => state.items)
  const due = useMemo(() => selectDue(useNotebook.getState()), [allItems])
  const rate = useNotebook((state) => state.rate)
  const undo = useNotebook((state) => state.undoRating)
  const lastReview = useNotebook((state) => state.lastReview)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [answerText, setAnswerText] = useState('')
  const startedAt = useRef(Date.now())
  const item = due[index]
  const complete = !item

  const submitRating = (rating: Rating) => {
    if (!item) return
    rate(item.id, rating, answerText, Math.max(1, Math.round((Date.now() - startedAt.current) / 1000)))
    setRevealed(false); setAnswerText(''); startedAt.current = Date.now()
  }

  if (complete) return (
    <div className="empty-focus">
      <span className="success-orb"><BookOpenCheck size={28} /></span>
      <h1>今天到期的题已经复习完了</h1>
      <p>做得不错。新的安排已根据本次反馈写入本地复习计划。</p>
      <div className="button-row">
        {lastReview && <button className="button ghost" onClick={undo}><RotateCcw size={16} />撤销上一条评分</button>}
        <button className="button primary" onClick={onGoInbox}>整理收集箱</button>
      </div>
    </div>
  )

  return (
    <div className="review-layout">
      <section className="review-canvas">
        <div className="breadcrumb"><span>{item.exam}</span><ChevronRight /><span>{item.subject}</span><ChevronRight /><strong>{item.chapter}</strong></div>
        <article className="question-sheet">
          <div className="question-heading"><div><span>题目 {index + 1} / {due.length}</span><h1>{item.question || '未填写题干'}</h1></div><button className="icon-button" aria-label="更多操作"><MoreHorizontal size={18} /></button></div>
          <ImageStrip images={item.images} masked={!revealed} />
          {!revealed ? (
            <>
              <label className="field answer-field"><span>输入本次答案（可选）</span><textarea value={answerText} onChange={(event) => setAnswerText(event.target.value)} placeholder="写下你的解题思路或答案，揭示后可以对照……" /></label>
              <div className="review-actions"><button className="button ghost" onClick={() => setIndex((value) => value + 1)}>暂时跳过</button><button className="button primary" onClick={() => setRevealed(true)}>显示答案</button></div>
            </>
          ) : (
            <div className="answer-reveal">
              <div className="answer-block"><span>正确答案与思路</span><p>{item.answer || '这道题还没有填写正确答案。可以在全部错题中补充。'}</p></div>
              {item.cause && <div className="cause-block"><span>上次为什么错</span><p>{item.cause}</p></div>}
              <div className="rating-area"><span>这次掌握得怎么样？</span><div className="rating-grid">
                <RatingButton id="again" label="重来" hint="很快再看" onClick={submitRating} />
                <RatingButton id="hard" label="困难" hint="缩短间隔" onClick={submitRating} />
                <RatingButton id="good" label="良好" hint="正常安排" onClick={submitRating} />
                <RatingButton id="easy" label="简单" hint="延长间隔" onClick={submitRating} />
              </div></div>
            </div>
          )}
        </article>
      </section>
      <aside className="queue-panel">
        <div className="queue-title"><div><span>今日队列</span><strong>{index + 1} / {due.length}</strong></div><div className="progress"><i style={{ width: `${((index + 1) / due.length) * 100}%` }} /></div><small>预计还需 {Math.max(2, (due.length - index) * 3)} 分钟</small></div>
        <div className="queue-list">{due.slice(index + 1, index + 7).map((entry, position) => <button key={entry.id} onClick={() => setIndex(index + 1 + position)}><span>{index + position + 2}</span><div><strong>{entry.question}</strong><small>{entry.subject} · {entry.chapter}</small></div></button>)}</div>
      </aside>
    </div>
  )
}

function RatingButton({ id, label, hint, onClick }: { id: Rating; label: string; hint: string; onClick: (id: Rating) => void }) {
  return <button className={`rating ${id}`} onClick={() => onClick(id)}><strong>{label}</strong><span>{hint}</span></button>
}

function InboxPage() {
  const allItems = useNotebook((state) => state.items)
  const items = useMemo(() => allItems.filter((item) => item.status === 'inbox'), [allItems])
  const [selected, setSelected] = useState(items[0]?.id)
  const item = items.find((entry) => entry.id === selected) ?? items[0]
  useEffect(() => { if (!items.some((entry) => entry.id === selected)) setSelected(items[0]?.id) }, [items, selected])
  if (!item) return <Empty title="收集箱已经整理干净" description="复制截图后直接按 ⌘V，或拖入图片，系统会先替你稳稳保存下来。" icon={Inbox} />
  return (
    <div className="inbox-layout">
      <aside className="inbox-list">
        <div className="panel-heading"><div><h1>待整理</h1><span>还剩 {items.length} 题</span></div><button className="icon-button"><ListFilter size={17} /></button></div>
        {items.map((entry) => <button key={entry.id} className={entry.id === item.id ? 'active' : ''} onClick={() => setSelected(entry.id)}><span>{entry.images[0] ? <img src={entry.images[0].dataUrl} /> : <ImagePlus />}</span><div><strong>{entry.question}</strong><small>{new Date(entry.createdAt).toLocaleString('zh-CN')}</small></div></button>)}
      </aside>
      <Organizer item={item} onNext={(id) => setSelected(items.find((entry) => entry.id !== id)?.id ?? '')} remaining={items.length} />
    </div>
  )
}

function Organizer({ item, onNext, remaining }: { item: Mistake; onNext: (id: string) => void; remaining: number }) {
  const save = useNotebook((state) => state.saveOrganized)
  const updateItem = useNotebook((state) => state.updateItem)
  const trash = useNotebook((state) => state.trashItem)
  const taxonomy = useNotebook((state) => state.taxonomy)
  const addExam = useNotebook((state) => state.addExam)
  const addSubject = useNotebook((state) => state.addSubject)
  const addChapter = useNotebook((state) => state.addChapter)
  const [form, setForm] = useState(item)
  const [editingImage, setEditingImage] = useState<ImageAsset>()
  const imageInput = useRef<HTMLInputElement>(null)
  useEffect(() => setForm(item), [item.id])
  const exams = taxonomy.exams
  const subjects = exams.find((entry) => entry.name === form.exam)?.subjects ?? []
  const chapters = subjects.find((entry) => entry.name === form.subject)?.chapters ?? []
  const patch = <K extends keyof Mistake>(key: K, value: Mistake[K]) => {
    setForm((state) => ({ ...state, [key]: value }))
    updateItem(item.id, { [key]: value })
  }
  const patchFields = (values: Partial<Mistake>) => { setForm((state) => ({ ...state, ...values })); updateItem(item.id, values) }
  const saveNext = () => {
    if (!form.exam || !form.subject || !form.chapter || !form.question.trim()) return
    save(item.id, form)
    onNext(item.id)
  }
  const addImages = async (files?: FileList | null) => {
    if (!files?.length) return
    const assets = await Promise.all(Array.from(files).filter((file) => file.type.startsWith('image/')).map(fileToAsset))
    if (assets.length) patch('images', [...form.images, ...assets])
    if (imageInput.current) imageInput.current.value = ''
  }
  const replaceImage = async (index: number, file?: File) => {
    if (!file?.type.startsWith('image/')) return
    const asset = await fileToAsset(file)
    const images = [...form.images]
    images[index] = { ...asset, id: images[index].id }
    patch('images', images)
  }
  return (
    <section className="organizer">
      <header><div><span>整理错题</span><strong>保存后自动进入下一题</strong></div><div className="button-row"><button className="button danger" onClick={() => { trash(item.id); onNext(item.id) }}><Trash2 size={16} />移到回收站</button><button className="button primary" disabled={!form.exam || !form.subject || !form.chapter || !form.question.trim()} onClick={saveNext}>保存并继续 <span>{remaining - 1 > 0 ? `· 还剩 ${remaining - 1}` : ''}</span></button></div></header>
      <div className="organizer-scroll">
        <div className="organizer-images"><div className="section-label"><div><strong>题目图片</strong><span>{form.images.length ? `${form.images.length} 张，可排序和继续标注` : '这条记录还没有图片'}</span></div><button className="button ghost" type="button" onClick={() => imageInput.current?.click()}><ImagePlus size={16} />添加图片</button><input ref={imageInput} hidden type="file" accept="image/*" multiple onChange={(event) => void addImages(event.target.files)} /></div>{form.images.length ? <ImageStrip images={form.images} onEdit={setEditingImage} onReorder={(images) => patch('images', images)} onDelete={(index) => patch('images', form.images.filter((_, position) => position !== index))} onReplace={replaceImage} /> : <div className="image-empty"><ImagePlus size={22} /><span>可以只整理文字，也可以从这里补充题目截图</span></div>}</div>
        <div className="form-grid three taxonomy-grid">
          <TaxonomySelect label="考试" value={form.exam} options={exams.map((entry) => entry.name)} addLabel="新增考试" onChange={(exam) => patchFields({ exam, subject: '', chapter: '' })} onAdd={(name) => { const error = addExam(name); if (!error) patchFields({ exam: name, subject: '', chapter: '' }); return error }} />
          <TaxonomySelect label="科目" value={form.subject} options={subjects.map((entry) => entry.name)} addLabel="新增科目" disabled={!form.exam} onChange={(subject) => patchFields({ subject, chapter: '' })} onAdd={(name) => { const error = addSubject(form.exam, name); if (!error) patchFields({ subject: name, chapter: '' }); return error }} />
          <TaxonomySelect label="章节" value={form.chapter} options={chapters} addLabel="新增章节" disabled={!form.subject} onChange={(chapter) => patch('chapter', chapter)} onAdd={(name) => { const error = addChapter(form.exam, form.subject, name); if (!error) patch('chapter', name); return error }} />
        </div>
        <Field label="题干"><textarea value={form.question} onChange={(e) => patch('question', e.target.value)} /></Field>
        <Field label="正确答案 / 解题思路"><textarea value={form.answer} onChange={(e) => patch('answer', e.target.value)} placeholder="整理出下次复习时真正有用的思路" /></Field>
        <div className="form-grid two">
          <Field label="错因"><textarea value={form.cause} onChange={(e) => patch('cause', e.target.value)} placeholder="概念不清、计算失误、审题遗漏……" /></Field>
          <Field label="个人笔记"><textarea value={form.note} onChange={(e) => patch('note', e.target.value)} placeholder="给下次复习的自己留一句提醒" /></Field>
        </div>
        <Field label="标签"><input value={form.tags.join('，')} onChange={(e) => patch('tags', e.target.value.split(/[，,]/).map((value) => value.trim()).filter(Boolean))} placeholder="用逗号分隔，例如：泰勒展开，易错" /></Field>
        <p className="autosave-note"><ShieldCheck size={14} />编辑内容已自动保存到收集箱</p>
      </div>
      {editingImage && <ImageEditor image={editingImage} onClose={() => setEditingImage(undefined)} onSave={(image) => { const images = form.images.map((entry) => entry.id === image.id ? image : entry); patch('images', images); updateItem(item.id, { images }); setEditingImage(undefined) }} />}
    </section>
  )
}

function LibraryPage() {
  const all = useNotebook((state) => state.items)
  const trash = useNotebook((state) => state.trashItem)
  const restore = useNotebook((state) => state.restoreItem)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'active' | 'trash'>('active')
  const [exam, setExam] = useState('全部考试')
  const [selected, setSelected] = useState<Mistake>()
  const items = useMemo(() => all.filter((item) => (view === 'trash' ? item.status === 'trashed' : item.status === 'ready') && (exam === '全部考试' || item.exam === exam) && `${item.question} ${item.answer} ${item.cause} ${item.note} ${item.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())), [all, view, exam, query])
  const exams = Array.from(new Set(all.map((item) => item.exam).filter(Boolean)))
  return (
    <div className="page">
      <div className="page-heading"><div><h1>{view === 'trash' ? '回收站' : '全部错题'}</h1><p>{view === 'trash' ? '删除满 30 天后才会永久清理。' : '按考试、科目和章节找回每一道题。'}</p></div><button className="button ghost" onClick={() => setView(view === 'active' ? 'trash' : 'active')}>{view === 'active' ? <><Trash2 size={16} />回收站</> : <><ArchiveRestore size={16} />返回题库</>}</button></div>
      <div className="filterbar"><label className="search"><Search size={17} /><input aria-label="搜索错题" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索题目、答案、错因或标签" /></label><select value={exam} onChange={(e) => setExam(e.target.value)}><option>全部考试</option>{exams.map((value) => <option key={value}>{value}</option>)}</select></div>
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
  const exams = taxonomy.exams
  const subjects = exams.find((entry) => entry.name === draft.exam)?.subjects ?? []
  const chapters = subjects.find((entry) => entry.name === draft.subject)?.chapters ?? []
  return <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><aside className="drawer" role="dialog" aria-modal="true" aria-label="错题详情"><header><div><span>{draft.exam || '未分类'} / {draft.subject || '未选择科目'} / {draft.chapter || '未选择章节'}</span><strong>错题详情</strong></div><button className="icon-button" aria-label="关闭详情" onClick={onClose}><X size={18} /></button></header><div className="drawer-body"><ImageStrip images={draft.images} /><div className="form-grid three taxonomy-grid"><TaxonomySelect label="考试" value={draft.exam} options={exams.map((entry) => entry.name)} addLabel="新增考试" onChange={(exam) => setDraft({ ...draft, exam, subject: '', chapter: '' })} onAdd={(name) => { const error = addExam(name); if (!error) setDraft({ ...draft, exam: name, subject: '', chapter: '' }); return error }} /><TaxonomySelect label="科目" value={draft.subject} options={subjects.map((entry) => entry.name)} addLabel="新增科目" disabled={!draft.exam} onChange={(subject) => setDraft({ ...draft, subject, chapter: '' })} onAdd={(name) => { const error = addSubject(draft.exam, name); if (!error) setDraft({ ...draft, subject: name, chapter: '' }); return error }} /><TaxonomySelect label="章节" value={draft.chapter} options={chapters} addLabel="新增章节" disabled={!draft.subject} onChange={(chapter) => setDraft({ ...draft, chapter })} onAdd={(name) => { const error = addChapter(draft.exam, draft.subject, name); if (!error) setDraft({ ...draft, chapter: name }); return error }} /></div><Field label="题干"><textarea value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} /></Field><Field label="正确答案"><textarea value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} /></Field><Field label="错因"><textarea value={draft.cause} onChange={(e) => setDraft({ ...draft, cause: e.target.value })} /></Field><Field label="个人笔记"><textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></Field><Field label="标签"><input value={draft.tags.join('，')} onChange={(e) => setDraft({ ...draft, tags: e.target.value.split(/[，,]/).map((value) => value.trim()).filter(Boolean) })} placeholder="用逗号分隔" /></Field></div><footer>{item.status === 'trashed' ? <button className="button ghost" onClick={onRestore}><ArchiveRestore size={16} />恢复错题</button> : <button className="button danger" onClick={onTrash}><Trash2 size={16} />移到回收站</button>}<button className="button primary" disabled={!draft.question.trim()} onClick={() => { update(item.id, draft); onClose() }}>保存修改</button></footer></aside></div>
}

function HistoryPage() {
  const reviews = useNotebook((state) => state.reviews)
  const items = useNotebook((state) => state.items)
  const label: Record<Rating, string> = { again: '重来', hard: '困难', good: '良好', easy: '简单' }
  return <div className="page narrow"><div className="page-heading"><div><h1>复习记录</h1><p>每次作答和评分都会成为下一次安排的依据。</p></div></div><div className="history-list">{reviews.map((review) => { const item = items.find((entry) => entry.id === review.mistakeId); return <div key={review.id} className="history-row"><span className={`rating-dot ${review.rating}`} /><div><strong>{item?.question ?? '已删除的错题'}</strong><p>{review.answerText || '本次未输入文字答案'}</p><small>{new Date(review.reviewedAt).toLocaleString('zh-CN')} · 用时 {review.durationSeconds} 秒</small></div><b>{label[review.rating]}</b></div> })}{!reviews.length && <Empty title="还没有复习记录" description="完成第一道到期错题后，这里会留下完整的作答与评分证据。" icon={History} compact />}</div></div>
}

function SettingsPage() {
  const notebook = useNotebook()
  const replace = useNotebook((state) => state.replaceNotebook)
  const purge = useNotebook((state) => state.purgeExpired)
  const setWorkspace = useNotebook((state) => state.setWorkspace)
  const fileInput = useRef<HTMLInputElement>(null)
  const [workspaceNotice, setWorkspaceNotice] = useState('')
  const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  const exportData = () => {
    const data: Notebook = { version: 1, items: notebook.items, reviews: notebook.reviews, taxonomy: notebook.taxonomy, workspaceName: notebook.workspaceName, workspacePath: notebook.workspacePath, workspaceUpdatedAt: new Date().toISOString() }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `错题本备份-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url)
  }
  const importData = async (file?: File) => {
    if (!file) return
    try { const data = JSON.parse(await file.text()) as Notebook; if (data.version !== 1 || !Array.isArray(data.items)) throw new Error(); replace(data) } catch { window.alert('无法读取这个备份文件。请确认它来自错题本。') }
  }
  const chooseWorkspace = async () => {
    if (!isDesktop) { setWorkspaceNotice('网页预览无法访问系统文件夹，请在桌面版中使用。'); return }
    try { const path = await invoke<string | null>('choose_workspace_folder'); if (path) { setWorkspace(path); setWorkspaceNotice('工作区已绑定，后续修改会同步写入 notebook.json。') } } catch { setWorkspaceNotice('没有完成文件夹绑定，请检查系统权限后重试。') }
  }
  const openWorkspace = async () => {
    if (!notebook.workspacePath) { setWorkspaceNotice('请先选择一个工作区文件夹。'); return }
    if (!isDesktop) { setWorkspaceNotice('网页预览无法打开 Finder，请在桌面版中使用。'); return }
    try { await invoke('open_workspace_folder', { path: notebook.workspacePath }) } catch { setWorkspaceNotice('无法打开该文件夹，它可能已经被移动或删除。') }
  }
  return <div className="page settings-page"><div className="page-heading"><div><h1>设置</h1><p>掌控工作区、备份和考试目录。</p></div></div><section className="settings-section catalog-settings"><div><h2>考试目录</h2><p>自定义考试、科目和章节。改名会同步更新已有错题；仍被使用的目录不会被误删。</p></div><CatalogManager /></section><section className="settings-section"><div><h2>本地工作区</h2><p>绑定后会在所选文件夹中维护可读的 notebook.json，并保留设备内副本。</p></div><div><div className="settings-action"><FolderCog size={20} /><div><strong>{notebook.workspaceName}</strong><span title={notebook.workspacePath || undefined}>{notebook.workspacePath || `${notebook.items.length} 道错题 · ${notebook.reviews.length} 条复习记录`}</span></div><div className="workspace-buttons"><button className="button ghost" onClick={openWorkspace} disabled={!notebook.workspacePath}><FolderOpen size={16} />打开文件夹</button><button className="button ghost" onClick={chooseWorkspace}>{notebook.workspacePath ? '重新定位' : '选择文件夹'}</button></div></div>{workspaceNotice && <p className="workspace-notice" role="status">{workspaceNotice}</p>}</div></section><section className="settings-section"><div><h2>备份与恢复</h2><p>备份包含题目元数据、图片和复习记录；导入前会先校验文件结构。</p></div><div className="button-row"><button className="button ghost" onClick={exportData}><FileArchive size={16} />导出备份</button><button className="button ghost" onClick={() => fileInput.current?.click()}><Upload size={16} />从备份恢复</button><input ref={fileInput} hidden type="file" accept=".json" onChange={(e) => importData(e.target.files?.[0])} /></div></section><section className="settings-section"><div><h2>回收站</h2><p>仅永久清理删除已满 30 天的内容，近期误删仍可恢复。</p></div><button className="button danger" onClick={purge}><Trash2 size={16} />清理到期内容</button></section></div>
}

function TaxonomySelect({ label, value, options, addLabel, disabled, onChange, onAdd }: { label: string; value: string; options: string[]; addLabel: string; disabled?: boolean; onChange: (value: string) => void; onAdd: (value: string) => string | undefined }) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const submit = () => {
    const next = draft.trim()
    const message = onAdd(next)
    if (message) { setError(message); return }
    setDraft(''); setError(''); setAdding(false)
  }
  return <div className="field taxonomy-field"><span>{label}</span><div className="taxonomy-select-row"><select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">{disabled ? `请先选择上一级` : '请选择'}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select><button type="button" className="mini-add" disabled={disabled} aria-label={addLabel} title={addLabel} onClick={() => { setAdding((value) => !value); setError('') }}><Plus size={16} /></button></div>{adding && <div className="inline-add"><input autoFocus value={draft} onChange={(event) => { setDraft(event.target.value); setError('') }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submit() } if (event.key === 'Escape') setAdding(false) }} placeholder={addLabel.replace('新增', '输入')} /><button type="button" className="button primary" disabled={!draft.trim()} onClick={submit}>添加</button></div>}{error && <small className="field-error">{error}</small>}</div>
}

function CatalogManager() {
  const taxonomy = useNotebook((state) => state.taxonomy)
  const actions = useNotebook()
  const [exam, setExam] = useState('')
  const [subject, setSubject] = useState('')
  const [notice, setNotice] = useState('')
  const run = (operation: () => string | undefined, success = '') => { const error = operation(); setNotice(error ?? success); return error }
  return <div className="catalog-manager"><div className="catalog-tree"><div className="catalog-tree-heading"><div><strong>目录结构</strong><span>按层级展开，当前只显示正在整理的分支</span></div><span>{taxonomy.exams.length} 个考试</span></div><div className="catalog-tree-body">{taxonomy.exams.map((examEntry) => { const examOpen = exam === examEntry.name; return <div className={`tree-exam ${examOpen ? 'open' : ''}`} key={examEntry.name}><div className="tree-row exam-row"><button type="button" className="tree-toggle" aria-expanded={examOpen} onClick={() => { setExam(examOpen ? '' : examEntry.name); setSubject(''); setNotice('') }}>{examOpen ? <ChevronDown size={17} /> : <ChevronRight size={17} />}<strong>{examEntry.name}</strong><span>{examEntry.subjects.length} 个科目</span></button><TreeActions name={examEntry.name} label="考试" onRename={() => { const next = window.prompt('修改考试名称', examEntry.name); if (!next || next === examEntry.name) return; const error = run(() => actions.renameExam(examEntry.name, next), '考试名称已更新'); if (!error) setExam(next.trim()) }} onDelete={() => run(() => actions.deleteExam(examEntry.name))} /></div>{examOpen && <div className="tree-children subjects-branch">{examEntry.subjects.map((subjectEntry) => { const subjectOpen = subject === subjectEntry.name; return <div className={`tree-subject ${subjectOpen ? 'open' : ''}`} key={subjectEntry.name}><div className="tree-row subject-row"><button type="button" className="tree-toggle" aria-expanded={subjectOpen} onClick={() => { setSubject(subjectOpen ? '' : subjectEntry.name); setNotice('') }}>{subjectOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<strong>{subjectEntry.name}</strong><span>{subjectEntry.chapters.length} 个章节</span></button><TreeActions name={subjectEntry.name} label="科目" onRename={() => { const next = window.prompt('修改科目名称', subjectEntry.name); if (!next || next === subjectEntry.name) return; const error = run(() => actions.renameSubject(examEntry.name, subjectEntry.name, next), '科目名称已更新'); if (!error) setSubject(next.trim()) }} onDelete={() => run(() => actions.deleteSubject(examEntry.name, subjectEntry.name))} /></div>{subjectOpen && <div className="tree-children chapters-branch"><div className="chapter-list">{subjectEntry.chapters.map((chapter) => <div className="tree-row chapter-row" key={chapter}><span className="chapter-name">{chapter}</span><TreeActions name={chapter} label="章节" onRename={() => { const next = window.prompt('修改章节名称', chapter); if (next && next !== chapter) run(() => actions.renameChapter(examEntry.name, subjectEntry.name, chapter, next), '章节名称已更新') }} onDelete={() => run(() => actions.deleteChapter(examEntry.name, subjectEntry.name, chapter))} /></div>)}{!subjectEntry.chapters.length && <p className="tree-empty">还没有章节</p>}</div><CatalogAdd label="章节" onAdd={(value) => run(() => actions.addChapter(examEntry.name, subjectEntry.name, value), `已添加章节“${value}”`)} /></div>}</div>})}<CatalogAdd label="科目" onAdd={(value) => { const error = run(() => actions.addSubject(examEntry.name, value), `已添加科目“${value}”`); if (!error) setSubject(value); return error }} /></div>}</div>})}{!taxonomy.exams.length && <p className="tree-empty root-empty">还没有考试，请从下方创建第一个考试。</p>}</div><div className="catalog-root-add"><CatalogAdd label="考试" onAdd={(value) => { const error = run(() => actions.addExam(value), `已添加考试“${value}”`); if (!error) { setExam(value); setSubject('') }; return error }} /></div></div>{notice && <p className="catalog-notice" role="status">{notice}</p>}</div>
}

function CatalogAdd({ label, onAdd }: { label: string; onAdd: (value: string) => string | undefined }) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const cancel = () => { setAdding(false); setDraft(''); setError('') }
  const submit = () => { const message = onAdd(draft); if (message) { setError(message); return }; cancel() }
  if (!adding) return <div className="catalog-add-wrap"><button type="button" className="catalog-add-trigger" onClick={() => setAdding(true)}><Plus size={15} />新增{label}</button></div>
  return <div className="catalog-add-wrap open"><div className="catalog-add"><input autoFocus value={draft} aria-label={`新增${label}`} onChange={(event) => { setDraft(event.target.value); setError('') }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submit() } if (event.key === 'Escape') cancel() }} placeholder={`输入${label}名称`} /><button type="button" className="confirm-add" disabled={!draft.trim()} aria-label={`添加${label}`} onClick={submit}><Plus size={16} /></button><button type="button" className="cancel-add" aria-label={`取消新增${label}`} onClick={cancel}><X size={16} /></button></div>{error && <small className="field-error">{error}</small>}</div>
}

function TreeActions({ name, label, onRename, onDelete }: { name: string; label: string; onRename: () => void; onDelete: () => void }) {
  return <div className="tree-actions"><button type="button" aria-label={`重命名${label}${name}`} title="重命名" onClick={onRename}><PencilLine size={14} /></button><button type="button" className="danger-icon" aria-label={`删除${label}${name}`} title="删除" onClick={onDelete}><Trash2 size={14} /></button></div>
}

function ImageStrip({ images, masked = false, onEdit, onReorder, onDelete, onReplace }: { images: ImageAsset[]; masked?: boolean; onEdit?: (image: ImageAsset) => void; onReorder?: (images: ImageAsset[]) => void; onDelete?: (index: number) => void; onReplace?: (index: number, file?: File) => void }) {
  if (!images.length) return null
  return <div className="image-strip">{images.map((image, index) => <figure key={image.id}><img src={image.dataUrl} alt={`题目截图 ${index + 1}`} style={{ transform: `rotate(${image.rotation}deg)` }} />{masked && image.annotations.filter((entry) => entry.tool === 'mask').map((entry) => <span key={entry.id} className="answer-mask" />)}{(onEdit || onDelete || onReplace) && <div className="image-actions">{onEdit && <button className="button ghost" type="button" onClick={() => onEdit(image)}><PencilLine size={15} />标注</button>}{onReplace && <label className="button ghost"><Upload size={15} />替换<input hidden type="file" accept="image/*" onChange={(event) => { void onReplace(index, event.target.files?.[0]); event.target.value = '' }} /></label>}{onDelete && <button className="button danger icon-only" type="button" aria-label={`删除第 ${index + 1} 张图片`} onClick={() => onDelete(index)}><Trash2 size={15} /></button>}</div>}{onReorder && index > 0 && <button className="image-order" type="button" aria-label="向前移动" onClick={() => { const next = [...images]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onReorder(next) }}>←</button>}</figure>)}</div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label> }
function Empty({ title, description, icon: Icon, compact = false }: { title: string; description: string; icon: typeof Inbox; compact?: boolean }) { return <div className={`empty ${compact ? 'compact' : ''}`}><span><Icon size={24} /></span><h2>{title}</h2><p>{description}</p></div> }

async function fileToAsset(file: File): Promise<ImageAsset> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file)
  })
  return { id: crypto.randomUUID(), name: file.name || `截图-${Date.now()}.png`, dataUrl, rotation: 0, annotations: [] }
}
