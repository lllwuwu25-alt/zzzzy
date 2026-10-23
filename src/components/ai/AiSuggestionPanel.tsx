import {QuestionContent} from '../QuestionContent'
import {hasQuestionTable} from '../../lib/question-content'
import {QuestionDiagrams} from '../QuestionDiagrams'
import type {ImageAsset,QuestionDiagram} from '../../types'
import { Check, RotateCcw, Sparkles, X } from 'lucide-react'
import type { FieldSuggestion } from '../../lib/ai/suggestions'
function display(value: unknown): string {
  if (typeof value === 'string') return value || '（图片未提供答案）'
  if (!value || typeof value !== 'object') return '（空）'
  const v = value as Record<string, unknown>
  if (Array.isArray(v.options)) return v.options.map((o: { id: string; label: string; text: string }) => {
    const mark = (v.correctOptionIds as string[]).includes(o.id) ? ' ✓' : ''
    return hasQuestionTable(o.text) ? `${o.label}.${mark}\n\n${o.text}` : `${o.label}. ${o.text}${mark}`
  }).join('\n\n')
  if (Array.isArray(v.blanks)) return v.blanks.map((b: { answer: string }, i: number) => `第 ${i + 1} 空：${b.answer || '待填写'}`).join('\n')
  if (Array.isArray(v.keyPoints)) return v.keyPoints.join('\n') || '（无要点）'
  return ''
}
export function AiSuggestionPanel({ suggestions, images, model, canUndo, onApply, onUndo, onDismiss }: { suggestions: FieldSuggestion[]; images:ImageAsset[]; model: string; canUndo: boolean; onApply: (keys: string[]) => void; onUndo: () => void; onDismiss: () => void }) {
  return <section className="ai-suggestions" aria-label="AI 识别建议">
    <div className="ai-section-heading"><Sparkles size={18} /><div><strong>识别完成，检查后采用</strong><p>DeepSeek · {model} · 待核对</p></div><button className="icon-button" aria-label="放弃剩余建议" onClick={onDismiss}><X size={17} /></button></div>
    {suggestions.length === 0 && <p className="ai-disclosure">内容已与编辑区一致。检查后即可保存。</p>}
    {suggestions.map((s) => <div className={`ai-suggestion ${s.conflict ? 'conflict' : ''}`} key={s.key}><header><strong>{s.label}</strong>{s.conflict && <span>此字段已手动修改</span>}</header>{s.conflict && <details><summary>对比当前内容</summary><div className="ai-rich-copy"><QuestionContent text={display(s.before)}/></div></details>}{s.key==='diagrams'?<QuestionDiagrams item={{images,diagrams:s.value as QuestionDiagram[]}}/>:<div className="ai-rich-copy"><QuestionContent text={display(s.value)}/></div>}<button className="button compact ghost" onClick={() => onApply([s.key])}>{s.conflict ? '确认替换此字段' : '采用此项'}<Check size={14} /></button></div>)}
    <div className="button-row"><button className="button primary" disabled={!suggestions.some((s) => !s.conflict)} onClick={() => onApply(suggestions.filter((s) => !s.conflict).map((s) => s.key))}>采用非冲突建议</button>{canUndo && <button className="button ghost" onClick={onUndo}><RotateCcw size={15} />撤销上次采用</button>}</div>
  </section>
}
