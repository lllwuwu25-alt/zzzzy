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

  const applyType = () => {
    if (!pendingType) return
    onPatch({ questionType: pendingType, ...defaultTypeContent(pendingType), recognition: { status: 'idle', reviewed: true } })
    setPendingType(undefined)
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
        <div><strong>题型与答案</strong><span>识别结果会按题型填入，所有内容都可以修改。</span></div>
        <label><span>题型</span><select value={item.questionType} onChange={(event) => setPendingType(event.target.value as QuestionType)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>

      {pendingType && pendingType !== item.questionType && <div className="type-change-confirm" role="alert"><span>切换为{labels[pendingType]}会清理当前题型的结构化字段，但保留题干、公共答案、图片和笔记。</span><div className="button-row"><button type="button" className="button ghost compact" onClick={() => setPendingType(undefined)}>取消</button><button type="button" className="button primary compact" onClick={applyType}>确认切换</button></div></div>}

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
  return <div className="choice-editor"><div className="choice-mode"><span>正确答案形式</span><div role="radiogroup" aria-label="选择题答案形式"><button type="button" role="radio" aria-checked={value.mode === 'single'} className={value.mode === 'single' ? 'active' : ''} onClick={() => setMode('single')}>单选</button><button type="button" role="radio" aria-checked={value.mode === 'multiple'} className={value.mode === 'multiple' ? 'active' : ''} onClick={() => setMode('multiple')}>多选</button></div></div><div className="choice-option-list">{value.options.map((option, index) => <div className="choice-option-row" key={option.id}><button type="button" className={`answer-toggle ${value.correctOptionIds.includes(option.id) ? 'selected' : ''}`} aria-pressed={value.correctOptionIds.includes(option.id)} onClick={() => toggleAnswer(option.id)} title="设为正确答案">{option.label}</button><input aria-label={`选项 ${option.label}`} value={option.text} onChange={(event) => onChange({ ...value, options: value.options.map((entry) => entry.id === option.id ? { ...entry, text: event.target.value } : entry) })} placeholder={`输入选项 ${option.label}`} /><button type="button" className="icon-button" aria-label={`删除选项 ${option.label}`} onClick={() => onChange({ ...value, options: value.options.filter((entry) => entry.id !== option.id), correctOptionIds: value.correctOptionIds.filter((id) => id !== option.id) })}><Trash2 size={15} /></button><span className="option-order">{index + 1}</span></div>)}</div><button type="button" className="button ghost compact add-typed-row" onClick={() => { const label = nextOptionLabel(value.options.length); onChange({ ...value, options: [...value.options, { id: label, label, text: '' }] }) }}><Plus size={15} />添加选项</button>{!value.correctOptionIds.length && <p className="typed-help">图片中没有识别到答案，请手动选择正确选项。</p>}</div>
}

function FillBlankFields({ value, onChange }: { value: FillBlankContent; onChange: (value: FillBlankContent) => void }) {
  return <div className="blank-editor"><div className="blank-list">{value.blanks.map((blank, index) => <label key={blank.id}><span>第 {index + 1} 空</span><input value={blank.answer} onChange={(event) => onChange({ blanks: value.blanks.map((entry) => entry.id === blank.id ? { ...entry, answer: event.target.value } : entry) })} placeholder="图片没有答案时可以留空" /><button type="button" className="icon-button" aria-label={`删除第 ${index + 1} 个空位`} onClick={() => onChange({ blanks: value.blanks.filter((entry) => entry.id !== blank.id) })}><Trash2 size={15} /></button></label>)}</div><button type="button" className="button ghost compact add-typed-row" onClick={() => onChange({ blanks: [...value.blanks, { id: crypto.randomUUID(), answer: '' }] })}><Plus size={15} />添加空位</button></div>
}

function ShortAnswerFields({ item, onPatch }: { item: Mistake; onPatch: (patch: Partial<Mistake>) => void }) {
  const keyPoints = item.shortAnswer?.keyPoints ?? []
  return <div className="short-answer-editor"><label className="field"><span>参考答案 / 解题思路</span><textarea value={item.answer} onChange={(event) => onPatch({ answer: event.target.value })} placeholder="图片中没有答案时可以留空，稍后再补充" /></label><div className="key-point-list"><span>答题要点</span>{keyPoints.map((point, index) => <label key={`${index}-${point}`}><span>{index + 1}</span><input value={point} onChange={(event) => onPatch({ shortAnswer: { keyPoints: keyPoints.map((entry, position) => position === index ? event.target.value : entry) } })} placeholder="输入一个要点" /><button type="button" className="icon-button" aria-label={`删除第 ${index + 1} 个要点`} onClick={() => onPatch({ shortAnswer: { keyPoints: keyPoints.filter((_, position) => position !== index) } })}><Trash2 size={15} /></button></label>)}</div><button type="button" className="button ghost compact add-typed-row" onClick={() => onPatch({ shortAnswer: { keyPoints: [...keyPoints, ''] } })}><Plus size={15} />添加要点</button></div>
}
