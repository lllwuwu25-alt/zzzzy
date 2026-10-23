import {memo, useState} from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import './math-text.css'

const formulaPattern = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$([^$\n]+?)(?<!\\)\$/g
export function hasMath(text:string) { return /\$[^$]+\$|\\[([]|\\(?:frac|sqrt|sum|int)\b/.test(text) }
export const MathText = memo(function MathText({text}:{text:string}) {
  const parts:React.ReactNode[]=[];let cursor=0
  const normalized=text.replace(/\u000crac/g,'\\frac')
  const matches=[...normalized.matchAll(formulaPattern)]
  if(!matches.length && /^\\(?:frac|sqrt|sum|int|pi)\b/.test(normalized.trim())) return <Formula value={normalized} display={false}/>
  for(const match of matches){const at=match.index!;parts.push(normalized.slice(cursor,at));parts.push(<Formula key={at} value={match[1]??match[2]??match[3]??match[4]} display={!!(match[1]||match[2])}/>);cursor=at+match[0].length}
  parts.push(normalized.slice(cursor));return <span className="math-text">{parts}</span>
})
function Formula({value,display}:{value:string;display:boolean}) {
  if(value.length>10000)return <span className="formula-invalid">{value}</span>
  try { const html=katex.renderToString(value,{displayMode:display,throwOnError:true,trust:false,strict:'ignore',maxSize:8,maxExpand:500,output:'htmlAndMathml'});return <span className={display?'math-display':'math-inline'} dangerouslySetInnerHTML={{__html:html}}/> }
  catch {return <span className="formula-invalid" title="公式格式不完整，请检查原图后编辑">{value}</span>}
}
export function MathInput({value,onChange,label,placeholder}:{value:string;onChange:(value:string)=>void;label:string;placeholder?:string}) {
  const [editing,setEditing]=useState(false)
  return <div className="math-edit-field">{hasMath(value)&&!editing?<button type="button" className="math-edit-display" aria-label={`编辑${label}`} onClick={()=>setEditing(true)}><MathText text={value}/><span className="math-edit-hint">点击编辑</span></button>:<input autoFocus={editing||undefined} aria-label={label} value={value} placeholder={placeholder} onChange={(e)=>onChange(e.target.value)} onBlur={()=>setEditing(false)} onKeyDown={(e)=>{if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();setEditing(false)}}}/ >}{editing&&hasMath(value)&&<div className="math-edit-preview" aria-label={`${label}排版预览`}><MathText text={value}/></div>}</div>
}
