import { MathInput, MathText, hasMath } from './MathText'
import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { answerTextFor, defaultTypeContent } from '../lib/question-types'
import type { ChoiceContent, FillBlankContent, Mistake, QuestionType } from '../types'

const labels: Record<QuestionType, string> = {
  'fill-blank': '填空题',
  choice: '选择题',
  'short-answer': '简答题',
}

const nextOptionLabel = (length: number) => String.fromCharCode(65 + Math.min(length, 25))

export function QuestionTypeFields({ item, onPatch }: { item: Mistake; onPatch: (patch: Partial<Mistake>) => void }) {
  const [pendingType, setPendingType] = useState<QuestionType>()
  const markReviewed = (patch: Partial<Mistake>) => onPatch({
    ...patch,
    recognition: item.recognition ? { ...item.recognition, reviewed: true } : { status: 'idle', reviewed: true },
  })

  const applyType = (type = pendingType) => {
    if (!type) return
    onPatch({ questionType: type, ...defaultTypeContent(type), recognition: { status: 'idle', reviewed: true } })
    setPendingType(undefined)
  }

  const requestType = (type: QuestionType) => {
    if (type === item.questionType) return
    const hasTypedContent = item.questionType === 'choice'
      ? Boolean(item.choice?.options.length || item.choice?.correctOptionIds.length)
      : item.questionType === 'fill-blank'
        ? Boolean(item.fillBlank?.blanks.length)
        : Boolean(item.answer.trim() || item.shortAnswer?.keyPoints.length)
    if (hasTypedContent) setPendingType(type)
    else applyType(type)
  }

  const patchChoice = (choice: ChoiceContent) => {
    const next = { ...item, choice }
    markReviewed({ choice, answer: answerTextFor(next) })
  }

  const patchBlanks = (fillBlank: FillBlankContent) => {
    const next = { ...item, fillBlank }
    markReviewed({ fillBlank, answer: answerTextFor(next) })
  }

  return (
    <section className="typed-fields">
      <div className="typed-fields-heading">
        <strong>答案</strong>
        <div className="question-type-switch" role="radiogroup" aria-label="题型">
          {Object.entries(labels).map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={item.questionType === value} className={item.questionType === value ? 'active' : ''} onClick={() => requestType(value as QuestionType)}>{label}</button>)}
        </div>
      </div>

      {pendingType && pendingType !== item.questionType && <div className="type-change-confirm" role="alert"><span>切换为{labels[pendingType]}后，当前答案结构会被清空。</span><div className="button-row"><button type="button" className="button ghost compact" onClick={() => setPendingType(undefined)}>取消</button><button type="button" className="button primary compact" onClick={() => applyType()}>继续切换</button></div></div>}

      {item.questionType === 'choice' && <ChoiceFields value={item.choice ?? { mode: 'single', options: [], correctOptionIds: [] }} onChange={patchChoice} />}
      {item.questionType === 'fill-blank' && <FillBlankFields value={item.fillBlank ?? { blanks: [] }} onChange={patchBlanks} />}
      {item.questionType === 'short-answer' && <ShortAnswerFields item={item} onPatch={markReviewed} />}
    </section>
  )
}

