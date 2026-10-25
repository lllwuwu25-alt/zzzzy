import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CloudStatusView, ConflictView } from './CloudSettings'
import type { SyncConflict } from '../../sync/model'

describe('cloud settings presentation', () => {
  it('does not present an unconfigured gateway as a connection or ask users for developer secrets', () => {
    const html = renderToStaticMarkup(<CloudStatusView phase="unconfigured" pending={0} images={0} conflicts={0} />)
    expect(html).toContain('云同步尚未开放')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('已同步')
  })
  it('only reports completed synchronization after all queues have been acknowledged', () => {
    const pending = renderToStaticMarkup(<CloudStatusView phase="connected" pending={2} images={1} conflicts={0} />)
    expect(pending).toContain('图片等待上传')
    expect(pending).not.toContain('已同步')
    const complete = renderToStaticMarkup(<CloudStatusView phase="connected" pending={0} images={0} conflicts={0} lastSuccess="2026-10-25T00:00:00Z" />)
    expect(complete).toContain('已同步')
    const never = renderToStaticMarkup(<CloudStatusView phase="connected" pending={0} images={0} conflicts={0} />)
    expect(never).not.toContain('已同步')
  })
  it('shows changed notes and answers, not just an identical question title', () => {
    const conflict: SyncConflict = { id: 'c', kind: 'question', entityId: 'q', type: 'edit-edit', createdAt: '2026-10-25', local: { mutationId: 'm', entityId: 'q', kind: 'question', baseRevision: 1, payload: { schemaVersion: 1, question: '同一道题', note: '本机提醒', answer: '答案甲' } }, remote: { id: 'q', kind: 'question', revision: 2, payload: { schemaVersion: 1, question: '同一道题', note: '云端提醒', answer: '答案乙' } } }
    const html = renderToStaticMarkup(<ConflictView conflict={conflict}/>)
    for (const text of ['本机提醒', '云端提醒', '答案甲', '答案乙']) expect(html).toContain(text)
  })
})
