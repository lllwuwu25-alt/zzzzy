import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AnnotatedImage } from './AnnotatedImage'
it('does not render an uncached cloud image as a silently blank canvas', () => {
  const html = renderToStaticMarkup(<AnnotatedImage image={{ id: 'image', name: '题图', dataUrl: 'data:image/png;base64,', rotation: 0, annotations: [] }} alt="题图" />)
  expect(html).toContain('原图尚未下载')
  expect(html).toContain('下载原图')
})
