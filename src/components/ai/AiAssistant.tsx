import { LoaderCircle, Sparkles } from 'lucide-react'
import { useAiRecognition } from '../../hooks/useAiRecognition'
import type { Mistake } from '../../types'
import { AiSendConfirmation } from './AiSendConfirmation'
import { AiSuggestionPanel } from './AiSuggestionPanel'

export function AiAssistant({ item, onPatch, onSettings }: { item: Mistake; onPatch: (patch: Partial<Mistake>) => void; onSettings: () => void }) {
  const ai = useAiRecognition(item, onPatch)
  return <section className="organizer-section ai-assistant">
    <div className="ai-section-heading"><span className="ai-symbol"><Sparkles size={18} /></span><div><strong>少一点录入，多一点思考</strong><p>用 DeepSeek 辅助提取题干、选项与已有答案</p></div>{!ai.busy && ai.phase !== 'confirm' && <button className="button ai-button" disabled={!item.images.length} onClick={() => void ai.prepare()}><Sparkles size={15} />{ai.result ? '重新识别' : 'AI 辅助识别'}</button>}</div>
    {ai.phase === 'confirm' && <AiSendConfirmation images={item.images} model={ai.model} busy={ai.busy} onConfirm={(ids) => void ai.confirm(ids)} onCancel={ai.cancel} />}
    {ai.busy && <div className="ai-waiting" role="status"><LoaderCircle className="button-spinner" size={18} /><div><strong>{ai.phase === 'preparing' ? '正在本机准备图片' : ai.phase === 'waiting' ? '等待 DeepSeek 识别结果' : '正在校验识别字段'}</strong><span>你的编辑仍可继续，结果会作为建议展示</span></div><button className="button ghost compact" onClick={ai.cancel}>取消识别</button></div>}
    {ai.error && <div className="inline-notice error" role="alert"><span>{ai.error}</span>{ai.needsSettings && <button className="button ghost compact" onClick={onSettings}>前往设置</button>}</div>}
    {ai.result && <AiSuggestionPanel images={item.images} suggestions={ai.suggestions} model={ai.model} canUndo={ai.canUndo} onApply={ai.apply} onUndo={ai.undo} onDismiss={ai.dismiss} />}
    {!item.images.length && <p className="ai-disclosure">添加题目图片后即可使用；也可以直接手动填写。</p>}
  </section>
}
