import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ActionButton } from './ActionButton'

describe('ActionButton', () => {
  it('prevents duplicate actions and exposes progress while busy', () => {
    const html = renderToStaticMarkup(<ActionButton busy busyLabel="正在保存">保存</ActionButton>)

    expect(html).toContain('disabled=""')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('正在保存')
    expect(html).not.toContain('>保存<')
  })

  it('announces a completed action without leaving the button active', () => {
    const html = renderToStaticMarkup(<ActionButton success successLabel="已保存">保存</ActionButton>)

    expect(html).toContain('disabled=""')
    expect(html).toContain('data-state="success"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('已保存')
  })
})
