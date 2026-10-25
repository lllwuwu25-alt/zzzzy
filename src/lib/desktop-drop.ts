import type { DragDropEvent } from '@tauri-apps/api/webview'

export function startDesktopDropListener(
  register: (handler: (payload: DragDropEvent) => void) => Promise<() => void>,
  onEvent: (payload: DragDropEvent) => void,
  onError: (error: unknown) => void,
): () => void {
  let active = true
  let release: (() => void) | undefined
  try {
    void register(payload => { if (active) onEvent(payload) }).then(unlisten => {
      if (active) release = unlisten
      else unlisten()
    }).catch(error => { if (active) onError(error) })
  } catch (error) { onError(error) }
  return () => {
    if (!active) return
    active = false
    release?.()
    release = undefined
  }
}
