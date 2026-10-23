import { useId, useState, type CSSProperties } from 'react'
import { Check } from 'lucide-react'
import { getThemePreference, setThemePreference, themes } from '../lib/themes'
import './theme-settings.css'

export function ThemeSettings() {
  const group = useId()
  const [selected, setSelected] = useState(() => themes.find(theme => typeof document !== 'undefined' && theme.id === document.documentElement.dataset.theme)?.id ?? getThemePreference())
  const [notice, setNotice] = useState('')
  return <fieldset className="theme-settings">
    <legend>工作台皮肤</legend>
    <div className="theme-choices">{themes.map(theme => {
      const t = theme.tokens
      const preview = { '--preview-canvas': t.canvas, '--preview-surface': t.surface, '--preview-sidebar': t.sidebar, '--preview-line': t.line, '--preview-primary': t.primary, '--preview-ink': t.ink, '--preview-selected': t['sidebar-selected'] } as CSSProperties
      return <label className={`theme-choice ${selected === theme.id ? 'selected' : ''}`} key={theme.id}>
        <input type="radio" name={group} value={theme.id} aria-label={theme.name} checked={selected === theme.id} onChange={() => {
          setSelected(theme.id)
          const persisted = setThemePreference(theme.id)
          setNotice(persisted ? `已切换为${theme.name}` : `已切换为${theme.name}，但无法记住选择；请检查浏览器存储权限。`)
        }} />
        <span className={`theme-preview preview-${theme.id}`} style={preview} aria-hidden="true">
          <span className="theme-preview-nav"><i/><i/><i/><i/></span>
          <span className="theme-preview-main"><span className="theme-preview-top"/><span className="theme-preview-sheet"><i/><i/><i/><b/></span></span>
        </span>
        <span className="theme-choice-name">{theme.name}<span className="theme-choice-check" aria-hidden="true">{selected === theme.id && <Check size={13}/>}</span></span>
        <span className="theme-choice-description">{theme.description}</span>
      </label>
    })}</div>
    <p className="theme-local-note">仅保存在当前设备，不影响题目和原图。</p>
    <span className="theme-status" role="status" aria-live="polite">{notice}</span>
  </fieldset>
}
