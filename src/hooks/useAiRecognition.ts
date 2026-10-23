import { useEffect, useRef, useState } from 'react'
import type { Mistake } from '../types'
import { getAiSettings, recognizeAiQuestion } from '../lib/ai/client'
import { prepareAiImages } from '../lib/ai/images'
import { attachFigures } from '../lib/ai/figures'
import { parseAiQuestion, type AiQuestionDraft } from '../lib/ai/schema'
import { createRecognitionSession, sameRecognitionSource } from '../lib/ai/session'
import { applySuggestions, buildSuggestions, undoSuggestions, type SuggestionChange } from '../lib/ai/suggestions'

export function useAiRecognition(item: Mistake, onPatch: (patch: Partial<Mistake>) => void) {
  const current = useRef(item); current.current = item
  const previousSource = useRef(item)
  const session = useRef(createRecognitionSession()), controller = useRef<AbortController | undefined>(undefined)
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'waiting' | 'checking' | 'done'>('idle')
  const [error, setError] = useState(''), [needsSettings, setNeedsSettings] = useState(false), [model, setModel] = useState('deepseek-flash')
  const [result, setResult] = useState<{ snapshot: Mistake; draft: AiQuestionDraft }>()
  const [changes, setChanges] = useState<SuggestionChange[]>([])
  const cancel = () => { session.current.cancel(); controller.current?.abort(); controller.current = undefined; setPhase('idle') }
  useEffect(() => { cancel(); setResult(undefined); setChanges([]); setError(''); setNeedsSettings(false); return () => { session.current.cancel(); controller.current?.abort() } }, [item.id])
  useEffect(() => { if (!sameRecognitionSource(previousSource.current, item)) { cancel(); setResult(undefined); setChanges([]) }; previousSource.current = item }, [item.images, item.questionType, item.id])
  const recognize = async () => {
    if (controller.current) return
    const snapshot = structuredClone(current.current), token = session.current.start(snapshot.id)
    const abort = new AbortController(); controller.current = abort
    setPhase('preparing'); setError(''); setNeedsSettings(false); setResult(undefined); setChanges([])
    try {
      if (!snapshot.images.length || snapshot.images.length > 8) throw new Error('每次可识别 1–8 张图片；请拆分题目或减少图片后重试。')
      const settings = await getAiSettings()
      if (!session.current.isCurrent(token, current.current.id) || abort.signal.aborted) return
      if (!settings.enabled || !settings.hasKey) {
        setNeedsSettings(true); setPhase('idle'); setError('先在设置中启用 DeepSeek 并填写 API Key，当前草稿会保留。'); return
      }
      setModel(settings.model)
      const selected = snapshot.images
      const images = await prepareAiImages(selected, abort.signal)
      if (!session.current.isCurrent(token, current.current.id)) return
      setPhase('waiting')
      const response = await recognizeAiQuestion({ requestId: crypto.randomUUID(), questionType: snapshot.questionType, images, ocrText: '' }, abort.signal)
      if (!session.current.isCurrent(token, current.current.id)) return
      if (snapshot.images.map((image) => image.id + image.dataUrl).join() !== current.current.images.map((image) => image.id + image.dataUrl).join()) throw new Error('识别期间图片已变更，请对当前图片重新识别。')
      setPhase('checking'); const draft = attachFigures(parseAiQuestion(response.content, snapshot.questionType), selected)
      if (current.current.questionType !== snapshot.questionType) throw new Error('题型已变更，请重新识别。')
      setModel(response.model); setResult({ snapshot, draft }); setPhase('done')
    } catch (e) {
      if (!session.current.isCurrent(token, current.current.id) || abort.signal.aborted) return
      setPhase('idle'); setError(typeof e === 'string' ? e : e instanceof Error ? e.message : '识别失败，请重试。')
    } finally {
      if (controller.current === abort) controller.current = undefined
    }
  }
  const suggestions = result ? buildSuggestions(result.snapshot, item, result.draft) : []
  const apply = (keys: string[]) => {
    if (!result || !sameRecognitionSource(result.snapshot, current.current)) { setResult(undefined); setError('题型或图片已变更，请重新识别。'); return }
    const change = applySuggestions(current.current, suggestions, keys)
    onPatch({ ...change.patch, recognition: { status: 'done', reviewed: false, provider: 'deepseek', model, recognizedAt: new Date().toISOString(), message: 'DeepSeek 辅助识别，请核对后保存' } })
    setChanges((value) => [...value, change]); setError('')
  }
  const undo = () => {
    const change = changes.at(-1); if (!change) return
    try { onPatch(undoSuggestions(current.current, change)); setChanges((value) => value.slice(0, -1)); setError('') }
    catch (e) { setError((e as Error).message) }
  }
  return { phase, error, needsSettings, model, result, suggestions, canUndo: !!changes.length, busy: ['preparing', 'waiting', 'checking'].includes(phase), recognize, cancel, apply, undo, dismiss: () => { setResult(undefined); setPhase('idle') } }
}
