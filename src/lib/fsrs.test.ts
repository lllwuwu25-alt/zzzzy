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
  it('uses the selected custom interval without changing review evidence', () => {
    const settings = { mode: 'custom' as const, intervals: { again: 1, hard: 3, good: 8, easy: 21 } }
    const result = scheduleReview(initialSchedule(now), 'easy', now, settings)
    expect(result.due).toBe(new Date(now.getTime() + 21 * 86_400_000).toISOString())
    expect(result.reps).toBe(1)
    expect(result.difficulty).toBeLessThan(5)
  })
  it('clamps custom intervals to the supported range', () => {
    const settings = { mode: 'custom' as const, intervals: { again: 0, hard: 3, good: 8, easy: 9000 } }
    expect(scheduleReview(initialSchedule(now), 'again', now, settings).due).toBe(new Date(now.getTime() + 86_400_000).toISOString())
    expect(scheduleReview(initialSchedule(now), 'easy', now, settings).due).toBe(new Date(now.getTime() + 3650 * 86_400_000).toISOString())
  })
})
