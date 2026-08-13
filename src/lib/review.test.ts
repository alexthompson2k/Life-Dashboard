import { describe, expect, it } from 'vitest'
import { buildReview, shiftWeek, weekRange, type ReviewInput } from './review'
import type { Task, Transaction, Workout } from './types'

// 2026-08-12 is a Wednesday; its week runs Mon 10th to Sun 16th.
const TODAY = '2026-08-12'

const empty: ReviewInput = {
  date: TODAY,
  tasks: [],
  transactions: [],
  workouts: [],
  sets: [],
  weights: [],
  habits: [],
  habitLogs: [],
  journal: [],
}

const task = (completedAt: string | null): Task => ({
  id: `t-${completedAt}-${Math.random()}`,
  title: 'Thing',
  notes: null,
  due_date: null,
  due_time: null,
  priority: 'medium',
  completed: completedAt !== null,
  completed_at: completedAt,
  list: 'Inbox',
  recurrence: 'none',
  created_at: '2026-08-01T00:00:00.000Z',
})

const txn = (date: string, amount: number, category = 'Dining'): Transaction => ({
  id: `x-${date}-${amount}`,
  account_id: null,
  date,
  name: 'Thing',
  merchant: null,
  amount,
  category,
  pending: false,
  plaid_transaction_id: null,
  notes: null,
})

const workout = (date: string): Workout => ({
  id: `w-${date}`,
  date,
  name: 'Session',
  duration_min: 60,
  notes: null,
})

describe('weekRange', () => {
  it('runs Monday to Sunday around the given date', () => {
    expect(weekRange(TODAY)).toEqual({ start: '2026-08-10', end: '2026-08-16' })
  })

  it('treats Sunday as the end of its week, not the start', () => {
    expect(weekRange('2026-08-16')).toEqual({ start: '2026-08-10', end: '2026-08-16' })
  })

  it('treats Monday as the start', () => {
    expect(weekRange('2026-08-10')).toEqual({ start: '2026-08-10', end: '2026-08-16' })
  })
})

describe('shiftWeek', () => {
  it('steps backwards and forwards a whole week', () => {
    const current = weekRange(TODAY)
    expect(shiftWeek(current, -1).start).toBe('2026-08-03')
    expect(shiftWeek(current, 1).start).toBe('2026-08-17')
  })
})

describe('buildReview', () => {
  it('counts only what happened inside the week', () => {
    const review = buildReview({
      ...empty,
      tasks: [
        task('2026-08-11T10:00:00.000Z'), // this week
        task('2026-08-05T10:00:00.000Z'), // last week
        task(null), // never completed
      ],
    })
    const tasks = review.metrics.find((m) => m.label === 'Tasks completed')!
    expect(tasks.value).toBe(1)
    expect(tasks.previous).toBe(1)
  })

  it('compares against the preceding week', () => {
    const review = buildReview({
      ...empty,
      workouts: [workout('2026-08-10'), workout('2026-08-12'), workout('2026-08-04')],
    })
    const workouts = review.metrics.find((m) => m.label === 'Workouts')!
    expect(workouts.value).toBe(2)
    expect(workouts.previous).toBe(1)
  })

  it('excludes transfers from spending, as everywhere else', () => {
    const review = buildReview({
      ...empty,
      transactions: [txn('2026-08-11', -50), txn('2026-08-11', -900, 'Transfer')],
    })
    expect(review.metrics.find((m) => m.label === 'Spending')!.value).toBe(50)
  })

  it('ranks the week’s spending categories', () => {
    const review = buildReview({
      ...empty,
      transactions: [
        txn('2026-08-11', -20, 'Dining'),
        txn('2026-08-12', -80, 'Groceries'),
        txn('2026-08-12', -10, 'Dining'),
      ],
    })
    expect(review.topCategories[0]).toEqual({ category: 'Groceries', amount: 80 })
    expect(review.topCategories[1]).toEqual({ category: 'Dining', amount: 30 })
  })

  it('reports habit progress against each target', () => {
    const review = buildReview({
      ...empty,
      habits: [
        {
          id: 'h1',
          name: 'Walk',
          target_per_week: 5,
          color_slot: 1,
          archived: false,
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      habitLogs: [
        { id: 'l1', habit_id: 'h1', date: '2026-08-10' },
        { id: 'l2', habit_id: 'h1', date: '2026-08-11' },
      ],
    })
    expect(review.habitSummary).toEqual([{ name: 'Walk', done: 2, target: 5 }])
  })

  it('reports the weight change between week-end trends', () => {
    const review = buildReview({
      ...empty,
      weights: [
        { id: 'a', date: '2026-08-05', weight_kg: 81, body_fat_pct: null, note: null },
        { id: 'b', date: '2026-08-06', weight_kg: 81, body_fat_pct: null, note: null },
        { id: 'c', date: '2026-08-15', weight_kg: 80, body_fat_pct: null, note: null },
        { id: 'd', date: '2026-08-16', weight_kg: 80, body_fat_pct: null, note: null },
      ],
    })
    expect(review.weightChangeKg).toBeLessThan(0)
  })

  it('reports no weight change when there is nothing to compare', () => {
    expect(buildReview(empty).weightChangeKg).toBeNull()
  })

  describe('headline', () => {
    it('says so plainly when nothing was logged', () => {
      expect(buildReview(empty).headline).toBe('A quiet week — nothing logged.')
    })

    it('leads with training when sessions increased', () => {
      const review = buildReview({
        ...empty,
        workouts: [workout('2026-08-10'), workout('2026-08-12')],
      })
      expect(review.headline).toContain('Training picked up')
    })

    it('calls out a spending spike', () => {
      const review = buildReview({
        ...empty,
        transactions: [txn('2026-08-04', -100), txn('2026-08-11', -400)],
      })
      expect(review.headline).toContain('Spending ran well above')
    })

    it('celebrates hitting every habit target', () => {
      const review = buildReview({
        ...empty,
        habits: [
          {
            id: 'h1',
            name: 'Walk',
            target_per_week: 2,
            color_slot: 1,
            archived: false,
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
        habitLogs: [
          { id: 'l1', habit_id: 'h1', date: '2026-08-10' },
          { id: 'l2', habit_id: 'h1', date: '2026-08-11' },
        ],
      })
      expect(review.headline).toBe('Every habit target met this week.')
    })

    it('falls back to a neutral summary rather than inventing drama', () => {
      const review = buildReview({
        ...empty,
        transactions: [txn('2026-08-04', -100), txn('2026-08-11', -100)],
      })
      expect(review.headline).toBe('A steady week — no big swings in either direction.')
    })
  })
})
