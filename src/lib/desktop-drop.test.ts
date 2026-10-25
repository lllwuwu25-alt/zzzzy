import { expect, it, vi } from 'vitest'
import type { DragDropEvent } from '@tauri-apps/api/webview'
import { PhysicalPosition } from '@tauri-apps/api/dpi'
import { startDesktopDropListener } from './desktop-drop'

it('releases a native subscription that completes after unmount and ignores later events', async () => {
  let complete!: (release: () => void) => void
  let deliver!: (event: DragDropEvent) => void
  const release = vi.fn(), received = vi.fn(), failed = vi.fn()
  const stop = startDesktopDropListener(handler => {
    deliver = handler
    return new Promise(resolve => { complete = resolve })
  }, received, failed)
  stop()
  complete(release)
  await Promise.resolve()
  deliver({ type: 'leave' })
  expect(release).toHaveBeenCalledOnce()
  expect(received).not.toHaveBeenCalled()
  expect(failed).not.toHaveBeenCalled()
})

it('receives native paths while mounted and releases exactly once', async () => {
  let deliver!: (event: DragDropEvent) => void
  const release = vi.fn(), received = vi.fn()
  const stop = startDesktopDropListener(async handler => { deliver = handler; return release }, received, vi.fn())
  await Promise.resolve()
  const event: DragDropEvent = { type: 'drop', paths: ['/tmp/question.png'], position: new PhysicalPosition(10, 20) }
  deliver(event)
  expect(received).toHaveBeenCalledWith(event)
  stop(); stop()
  expect(release).toHaveBeenCalledOnce()
})

it('reports registration errors only while mounted', async () => {
  const failed = vi.fn(), staleFailure = vi.fn()
  const error = new Error('event listen not allowed')
  startDesktopDropListener(() => Promise.reject(error), vi.fn(), failed)
  const stop = startDesktopDropListener(() => Promise.reject(error), vi.fn(), staleFailure)
  stop()
  await Promise.resolve(); await Promise.resolve()
  expect(failed).toHaveBeenCalledWith(error)
  expect(staleFailure).not.toHaveBeenCalled()
})
