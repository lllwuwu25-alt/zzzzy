export type ThemeId = 'ink' | 'mist' | 'plum' | 'night' | 'paint'
type ThemeToken = 'canvas' | 'surface' | 'panel' | 'soft' | 'ink' | 'muted' | 'line' | 'control-border' |
  'primary' | 'primary-hover' | 'on-primary' | 'accent' | 'accent-text' | 'selected' | 'selected-border' | 'hover' |
  'sidebar' | 'sidebar-ink' | 'sidebar-muted' | 'sidebar-selected' | 'sidebar-border' | 'sidebar-hover' |
  'danger' | 'danger-soft' | 'warning' | 'warning-soft' | 'success' | 'success-soft' | 'focus'
export type AppTheme = { id: ThemeId; name: string; description: string; dark: boolean; tokens: Record<ThemeToken, string> }

export const themes: readonly AppTheme[] = [
  { id: 'ink', name: '墨青', description: '熟悉的墨青，清晰而安静', dark: false, tokens: {
    canvas: '#f3f7f8', surface: '#ffffff', panel: '#f9fcfc', soft: '#edf3f4', ink: '#1f2328', muted: '#52666e', line: '#d9e2e5', 'control-border': '#afc1c6',
    primary: '#153c43', 'primary-hover': '#20545d', 'on-primary': '#ffffff', accent: '#287d87', 'accent-text': '#235761', selected: '#e5eff1', 'selected-border': '#64979f', hover: '#eaf2f4',
    sidebar: '#102f35', 'sidebar-ink': '#edf5f6', 'sidebar-muted': '#bcd0d3', 'sidebar-selected': '#1c4b54', 'sidebar-border': '#76989c', 'sidebar-hover': '#21444b',
    danger: '#a03636', 'danger-soft': '#fff0ee', warning: '#815414', 'warning-soft': '#fff6e6', success: '#286349', 'success-soft': '#eaf6ef', focus: '#397e89',
  } },
  { id: 'mist', name: '雾白', description: '浅灰与留白，轻盈不分心', dark: false, tokens: {
    canvas: '#f5f6f7', surface: '#ffffff', panel: '#fafbfc', soft: '#edf0f2', ink: '#252b33', muted: '#555f6c', line: '#dce0e5', 'control-border': '#b3bcc7',
    primary: '#354150', 'primary-hover': '#475569', 'on-primary': '#ffffff', accent: '#54677f', 'accent-text': '#3b4f68', selected: '#e7edf4', 'selected-border': '#7a8fa9', hover: '#edf1f5',
    sidebar: '#e9edf1', 'sidebar-ink': '#293747', 'sidebar-muted': '#506073', 'sidebar-selected': '#d3dde8', 'sidebar-border': '#9eafc1', 'sidebar-hover': '#dde5ec',
    danger: '#a03636', 'danger-soft': '#fff0ee', warning: '#815414', 'warning-soft': '#fff6e6', success: '#286349', 'success-soft': '#eaf6ef', focus: '#526e91',
  } },
  { id: 'plum', name: '暮紫', description: '灰紫与梅色，柔和有层次', dark: false, tokens: {
    canvas: '#f6f4f8', surface: '#ffffff', panel: '#fcfafe', soft: '#eeeaf2', ink: '#302b37', muted: '#665a70', line: '#e0d9e6', 'control-border': '#bdadc8',
    primary: '#654d73', 'primary-hover': '#796087', 'on-primary': '#ffffff', accent: '#8b659c', 'accent-text': '#694778', selected: '#ede4f3', 'selected-border': '#9c7eaf', hover: '#f0eaf5',
    sidebar: '#392f43', 'sidebar-ink': '#f7f0fc', 'sidebar-muted': '#d0bedc', 'sidebar-selected': '#594269', 'sidebar-border': '#9f87ae', 'sidebar-hover': '#4b3b58',
    danger: '#a0364c', 'danger-soft': '#fff0f2', warning: '#815414', 'warning-soft': '#fff6e6', success: '#286349', 'success-soft': '#eaf6ef', focus: '#876398',
  } },
  { id: 'night', name: '夜读', description: '炭灰与青绿，陪伴暗光阅读', dark: true, tokens: {
    canvas: '#171c21', surface: '#222930', panel: '#1d242b', soft: '#2b353e', ink: '#e4eaf0', muted: '#aebdc7', line: '#3c4854', 'control-border': '#637583',
    primary: '#a5d8cd', 'primary-hover': '#c1e9df', 'on-primary': '#162a29', accent: '#8dcfc4', 'accent-text': '#a9ddd4', selected: '#2b4647', 'selected-border': '#76b3b0', hover: '#303b44',
    sidebar: '#11171c', 'sidebar-ink': '#e4eaf0', 'sidebar-muted': '#aebdc7', 'sidebar-selected': '#294244', 'sidebar-border': '#548d8d', 'sidebar-hover': '#263139',
    danger: '#ffb4b0', 'danger-soft': '#442a2e', warning: '#edcd95', 'warning-soft': '#3c3425', success: '#a5d7b7', 'success-soft': '#273c33', focus: '#9bd5cd',
  } },
  { id: 'paint', name: '彩绘', description: '彩铅般的色彩，留一点轻快', dark: false, tokens: {
    canvas: '#f5f7fa', surface: '#ffffff', panel: '#fcfdff', soft: '#edf0f7', ink: '#30374a', muted: '#566078', line: '#dbe1ed', 'control-border': '#aebbd0',
    primary: '#496698', 'primary-hover': '#36517f', 'on-primary': '#ffffff', accent: '#397564', 'accent-text': '#3e5c8c', selected: '#e7eefb', 'selected-border': '#7e9fce', hover: '#edf1fa',
    sidebar: '#e8edf8', 'sidebar-ink': '#303e60', 'sidebar-muted': '#505e7a', 'sidebar-selected': '#d6e2f5', 'sidebar-border': '#a1b6d6', 'sidebar-hover': '#dfe6f4',
    danger: '#a23f4b', 'danger-soft': '#fceef0', warning: '#805611', 'warning-soft': '#fff5dc', success: '#286349', 'success-soft': '#eaf6ef', focus: '#5477aa',
  } },
]

const preferenceKey = 'notebook-theme'
export function getThemePreference(): ThemeId {
  try { const value = localStorage.getItem(preferenceKey); return themes.find(theme => theme.id === value)?.id ?? 'ink' } catch { return 'ink' }
}
export function applyTheme(id: ThemeId) {
  const theme = themes.find(entry => entry.id === id) ?? themes[0]
  if (typeof document === 'undefined') return
  const root = document.documentElement
  for (const [name, value] of Object.entries(theme.tokens)) root.style.setProperty(`--${name}`, value)
  root.style.setProperty('color-scheme', theme.dark ? 'dark' : 'light')
  root.dataset.theme = theme.id
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.tokens.canvas)
}
export function setThemePreference(id: ThemeId): boolean {
  applyTheme(id)
  try { localStorage.setItem(preferenceKey, id); return true } catch { return false }
}
