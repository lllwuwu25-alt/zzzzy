import { describe, expect, it } from 'vitest'
import { cropFromDisplayRect, displaySize, displayToSource, eraseAt, moveAnnotation, sourceToDisplay } from './annotations'
import type { ImageAsset } from '../types'

const image = (rotation: number): ImageAsset => ({ id: 'i', name: 'i.png', dataUrl: '', rotation, annotations: [], editorVersion: 2, sourceWidth: 400, sourceHeight: 300, crop: { x: 50, y: 20, width: 200, height: 100 } })

describe('annotation geometry', () => {
  it.each([0, 90, 180, 270])('round trips source points at %s degrees', (rotation) => {
    const value = image(rotation)
    const point: [number, number] = [120, 70]
    const result = displayToSource(value, sourceToDisplay(value, point))
    expect(result[0]).toBeCloseTo(point[0]); expect(result[1]).toBeCloseTo(point[1])
  })

  it('swaps display dimensions after rotation', () => {
    expect(displaySize(image(0))).toEqual({ width: 200, height: 100 })
    expect(displaySize(image(90))).toEqual({ width: 100, height: 200 })
  })

  it('converts rotated crop rectangles back to source space', () => {
    expect(cropFromDisplayRect(image(90), { x: 10, y: 20, width: 40, height: 80 }, 400, 300)).toEqual({ x: 70, y: 70, width: 80, height: 40 })
  })

  it('moves and locally erases freehand annotations', () => {
    const stroke = { id: 's', tool: 'pen' as const, color: '#000', width: 3, points: [0, 0, 10, 0, 20, 0, 30, 0] }
    expect(moveAnnotation(stroke, 5, 4).points).toEqual([5, 4, 15, 4, 25, 4, 35, 4])
    expect(eraseAt([stroke], [10, 0], 2)[0].points).toEqual([20, 0, 30, 0])
  })
})
