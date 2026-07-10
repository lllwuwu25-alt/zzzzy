import { describe, expect, it } from 'vitest'
import { initialSchedule, scheduleReview } from './fsrs'

describe('scheduler', () => {
  const now = new Date('2026-07-09T08:00:00.000Z')
  it('keeps again due before good and easy', () => {
    const base = initialSchedule(now)
    const again = scheduleReview(base, 'again', now)
    const good = scheduleReview(base, 'good', now)
    const easy = scheduleReview(base, 'easy', now)
    expect(new Date(again.due).getTime()).toBeLessThanOrEqual(new Date(good.due).getTime())
    expect(new Date(easy.due).getTime()).toBeGreaterThanOrEqual(new Date(good.due).getTime())
  })
  it('records lapses only for again', () => {
    expect(scheduleReview(initialSchedule(now), 'again', now).lapses).toBe(1)
    expect(scheduleReview(initialSchedule(now), 'hard', now).lapses).toBe(0)
  })
})
