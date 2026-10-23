import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { ArrowUpRight, Check, KeyRound, ShieldCheck } from 'lucide-react'
import { ActionButton } from '../ActionButton'
import { deleteAiKey, getAiSettings, saveAiSettings, testAiConnection } from '../../lib/ai/client'

export function AiSettings() {
  const [model, setModel] = useState('deepseek-flash'), [key, setKey] = useState(''), [enabled, setEnabled] = useState(false)
  const [hasKey, setHasKey] = useState(false), [busy, setBusy] = useState(''), [notice, setNotice] = useState(''), [failed, setFailed] = useState(false)
  useEffect(() => { void getAiSettings().then((s) => { setModel(s.model); setHasKey(s.hasKey); setEnabled(s.enabled) }).catch(() => { setNotice('无法读取 DeepSeek 配置，请重新尝试。'); setFailed(true) }) }, [])
  const run = async (kind: 'save' | 'test' | 'delete') => {
    setBusy(kind); setNotice(''); setFailed(false)
    try {
      if (kind === 'delete') { await deleteAiKey(); setHasKey(false); setEnabled(false); setKey(''); setNotice('密钥已清除，联网识别已关闭。') }
      else {
        const settings = await saveAiSettings({ enabled, model, apiKey: key || undefined })
        setHasKey(settings.hasKey); setKey('')
        if (kind === 'test') { await testAiConnection(crypto.randomUUID()); setNotice('连接与图片读取测试通过，可以开始辅助识别。') }
        else setNotice('设置已保存。仅在你确认发送后联网识别。')
      }
    } catch (error) { setFailed(true); setNotice(typeof error === 'string' ? error : error instanceof Error ? error.message : '操作失败，请重试。') }
    finally { setBusy('') }
  }
  return <div className="ai-settings">
    <div className="ai-provider"><span className="ai-provider-mark"><KeyRound size={20} /></span><div><strong>DeepSeek</strong><span>图片辅助识别 · 按你的 API 用量计费</span></div><span className="status-chip">{hasKey ? enabled ? '已启用' : '已配置 · 未启用' : '未配置'}</span></div>
    <label className="toggle-row"><span><strong>启用联网辅助识别</strong><small>导入仍默认本地 OCR，AI 每次发送前需确认</small></span><input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setNotice('') }} disabled={!!busy} /></label>
    <label className="field"><span>API Key {hasKey && <small>（已保存，输入新密钥可替换）</small>}</span><input type="password" autoComplete="off" spellCheck={false} value={key} disabled={!!busy} onChange={(e) => { setKey(e.target.value); setNotice('') }} placeholder={hasKey ? '已保存 · 不显示密钥' : '输入你的 DeepSeek API Key'} /></label>
    <div className="ai-key-note"><ShieldCheck size={14} /><span>{isTauri() ? '密钥存入系统凭据库，不进入错题备份。' : '网页预览仅在当前会话内保存密钥，刷新后清除；浏览器跨域限制可能影响连接。'}</span></div>
    <details className="ai-advanced"><summary>高级设置</summary><label className="field"><span>视觉模型</span><input value={model} disabled={!!busy} onChange={(e) => { setModel(e.target.value); setNotice('') }} /></label><p>官方接口：api.deepseek.com · 默认 deepseek-flash</p></details>
    <div className="button-row"><ActionButton className="primary" busy={busy === 'save'} disabled={!!busy || (!key && !hasKey && enabled)} onClick={() => void run('save')}>保存配置</ActionButton><ActionButton busy={busy === 'test'} busyLabel="正在测试" disabled={!!busy || !enabled || (!key && !hasKey)} onClick={() => void run('test')}>测试连接</ActionButton>{hasKey && <button className="button quiet-danger" disabled={!!busy} onClick={() => void run('delete')}>清除密钥</button>}</div>
    <p className="ai-disclosure">测试连接会发送一张合成测试图并可能计费，不使用你的题目。</p>
    <a className="text-link" href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">前往 DeepSeek 获取 API Key <ArrowUpRight size={14} /></a>
    {notice && <p className={`inline-notice ${failed ? 'error' : 'success'}`} role={failed ? 'alert' : 'status'}>{!failed && <Check size={15} />}{notice}</p>}
  </div>
}
