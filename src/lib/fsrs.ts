import type { Rating, Schedule } from '../types'

const day = 86_400_000
const weights: Record<Rating, { difficulty: number; stability: number }> = {
  again: { difficulty: 1.1, stability: 0.2 },
  hard: { difficulty: 0.35, stability: 1.15 },
  good: { difficulty: -0.15, stability: 2.15 },
  easy: { difficulty: -0.35, stability: 3.4 },
}

export const initialSchedule = (now = new Date()): Schedule => ({
  due: now.toISOString(),
  stability: 0.4,
  difficulty: 5,
  reps: 0,
  lapses: 0,
})

export function scheduleReview(current: Schedule, rating: Rating, now = new Date()): Schedule {
  const elapsed = current.lastReview ? Math.max(0, (now.getTime() - new Date(current.lastReview).getTime()) / day) : 0
  const retrievability = Math.exp(-elapsed / Math.max(0.1, current.stability))
  const weight = weights[rating]
  const difficulty = Math.min(10, Math.max(1, current.difficulty + weight.difficulty))
  const growth = rating === 'again'
    ? weight.stability
    : weight.stability * (1 + (1 - retrievability) * 1.4) * (1 + (10 - difficulty) / 20)
  const stability = Math.max(0.2, current.stability * growth)
  const interval = rating === 'again' ? 1 : Math.max(1, Math.round(stability * (rating === 'easy' ? 1.25 : 1)))
  return {
    due: new Date(now.getTime() + interval * day).toISOString(),
    stability: Number(stability.toFixed(3)),
    difficulty: Number(difficulty.toFixed(3)),
    reps: current.reps + 1,
    lapses: current.lapses + (rating === 'again' ? 1 : 0),
    lastReview: now.toISOString(),
  }
}

export const duePriority = (schedule: Schedule, now = new Date()) => {
  const overdueDays = (now.getTime() - new Date(schedule.due).getTime()) / day
  return overdueDays + schedule.difficulty / 10 - Math.log2(schedule.stability + 1)
}
