import { afterEach, expect, it, vi } from 'vitest'
import { applyTheme, getThemePreference, setThemePreference, themes } from './themes'

afterEach(() => vi.unstubAllGlobals())

it('provides exactly the five approved skins and falls back to ink', () => {
  expect(themes.map(theme => [theme.id, theme.name])).toEqual([
    ['ink', '墨青'], ['mist', '雾白'], ['plum', '暮紫'], ['night', '夜读'], ['paint', '彩绘'],
  ])
  vi.stubGlobal('localStorage', { getItem: () => 'obsolete-theme' })
  expect(getThemePreference()).toBe('ink')
  vi.stubGlobal('localStorage', { getItem: () => 'night' })
  expect(getThemePreference()).toBe('night')
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') } })
  expect(getThemePreference()).toBe('ink')
})

it('applies a skin immediately and reports blocked persistence without losing session appearance', () => {
  const properties = new Map<string, string>(), dataset: Record<string, string> = {}, style = { setProperty: (key: string, value: string) => properties.set(key, value) }
  const meta = { setAttribute: vi.fn() }
  vi.stubGlobal('document', { documentElement: { dataset, style }, querySelector: () => meta })
  const saved = new Map<string, string>()
  vi.stubGlobal('localStorage', { setItem: (key: string, value: string) => saved.set(key, value), getItem: (key: string) => saved.get(key) ?? null })
  expect(setThemePreference('night')).toBe(true)
  expect(dataset.theme).toBe('night')
  expect(properties.get('--canvas')).toBe('#171c21')
  expect(properties.get('color-scheme')).toBe('dark')
  expect(getThemePreference()).toBe('night')
  expect(meta.setAttribute).toHaveBeenCalledWith('content', '#171c21')
  vi.stubGlobal('localStorage', { setItem: () => { throw new Error('full') } })
  expect(setThemePreference('paint')).toBe(false)
  expect(dataset.theme).toBe('paint')
  expect(() => applyTheme('ink')).not.toThrow()
})

// Independent WCAG relative-luminance calculation, not production implementation.
function contrast(a: string, b: string) {
  const luminance = (color: string) => {
    const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
    return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]
  }
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + .05) / (values[1] + .05)
}

it('keeps text, placeholder and primary/semantic button colors readable in every skin', () => {
  for (const theme of themes) {
    const t = theme.tokens
    for (const [fg, bg] of [
      ['ink', 'canvas'], ['ink', 'surface'], ['muted', 'canvas'], ['muted', 'surface'], ['muted', 'soft'],
      ['on-primary', 'primary'], ['on-primary', 'primary-hover'], ['sidebar-ink', 'sidebar'], ['sidebar-muted', 'sidebar'],
      ['sidebar-ink', 'sidebar-selected'], ['accent-text', 'selected'], ['danger', 'danger-soft'], ['warning', 'warning-soft'], ['success', 'success-soft'],
    ] as const) expect(contrast(t[fg], t[bg]), `${theme.id}: ${fg}/${bg}`).toBeGreaterThanOrEqual(4.5)
  }
})
