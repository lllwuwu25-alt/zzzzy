import type { Mistake } from '../types'
import { serializeResponse } from '../lib/question-types'

export function QuestionAnswerInput({ item, value, onChange, disabled = false }: { item: Mistake; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  if (item.questionType === 'choice') {
    const selected = value.split('、').filter(Boolean)
    const choose = (id: string) => {
      const has = selected.includes(id)
      const selectedOptionIds = item.choice?.mode === 'multiple'
        ? has ? selected.filter((entry) => entry !== id) : [...selected, id]
        : has ? [] : [id]
      onChange(serializeResponse(item, { selectedOptionIds }))
    }
    return <fieldset className="review-choice-input" disabled={disabled}><legend>选择本次答案（可选）</legend>{item.choice?.options.map((option) => <label key={option.id} className={selected.includes(option.id) ? 'selected' : ''}><input type={item.choice?.mode === 'multiple' ? 'checkbox' : 'radio'} name={`review-${item.id}`} checked={selected.includes(option.id)} onChange={() => choose(option.id)} /><strong>{option.label}</strong><span>{option.text}</span></label>)}{!item.choice?.options.length && <p>这道题还没有整理选项，可以先显示答案后评分。</p>}</fieldset>
  }
  if (item.questionType === 'fill-blank') {
    const answers = value.split('\n')
    return <fieldset className="review-blank-input" disabled={disabled}><legend>填写本次答案（可选）</legend>{(item.fillBlank?.blanks.length ? item.fillBlank.blanks : [{ id: 'blank-1', answer: '' }]).map((blank, index) => <label key={blank.id}><span>第 {index + 1} 空</span><input value={answers[index] ?? ''} onChange={(event) => { const next = [...answers]; next[index] = event.target.value; onChange(serializeResponse(item, { blanks: next })) }} placeholder="输入答案" /></label>)}</fieldset>
  }
  return <label className="field answer-field"><span>输入本次答案（可选）</span><textarea disabled={disabled} value={value} onChange={(event) => onChange(serializeResponse(item, { text: event.target.value }))} placeholder="写下你的解题思路或答案，揭示后可以对照……" /></label>
}

export function QuestionAnswerReveal({ item }: { item: Mistake }) {
  if (item.questionType === 'choice' && item.choice) {
    const correct = new Set(item.choice.correctOptionIds)
    return <div className="structured-answer"><span>正确答案</span>{item.choice.options.map((option) => <div key={option.id} className={correct.has(option.id) ? 'correct' : ''}><strong>{option.label}</strong><p>{option.text}</p>{correct.has(option.id) && <small>正确选项</small>}</div>)}{!correct.size && <p className="missing-answer">这道题还没有填写正确答案，可以在全部错题中补充。</p>}</div>
  }
  if (item.questionType === 'fill-blank') {
    return <div className="structured-answer"><span>填空答案</span>{item.fillBlank?.blanks.map((blank, index) => <div key={blank.id} className={blank.answer ? 'correct' : ''}><strong>{index + 1}</strong><p>{blank.answer || '尚未填写'}</p></div>)}{!item.fillBlank?.blanks.length && <p className="missing-answer">这道题还没有整理空位与答案。</p>}</div>
  }
  return <div className="answer-block"><span>参考答案与思路</span><p>{item.answer || '这道题还没有填写正确答案。可以在全部错题中补充。'}</p>{Boolean(item.shortAnswer?.keyPoints.length) && <ul>{item.shortAnswer?.keyPoints.filter(Boolean).map((point, index) => <li key={index}>{point}</li>)}</ul>}</div>
}
