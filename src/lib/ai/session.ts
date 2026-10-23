import type { Mistake } from '../../types'
export function sameRecognitionSource(a: Mistake, b: Mistake) {
  return a.id === b.id && a.questionType === b.questionType && a.images.length === b.images.length && a.images.every((image, i) => image.id === b.images[i].id && image.dataUrl === b.images[i].dataUrl)
}
export function createRecognitionSession() {
  let sequence = 0, activeItem: string | undefined
  return {
    start(itemId: string) { activeItem = itemId; return ++sequence },
    cancel() { activeItem = undefined; sequence++ },
    isCurrent(token: number, itemId: string) { return token === sequence && itemId === activeItem },
  }
}
