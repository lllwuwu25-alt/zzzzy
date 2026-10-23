import { useEffect, useId, useRef, useState } from 'react'
import { hasQuestionTable, normalizeQuestionTables } from '../lib/question-content'
import { hasMath } from './MathText'
import { QuestionContent } from './QuestionContent'

export function QuestionTextField({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; hint?: string }) {
  const id = useId(), input = useRef<HTMLTextAreaElement>(null)
  const table = hasQuestionTable(value), [editing, setEditing] = useState(false)
  useEffect(() => { if (hasQuestionTable(value) && document.activeElement !== input.current) setEditing(false) }, [value])
  useEffect(() => { if (editing && table) input.current?.focus() }, [editing, table])
  return <div className="field rich-text-field">
    <div className="rich-field-heading"><label htmlFor={id}>{label} {hint && <small>{hint}</small>}</label>{table && <button className="button ghost compact" type="button" onClick={() => setEditing(!editing)}>{editing ? `查看${label}排版` : `编辑${label}文字`}</button>}</div>
    {table && !editing ? <div className="rich-field-preview" aria-label={`${label}排版预览`}><QuestionContent text={value} /></div> : <>
      <textarea id={id} ref={input} aria-label={label} value={table ? normalizeQuestionTables(value) : value} onFocus={() => setEditing(true)} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
      {(table || hasMath(value)) && <div className="math-field-preview"><small>排版预览</small><QuestionContent text={value} /></div>}
    </>}
  </div>
}
