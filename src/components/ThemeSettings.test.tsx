import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ThemeSettings } from './ThemeSettings'

afterEach(() => vi.unstubAllGlobals())
it('offers all five labeled skins with the persisted selection and keyboard-native radios', () => {
  vi.stubGlobal('localStorage', { getItem: () => 'paint' })
  const html = renderToStaticMarkup(<ThemeSettings />)
  expect(html.match(/type="radio"/g)).toHaveLength(5)
  for (const label of ['墨青', '雾白', '暮紫', '夜读', '彩绘']) expect(html).toContain(`aria-label="${label}"`)
  expect(html).toMatch(/aria-label="彩绘"[^>]*checked=""/)
  expect(html).toContain('工作台皮肤')
  expect(html).toContain('仅保存在当前设备')
})