function ChoiceFields({ value, onChange }: { value: ChoiceContent; onChange: (value: ChoiceContent) => void }) {
  const toggleAnswer = (id: string) => {
    const selected = value.correctOptionIds.includes(id)
    const correctOptionIds = value.mode === 'single' ? (selected ? [] : [id]) : selected ? value.correctOptionIds.filter((entry) => entry !== id) : [...value.correctOptionIds, id]
    onChange({ ...value, correctOptionIds })
  }
  const setMode = (mode: ChoiceContent['mode']) => onChange({ ...value, mode, correctOptionIds: mode === 'single' ? value.correctOptionIds.slice(0, 1) : value.correctOptionIds })
  return <div className="choice-editor"><div className="choice-mode"><span>点击字母标记正确答案</span><div role="radiogroup" aria-label="选择题答案形式"><button type="button" role="radio" aria-checked={value.mode === 'single'} className={value.mode === 'single' ? 'active' : ''} onClick={() => setMode('single')}>单选</button><button type="button" role="radio" aria-checked={value.mode === 'multiple'} className={value.mode === 'multiple' ? 'active' : ''} onClick={() => setMode('multiple')}>多选</button></div></div><div className="choice-option-list">{value.options.map((option, index) => <div className="choice-option-row" key={option.id}><button type="button" className={`answer-toggle ${value.correctOptionIds.includes(option.id) ? 'selected' : ''}`} aria-pressed={value.correctOptionIds.includes(option.id)} onClick={() => toggleAnswer(option.id)} title="设为正确答案">{option.label}</button><MathInput label={`选项 ${option.label}`} value={option.text} onChange={(text) => onChange({ ...value, options: value.options.map((entry) => entry.id === option.id ? { ...entry, text } : entry) })} placeholder={`选项 ${option.label}`} /><button type="button" className="icon-button option-delete" aria-label={`删除选项 ${option.label}`} onClick={() => onChange({ ...value, options: value.options.filter((entry) => entry.id !== option.id), correctOptionIds: value.correctOptionIds.filter((id) => id !== option.id) })}><Trash2 size={15} /></button><span className="option-order">{index + 1}</span></div>)}</div><button type="button" className="button ghost compact add-typed-row" onClick={() => { const label = nextOptionLabel(value.options.length); onChange({ ...value, options: [...value.options, { id: label, label, text: '' }] }) }}><Plus size={15} />添加选项</button>{Boolean(value.options.length) && !value.correctOptionIds.length && <p className="typed-help">尚未标记正确答案，可以稍后补充。</p>}</div>
}

function FillBlankFields({ value, onChange }: { value: FillBlankContent; onChange: (value: FillBlankContent) => void }) {
  return <div className="blank-editor"><div className="blank-list">{value.blanks.map((blank, index) => <label key={blank.id}><span>第 {index + 1} 空</span><input value={blank.answer} onChange={(event) => onChange({ blanks: value.blanks.map((entry) => entry.id === blank.id ? { ...entry, answer: event.target.value } : entry) })} placeholder="图片没有答案时可以留空" /><button type="button" className="icon-button" aria-label={`删除第 ${index + 1} 个空位`} onClick={() => onChange({ blanks: value.blanks.filter((entry) => entry.id !== blank.id) })}><Trash2 size={15} /></button></label>)}</div><button type="button" className="button ghost compact add-typed-row" onClick={() => onChange({ blanks: [...value.blanks, { id: crypto.randomUUID(), answer: '' }] })}><Plus size={15} />添加空位</button></div>
}

function ShortAnswerFields({ item, onPatch }: { item: Mistake; onPatch: (patch: Partial<Mistake>) => void }) {
  const keyPoints = item.shortAnswer?.keyPoints ?? []
  return <div className="short-answer-editor"><label className="field"><span>参考答案 / 解题思路 <small>可稍后填写</small></span><textarea value={item.answer} onChange={(event) => onPatch({ answer: event.target.value })} placeholder="输入参考答案或解题思路" />{hasMath(item.answer)&&<div className="math-field-preview"><small>排版预览</small><MathText text={item.answer}/></div>}</label><details className="answer-details" open={keyPoints.length > 0 || undefined}><summary>答题要点{keyPoints.length ? ` · ${keyPoints.length} 条` : '（可选）'}</summary><div className="key-point-list">{keyPoints.map((point, index) => <label key={`${index}-${point}`}><span>{index + 1}</span><input value={point} onChange={(event) => onPatch({ shortAnswer: { keyPoints: keyPoints.map((entry, position) => position === index ? event.target.value : entry) } })} placeholder="输入一个要点" /><button type="button" className="icon-button" aria-label={`删除第 ${index + 1} 个要点`} onClick={() => onPatch({ shortAnswer: { keyPoints: keyPoints.filter((_, position) => position !== index) } })}><Trash2 size={15} /></button></label>)}</div><button type="button" className="button ghost compact add-typed-row" onClick={() => onPatch({ shortAnswer: { keyPoints: [...keyPoints, ''] } })}><Plus size={15} />添加要点</button></details></div>
}
