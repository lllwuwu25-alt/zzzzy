import {QuestionDiagrams} from './QuestionDiagrams'
import {MathText} from './MathText'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpenCheck, Check, ChevronRight, Layers3, RotateCcw, X } from 'lucide-react'
import { selectDue, useNotebook } from '../store'
import type { Mistake, Rating } from '../types'
import { ratingIntervalHint } from '../lib/fsrs'
import { completeCard, restoreCard, skipCard, type DeckState } from '../lib/review-deck'
import { QuestionAnswerInput, QuestionAnswerReveal } from './QuestionAnswerInput'
import { ImageStrip } from './shared'
import './review-deck.css'

const ratings: Array<{id:Rating; label:string}> = [{id:'again',label:'重来'},{id:'hard',label:'困难'},{id:'good',label:'良好'},{id:'easy',label:'简单'}]

export function ReviewDeck({onGoInbox}:{onGoInbox:()=>void}) {
  const store = useNotebook()
  const [deck, setDeck] = useState<DeckState | null>(null)
  const [subject, setSubject] = useState('')
  const [revealed, setRevealed] = useState(false), [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [outgoing, setOutgoing] = useState<{item:Mistake; skipped:boolean; key:number}>()
  const [lastSessionReview, setLastSessionReview] = useState<string>()
  const startedAt = useRef(Date.now()), lock = useRef(false), motionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const focus = useRef<HTMLElement>(null)
  const modal = useRef<HTMLDialogElement>(null)
  const homeTitle = useRef<HTMLHeadingElement>(null)
  const due = selectDue(store), subjects = [...new Set(due.map((i)=>i.subject).filter(Boolean))]
  const available = due.filter((i)=>!subject || i.subject===subject)
  const pending = deck?.pending.flatMap((id)=>{const item=store.items.find((i)=>i.id===id&&i.status==='ready');return item?[item]:[]}) ?? []
  const item=pending[0], completed=deck?.completed.length ?? 0, total=completed+pending.length
  const canUndo=!!lastSessionReview && store.lastReview?.id===lastSessionReview
  useEffect(()=>()=>clearTimeout(motionTimer.current),[])
  useEffect(()=>{focus.current?.focus({preventScroll:true})},[item?.id,deck===null])
  useEffect(()=>{
    if(!deck||!modal.current)return
    const previous=document.activeElement as HTMLElement, overflow=document.body.style.overflow
    modal.current.showModal();document.body.style.overflow='hidden';focus.current?.focus({preventScroll:true})
    return ()=>{document.body.style.overflow=overflow;if(previous?.isConnected&&!previous.matches(':disabled'))previous.focus({preventScroll:true});else homeTitle.current?.focus({preventScroll:true})}
  },[deck!==null])
  const close=()=>{if(lock.current)return;setDeck(null);setOutgoing(undefined);setError('')}
  const start=()=>{setDeck({pending:available.map((i)=>i.id),completed:[]});setError('');setRevealed(false);setAnswer('');setLastSessionReview(undefined);startedAt.current=Date.now()}
  const reset=()=>{setRevealed(false);setAnswer('');startedAt.current=Date.now()}
  const move=(current:Mistake,skipped=false)=>{setOutgoing({item:current,skipped,key:Date.now()});clearTimeout(motionTimer.current);motionTimer.current=setTimeout(()=>setOutgoing(undefined),760)}
  const rate=async(rating:Rating)=>{
    if(!item||lock.current)return
    lock.current=true;setBusy(true);setError('')
    try{
      await store.rate(item.id,rating,answer,Math.max(1,Math.round((Date.now()-startedAt.current)/1000)))
      setLastSessionReview(useNotebook.getState().lastReview?.id)
      move(item);setDeck((d)=>d?completeCard(d,item.id):d);reset()
    }catch{setError('评分没有保存成功，卡片仍保留在这里，请重试。')}
    finally{lock.current=false;setBusy(false)}
  }
  const undo=async()=>{
    const previous=useNotebook.getState().lastReview
    if(!previous||previous.id!==lastSessionReview||lock.current)return
    lock.current=true;setBusy(true);setError('')
    try{await store.undoRating();setDeck((d)=>d?restoreCard(d,previous.mistakeId):d);setLastSessionReview(undefined);setOutgoing(undefined);reset()}
    catch{setError('撤销没有保存成功，请重试。')}
    finally{lock.current=false;setBusy(false)}
  }

  const home = <section className="review-home" aria-labelledby="review-home-title">
    <div className="review-home-heading"><span className="review-day">{new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'})}</span><h1 ref={homeTitle} tabIndex={-1} id="review-home-title">今天，让记忆再清晰一点。</h1><p>选择一组题目，留一段专注的时间。</p></div>
    <section className="review-entry" aria-label="选择今日复习"><div className="mini-card-stack" aria-hidden="true"><i/><i/><span><BookOpenCheck size={31}/></span></div><div className="review-entry-copy"><span className="review-entry-label">今日复习</span><h2>{available.length ? `${available.length} 道题，等你温习` : '今天暂时没有到期题目'}</h2><p>{available.length?'一张一张完成，把学过的知识稳稳留下。':'可以先整理收集箱，准备下一次复习。'}</p>{subjects.length>0&&<label className="review-subject">复习范围<select aria-label="选择复习科目" value={subject} onChange={(e)=>setSubject(e.target.value)}><option value="">全部科目</option>{subjects.map((s)=><option key={s}>{s}</option>)}</select></label>}</div><button className="button primary review-start" disabled={!available.length} onClick={start}>开始复习<ArrowRight size={16}/></button></section>
    <button className="review-inbox-link" onClick={onGoInbox}>去整理收集箱<ChevronRight size={14}/></button>
  </section>

  const content = !item ? <section className="deck-finished" aria-labelledby="deck-finished-title">
    <div className="completion-emblem" aria-hidden="true"><i/><i/><span><Check size={34}/></span></div><span className="review-day">本轮已完成 {completed} 道题</span><h1 ref={focus as React.RefObject<HTMLHeadingElement>} tabIndex={-1} id="deck-finished-title">今日复习已结束</h1><p>卡片已归位，新的复习安排也已保存。<br/>休息一下，让记忆慢慢沉淀。</p>{error&&<p role="alert" className="field-error">{error}</p>}<div className="button-row"><button className="button primary" onClick={()=>setDeck(null)}>返回今日复习</button>{canUndo&&<button className="button ghost" disabled={busy} onClick={()=>void undo()}><RotateCcw size={15}/>撤销上一条评分</button>}<button className="button ghost" onClick={onGoInbox}>整理收集箱</button></div>
  </section>

  : <section className="deck-session" aria-label="专注复习卡片">
    <header className="deck-session-header"><button className="button ghost compact" disabled={busy} onClick={()=>{setDeck(null);setOutgoing(undefined)}}><ArrowLeft size={14}/>返回选择</button><div className="deck-counter"><Layers3 size={15}/><span>已完成 <strong>{completed}</strong> / {total}</span></div><button className="button ghost compact" disabled={!canUndo||busy} onClick={()=>void undo()} aria-label="撤销上一条评分"><RotateCcw size={14}/>撤销</button></header>
    <div className="deck-progress" role="progressbar" aria-label="本轮复习进度" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={total}><span style={{transform:`scaleX(${total?completed/total:0})`}}/></div>
    <div className="deck-stage"><div className="deck-back deck-back-two" aria-hidden="true"/><div className="deck-back deck-back-one" aria-hidden="true"/>
      <article className="deck-card" key={item.id} ref={focus as React.RefObject<HTMLElement>} tabIndex={-1} aria-label="当前复习题目" aria-busy={busy}>
        <div className="deck-card-meta"><span>{[item.exam,item.subject,item.chapter].filter(Boolean).join(' / ')||'未分类错题'}</span><span>{pending.length} 道待复习</span></div>
        <div className="deck-card-body">
          <div className="deck-question"><span className="deck-question-type">{item.questionType==='choice'?'选择题':item.questionType==='fill-blank'?'填空题':'简答题'}</span><h1><MathText text={item.question||'查看图片作答'}/></h1></div>
          <QuestionDiagrams item={item} masked={!revealed}/>{item.images.length>0&&<details className="deck-source" open={!item.question.trim()||undefined}><summary>查看题目原图 · {item.images.length} 张</summary><ImageStrip images={item.images} masked={!revealed}/></details>}
          {!revealed?<QuestionAnswerInput item={item} value={answer} onChange={setAnswer}/>:<div className="answer-reveal"><QuestionAnswerReveal item={item}/>{item.cause&&<div className="cause-block"><span>上次为什么错</span><p><MathText text={item.cause}/></p></div>}</div>}
        </div>
        <div className="deck-card-footer">{!revealed?<div className="review-actions"><button className="button ghost" disabled={pending.length<2||busy} onClick={()=>{move(item,true);setDeck((d)=>d?skipCard(d):d);reset()}}>暂时跳过</button><button className="button primary" onClick={()=>setRevealed(true)}>显示答案<ArrowRight size={15}/></button></div>:<div className="rating-area"><span>这次掌握得怎么样？</span><div className="rating-grid">{ratings.map(({id,label})=><button key={id} className={`rating ${id}`} disabled={busy} onClick={()=>void rate(id)}><strong>{label}</strong><span>{ratingIntervalHint(id,store.reviewSettings)}</span></button>)}</div></div>}{error&&<p className="deck-error" role="alert">{error}</p>}</div>
      </article>
      {outgoing&&<div key={outgoing.key} className="deck-outgoing" aria-hidden="true"><BookOpenCheck size={20}/><strong>{outgoing.item.question||'图片题目'}</strong><span>{outgoing.skipped?'稍后再看':'已完成 · 归入卡片后方'}</span></div>}
    </div><p className="deck-footnote">{completed ? `${completed} 张卡片已归位 · `:''}把注意力留给眼前这一题</p>
  </section>
  return <>{home}{deck&&<dialog ref={modal} className="review-modal" aria-label="专注复习" onCancel={(event)=>{event.preventDefault();close()}} onClick={(event)=>{if(event.target!==event.currentTarget)return;const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close()}}><button className="icon-button deck-modal-close" aria-label="关闭复习卡片" disabled={busy} onClick={close}><X size={20}/></button>{content}</dialog>}</>
}
