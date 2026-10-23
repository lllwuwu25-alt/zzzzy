import { AiSettings } from './ai/AiSettings'
import { MotionSettings } from './MotionSettings'
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

import { CatalogManager, ReviewCycleSettings } from './shared'
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp'
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_CAPTURE_FILES = 50
const MAX_BACKUP_BYTES = 512 * 1024 * 1024
export function SettingsPage() {
  const notebook = useNotebook()
  const replace = useNotebook((state) => state.replaceNotebook)
  const purge = useNotebook((state) => state.purgeExpired)
  const setWorkspace = useNotebook((state) => state.setWorkspace)
  const fileInput = useRef<HTMLInputElement>(null)
  const [workspaceNotice, setWorkspaceNotice] = useState('')
  const [backupNotice, setBackupNotice] = useState('')
  const isDesktop = isTauri()
  const exportData = () => {
    const data: Notebook = { version: 1, items: notebook.items, reviews: notebook.reviews, taxonomy: notebook.taxonomy, reviewSettings: notebook.reviewSettings, workspaceName: notebook.workspaceName, workspaceUpdatedAt: new Date().toISOString() }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `错题本备份-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url)
  }
  const importData = async (file?: File) => {
    if (!file) return
    if (file.size > MAX_BACKUP_BYTES) { setBackupNotice('备份文件超过 512 MB，无法安全读取。请重新选择较小的备份。'); if (fileInput.current) fileInput.current.value = ''; return }
    try { const data = parseNotebookBackup(JSON.parse(await file.text())); await replace({ ...data, workspaceName: notebook.workspaceName, workspacePath: notebook.workspacePath, workspaceUpdatedAt: notebook.workspaceUpdatedAt }); setBackupNotice(`恢复完成：${data.items.length} 道错题，${data.reviews.length} 条复习记录。`) } catch { setBackupNotice('无法读取这个备份文件。文件可能损坏，或不是由错题本导出的备份。') }
    if (fileInput.current) fileInput.current.value = ''
  }
  const chooseWorkspace = async () => {
    if (!isDesktop) { setWorkspaceNotice('网页预览无法访问系统文件夹，请在桌面版中使用。'); return }
    try { const path = await invoke<string | null>('choose_workspace_folder'); if (path) { await setWorkspace(path); setWorkspaceNotice('工作区已绑定，后续修改会同步写入 notebook.json。') } } catch { setWorkspaceNotice('没有完成文件夹绑定，或该文件夹无法写入。请选择其他文件夹后重试。') }
  }
  const openWorkspace = async () => {
    if (!notebook.workspacePath) { setWorkspaceNotice('请先选择一个工作区文件夹。'); return }
    if (!isDesktop) { setWorkspaceNotice('网页预览无法打开 Finder，请在桌面版中使用。'); return }
    try { await invoke('open_workspace_folder', { path: notebook.workspacePath }) } catch { setWorkspaceNotice('无法打开该文件夹，它可能已经被移动或删除。') }
  }
  return <div className="page settings-page"><div className="page-heading"><div><h1>设置</h1><p>掌控复习节奏、工作区、备份和考试目录。</p></div></div><section id="ai-settings" className="settings-section ai-settings-section"><div><h2>AI 辅助识别</h2><p>保留本地 OCR，按需使用 DeepSeek 提取图片里的题目信息。</p></div><AiSettings /></section><section className="settings-section"><div><h2>外观与动效</h2><p>轻量反馈，让整理与复习更连贯。</p></div><MotionSettings /></section><section className="settings-section catalog-settings"><div><h2>考试目录</h2><p>自定义考试、科目和章节。改名会同步更新已有错题；仍被使用的目录不会被误删。</p></div><CatalogManager /></section><section className="settings-section"><div><h2>复习周期</h2><p>继续使用自适应安排，或自行决定四档反馈分别间隔多少天。</p></div><ReviewCycleSettings /></section><section className="settings-section"><div><h2>本地工作区</h2><p>绑定后会在所选文件夹中维护可读的 notebook.json，并保留设备内副本。</p></div><div><div className="settings-action"><FolderCog size={20} /><div><strong>{notebook.workspaceName}</strong><span title={notebook.workspacePath || undefined}>{notebook.workspacePath || `${notebook.items.length} 道错题 · ${notebook.reviews.length} 条复习记录`}</span></div><div className="workspace-buttons"><button className="button ghost" onClick={() => void openWorkspace()} disabled={!notebook.workspacePath}><FolderOpen size={16} />打开文件夹</button><button className="button ghost" onClick={() => void chooseWorkspace()}>{notebook.workspacePath ? '重新定位' : '选择文件夹'}</button></div></div>{workspaceNotice && <p className="workspace-notice" role="status">{workspaceNotice}</p>}</div></section><section className="settings-section"><div><h2>备份与恢复</h2><p>备份包含题目元数据、图片和复习记录；导入前会先校验文件结构。</p></div><div><div className="button-row"><button className="button ghost" onClick={exportData}><FileArchive size={16} />导出备份</button><button className="button ghost" onClick={() => fileInput.current?.click()}><Upload size={16} />从备份恢复</button><input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={(e) => void importData(e.target.files?.[0])} /></div>{backupNotice && <p className="workspace-notice" role="status">{backupNotice}</p>}</div></section><section className="settings-section"><div><h2>回收站</h2><p>仅永久清理删除已满 30 天的内容，近期误删仍可恢复。</p></div><button className="button danger" onClick={purge}><Trash2 size={16} />清理到期内容</button></section></div>
}
