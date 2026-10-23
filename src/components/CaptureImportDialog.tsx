import { useEffect, useMemo, useRef, useState } from 'react'
import { AlignLeft, Check, FormInput, ListChecks, X } from 'lucide-react'
import { ActionButton } from './ActionButton'
import { assignGroupType, groupsFor, importReady, type ImportGroup, type ImportMode } from '../lib/import-flow'
import type { ImageAsset, QuestionType } from '../types'

const typeOptions: Array<{ id: QuestionType; label: string; description: string; icon: typeof FormInput }> = [
  { id: 'fill-blank', label: '填空题', description: '按空位逐项整理答案', icon: FormInput },
  { id: 'choice', label: '选择题', description: '自动拆分题干与选项', icon: ListChecks },
  { id: 'short-answer', label: '简答题', description: '整理参考答案与答题要点', icon: AlignLeft },
]

export type TypedImportGroup = ImportGroup & { questionType: QuestionType }

export function CaptureImportDialog({
  images,
  skipped,
  onCancel,
  onComplete,
}: {
  images: ImageAsset[]
  skipped: number
  onCancel: () => void
  onComplete: (groups: TypedImportGroup[]) => Promise<void>
}) {
  const [stage, setStage] = useState<'grouping' | 'typing'>(() => images.length > 1 ? 'grouping' : 'typing')
  const [groups, setGroups] = useState<ImportGroup[]>(() => images.length === 1 ? groupsFor(images, 'merge') : [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const firstButton = useRef<HTMLButtonElement>(null)
  const firstRadio = useRef<HTMLInputElement>(null)
  const title = stage === 'grouping' ? '这些图片应当怎样组成题目？' : groups.length > 1 ? '分别选择每道题的题型' : '选择这道题的题型'
  const description = stage === 'grouping'
    ? '先确认图片归属，再为每道题选择合适的整理方式。'
    : '系统会按题型识别并自动填入对应字段，之后仍可修改。'
  const ready = useMemo(() => importReady(groups), [groups])

  useEffect(() => { (stage === 'grouping' ? firstButton.current : firstRadio.current)?.focus() }, [stage])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel, saving])

  const chooseGrouping = (mode: ImportMode) => {
    setGroups(groupsFor(images, mode))
    setStage('typing')
    setError('')
  }

  const confirm = async () => {
    if (!ready || saving) return
    setSaving(true)
    setError('')
    try {
      await onComplete(groups as TypedImportGroup[])
    } catch {
      setError('图片已经读取，但写入本地存储失败。请检查磁盘空间或工作区权限后重试。')
      setSaving(false)
    }
  }

  return (
    <div className="capture-dialog-backdrop">
      <section className="capture-dialog" role="dialog" aria-modal="true" aria-labelledby="capture-dialog-title" aria-describedby="capture-dialog-description">
        <header>
          <div><h2 id="capture-dialog-title">{title}</h2><p id="capture-dialog-description">{description}</p></div>
          <button className="icon-button" type="button" aria-label="取消导入" onClick={onCancel} disabled={saving}><X size={18} /></button>
        </header>

        {stage === 'grouping' ? (
          <div className="capture-dialog-body">
            <div className="import-preview-grid" aria-label={`共 ${images.length} 张图片`}>
              {images.map((image, index) => <figure key={image.id}><img src={image.dataUrl} alt={`第 ${index + 1} 张待导入图片`} /><figcaption>{index + 1}</figcaption></figure>)}
            </div>
            <div className="grouping-actions">
              <button ref={firstButton} type="button" onClick={() => chooseGrouping('merge')}>
                <span><strong>合为一题</strong><small>多张图是同一道题的题干、答案或续页</small></span><Check size={18} />
              </button>
              <button type="button" onClick={() => chooseGrouping('split')}>
                <span><strong>拆成 {images.length} 题</strong><small>每张图分别创建一道错题</small></span><Check size={18} />
              </button>
            </div>
          </div>
        ) : (
          <div className="capture-dialog-body type-stage">
            {groups.map((group, groupIndex) => (
              <fieldset className="import-type-group" key={group.id}>
                <legend>{groups.length > 1 ? `第 ${groupIndex + 1} 题` : '题型'}</legend>
                {groups.length > 1 && <img src={group.images[0].dataUrl} alt={`第 ${groupIndex + 1} 题缩略图`} />}
                <div className="question-type-options">
                  {typeOptions.map(({ id, label, description: optionDescription, icon: Icon }, optionIndex) => (
                    <label key={id} className={group.questionType === id ? 'selected' : ''}>
                      <input
                        ref={groupIndex === 0 && optionIndex === 0 ? firstRadio : undefined}
                        type="radio"
                        name={`question-type-${group.id}`}
                        value={id}
                        checked={group.questionType === id}
                        onChange={() => setGroups((current) => assignGroupType(current, group.id, id))}
                      />
                      <Icon size={18} /><span><strong>{label}</strong><small>{optionDescription}</small></span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        )}

        <footer>
          <div className="import-dialog-note">
            <span>导入在本机完成，联网 AI 另行确认</span>
            {skipped > 0 && <span className="warning">已跳过 {skipped} 个不支持的文件</span>}
          </div>
          <div className="button-row">
            {stage === 'typing' && images.length > 1 && <button className="button ghost" type="button" onClick={() => setStage('grouping')} disabled={saving}>上一步</button>}
            <button className="button ghost" type="button" onClick={onCancel} disabled={saving}>取消</button>
            {stage === 'typing' && <ActionButton className="primary" type="button" onClick={() => void confirm()} disabled={!ready} busy={saving} busyLabel="正在保存">创建 {groups.length} 道错题</ActionButton>}
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
        </footer>
      </section>
    </div>
  )
}
