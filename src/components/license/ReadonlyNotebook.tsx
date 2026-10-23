import { useState } from 'react'
import { ArrowLeft, Download, FileKey2, Search } from 'lucide-react'
import { saveNotebookBackup } from '../../lib/license'
import type { Notebook } from '../../types'
import { QuestionContent } from '../QuestionContent'
import { QuestionAnswerReveal } from '../QuestionAnswerInput'
import { AnnotatedImage } from '../AnnotatedImage'
import { questionSummary } from '../../lib/question-content'
import './license.css'

export function ReadonlyNotebook({ notebook, onActivate }: { notebook: Notebook; onActivate: () => void }) {
  const [query, setQuery] = useState(''), [limit, setLimit] = useState(30), [error, setError] = useState('')
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState('')
  async function exportBackup() {
    setSaving(true); setError(''); setNotice('')
    try { const path = await saveNotebookBackup(notebook); if (path) setNotice('完整备份已导出。') }
    catch (caught) { setError(typeof caught === 'string' ? caught : caught instanceof Error ? caught.message : '未能生成备份，请检查保存位置和磁盘空间后重试。') }
    finally { setSaving(false) }
  }
  const items = notebook.items.filter(item => !query.trim() || [item.question, item.answer, item.cause, item.note, ...item.tags].join('\n').toLowerCase().includes(query.trim().toLowerCase()))
  return <main className="readonly-notebook" onDragOver={event => event.preventDefault()} onDrop={event => event.preventDefault()}>
    <header className="readonly-heading"><div><span className="license-state"><FileKey2 size={14}/>只读模式</span><h1>已有资料，随时带走。</h1><p>可以查看所有错题并导出完整备份，暂不支持新增、修改或复习评分。</p></div><div className="button-row"><button className="button ghost" onClick={onActivate}><ArrowLeft size={14}/>返回激活</button><button className="button primary" disabled={saving} onClick={() => void exportBackup()}><Download size={15}/>{saving ? '正在导出' : '导出完整备份'}</button></div></header>
    <p role="status" className="license-notice">{notice}</p>
    {error && <p className="license-error" role="alert">{error}</p>}
    <label className="readonly-search"><Search size={16}/><input aria-label="搜索已有错题" value={query} onChange={event => { setQuery(event.target.value); setLimit(30) }} placeholder="搜索题干、答案、笔记或标签"/><span>{items.length} 道题</span></label>
    <div className="readonly-list">{items.slice(0, limit).map((item, index) => <details className="readonly-item" key={item.id} open={index === 0 || undefined}>
      <summary><strong>{questionSummary(item.question) || '尚未整理的图片题'}</strong><span>{[item.exam, item.subject, item.chapter].filter(Boolean).join(' / ') || '未分类'}{item.status === 'trashed' ? ' · 回收站' : item.status === 'inbox' ? ' · 收集箱' : ''}</span></summary>
      <div className="readonly-item-body"><QuestionContent text={item.question || '查看题目原图'}/>{item.images.length > 0 && <details className="readonly-originals"><summary>原图 · {item.images.length} 张</summary><div>{item.images.map(image => <AnnotatedImage key={image.id} image={image} alt={image.name} showMasks />)}</div></details>}<QuestionAnswerReveal item={item}/>{item.cause && <section><h2>错因</h2><QuestionContent text={item.cause}/></section>}{item.note && <section><h2>个人笔记</h2><QuestionContent text={item.note}/></section>}</div>
    </details>)}</div>
    {items.length > limit && <button className="button ghost" onClick={() => setLimit(value => value + 30)}>继续显示 · 还有 {items.length - limit} 道</button>}
    {!items.length && <p className="readonly-empty">{query ? '没有找到匹配的错题，请换个关键词。' : '当前设备还没有保存错题。导入授权后即可开始收录。'}</p>}
    <p className="readonly-footnote">备份包含原图、题目、分类和复习记录，不包含设备授权。资料未被删除或加密扣留。</p>
  </main>
}
