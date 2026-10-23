import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, ImagePlus, Sparkles, X } from 'lucide-react'
import type { ImageAsset } from '../../types'
import { ActionButton } from '../ActionButton'

export function AiSendConfirmation({ images, model, busy, onConfirm, onCancel }: { images: ImageAsset[]; model: string; busy: boolean; onConfirm: (ids: string[]) => void; onCancel: () => void }) {
  const [ids, setIds] = useState(images.slice(0, 8).map((i) => i.id))
  const region = useRef<HTMLElement>(null)
  useEffect(() => { const previous = document.activeElement as HTMLElement; region.current?.querySelector<HTMLButtonElement>('button')?.focus(); return () => { if (previous?.isConnected) previous.focus() } }, [])
  return <section ref={region} className="ai-send-confirmation" aria-label="确认发送至 DeepSeek" onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onCancel() }}>
    <div className="ai-section-heading"><Sparkles size={18} /><div><strong>用 DeepSeek 辅助整理这道题</strong><p>将所选图片及本题 OCR 文字发送至 api.deepseek.com</p></div><button className="icon-button" onClick={onCancel} disabled={busy} aria-label="取消发送"><X size={17} /></button></div>
    <div className="ai-image-picker">{images.map((image, index) => <label key={image.id} className={ids.includes(image.id) ? 'selected' : ''}><img src={image.dataUrl} alt={`待发送图片 ${index + 1}`} /><input type="checkbox" disabled={busy || (!ids.includes(image.id) && ids.length >= 8)} checked={ids.includes(image.id)} onChange={(e) => setIds((current) => e.target.checked ? [...current, image.id] : current.filter((id) => id !== image.id))} /><span>{index + 1}{ids.includes(image.id) && <Check size={12} />}</span></label>)}</div>
    <div className="ai-send-meta"><span><ImagePlus size={14} />{ids.length} 张图片 · {model}</span><span>使用你的 API 额度</span></div>
    <p className="ai-disclosure">可能包含题目中的个人信息，请检查后发送。未提供的答案将保持为空，识别结果需你核对。</p>
    <div className="button-row"><ActionButton className="primary" busy={busy} busyLabel="准备图片" disabled={!ids.length || busy} onClick={() => onConfirm(ids)}>发送并识别 <ArrowUpRight size={15} /></ActionButton><button className="button ghost" disabled={busy} onClick={onCancel}>继续本地整理</button></div>
  </section>
}
