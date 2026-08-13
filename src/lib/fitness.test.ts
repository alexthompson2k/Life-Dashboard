import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  estimate1RM,
  exerciseProgress,
  habitCompletion,
  habitStreak,
  heatmapWeeks,
  weekKey,
  weeklyVolume,
  weightRateOfChange,
  weightSeries,
} from './fitness'
import { toISODate } from './format'
import type { HabitLog, WeightEntry, Workout, WorkoutSet } from './types'

afterEach(() => {
  vi.useRealTimers()
})

const weigh = (date: string, weight_kg: number): WeightEntry => ({
  id: date,
  date,
  weight_kg,
  body_fat_pct: null,
  note: null,
})

/** ISO date N days before the (possibly faked) current time. */
function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return toISODate(d)
}

describe('weightSeries', () => {
  it('smooths daily noise into a trailing trend', () => {
    const series = weightSeries([
      weigh('2026-08-01', 80),
      weigh('2026-08-02', 82),
      weigh('2026-08-03', 78),
    ])
    expect(series[0].trend_kg).toBe(80)
    expect(series[1].trend_kg).toBe(81)
    expect(series[2].trend_kg).toBe(80)
  })

  it('keeps the raw weigh-in alongside the trend', () => {
    const [point] = weightSeries([weigh('2026-08-01', 80)])
    expect(point.weight_kg).toBe(80)
  })

  it('sorts unordered input by date', () => {
    const series = weightSeries([weigh('2026-08-03', 78), weigh('2026-08-01', 80)])
    expect(series.map((p) => p.date)).toEqual(['2026-08-01', '2026-08-03'])
  })

  it('drops entries older than the window from the trend', () => {
    // The 1st is outside a 7-day window ending on the 20th, so it must not
    // drag the trend down.
    const series = weightSeries([weigh('2026-08-01', 100), weigh('2026-08-20', 80)], 7)
    expect(series[1].trend_kg).toBe(80)
  })

  it('returns nothing for no weigh-ins', () => {
    expect(weightSeries([])).toEqual([])
  })
})

describe('weightRateOfChange', () => {
  it('reports kilograms per week as a negative number when cutting', () => {
    // 1 kg lost over 28 days is 0.25 kg per week.
    const points = weightSeries([weigh('2026-07-16', 81), weigh('2026-08-13', 80)])
    expect(weightRateOfChange(points, 28)).toBeCloseTo(-0.25, 2)
  })

  it('is positive when gaining', () => {
    const points = weightSeries([weigh('2026-07-16', 80), weigh('2026-08-13', 81)])
    expect(weightRateOfChange(points, 28)).toBeGreaterThan(0)
  })

  it('is zero without enough points to draw a line through', () => {
    expect(weightRateOfChange([], 28)).toBe(0)
    expect(weightRateOfChange(weightSeries([weigh('2026-08-01', 80)]), 28)).toBe(0)
  })
})

describe('estimate1RM', () => {
  it('returns the load itself for a single rep', () => {
    expect(estimate1RM(100, 1)).toBe(100)
    expect(estimate1RM(100, 0)).toBe(100)
  })

  it('applies the Epley formula above one rep', () => {
    // 100 kg x 10 -> 100 * (1 + 10/30)
    expect(estimate1RM(100, 10)).toBeCloseTo(133.33, 2)
  })

  it('increases with reps at the same load', () => {
    expect(estimate1RM(100, 8)).toBeGreaterThan(estimate1RM(100, 5))
  })
})

describe('exerciseProgress', () => {
  const workouts: Workout[] = [
    { id: 'w1', date: '2026-08-01', name: 'Push', duration_min: 60, notes: null },
    { id: 'w2', date: '2026-08-08', name: 'Push', duration_min: 60, notes: null },
  ]
  const sets: WorkoutSet[] = [
    {
      id: 's1',
      workout_id: 'w1',
      exercise: 'Bench Press',
      set_index: 1,
      reps: 5,
      weight_kg: 80,
    },
    {
      id: 's2',
      workout_id: 'w1',
      exercise: 'Bench Press',
      set_index: 2,
      reps: 5,
      weight_kg: 90,
    },
    {
      id: 's3',
      workout_id: 'w2',
      exercise: 'Bench Press',
      set_index: 1,
      reps: 5,
      weight_kg: 100,
    },
  ]

  it('tracks the top set and total volume per session', () => {
    const [bench] = exerciseProgress(workouts, sets)
    expect(bench.exercise).toBe('Bench Press')
    expect(bench.sessions[0].topSet).toBe(90)
    expect(bench.sessions[0].volume).toBe(80 * 5 + 90 * 5)
    expect(bench.sessions[1].topSet).toBe(100)
  })

  it('reports the best ever and the change since the first session', () => {
    const [bench] = exerciseProgress(workouts, sets)
    expect(bench.best).toBe(100)
    expect(bench.latest).toBe(100)
    expect(bench.changePct).toBeCloseTo(11.11, 2)
  })

  it('orders sessions chronologically regardless of input order', () => {
    const [bench] = exerciseProgress([...workouts].reverse(), [...sets].reverse())
    expect(bench.sessions.map((s) => s.date)).toEqual(['2026-08-01', '2026-08-08'])
  })

  it('ignores sets whose workout is missing', () => {
    expect(
      exerciseProgress(
        [],
        [
          {
            id: 'x',
            workout_id: 'gone',
            exercise: 'Squat',
            set_index: 1,
            reps: 5,
            weight_kg: 100,
          },
        ],
      ),
    ).toEqual([])
  })
})

describe('weekKey', () => {
  it('anchors every day of a week to its Monday', () => {
    // 2026-08-12 is a Wednesday; its week starts Monday the 10th.
    expect(weekKey('2026-08-12')).toBe('2026-08-10')
    expect(weekKey('2026-08-10')).toBe('2026-08-10')
  })

  it('treats Sunday as the end of the week, not the start', () => {
    // 2026-08-16 is a Sunday and belongs to the week beginning the 10th.
    expect(weekKey('2026-08-16')).toBe('2026-08-10')
    expect(weekKey('2026-08-17')).toBe('2026-08-17')
  })
})

describe('weeklyVolume', () => {
  it('totals load by week and counts distinct sessions', () => {
    const volume = weeklyVolume(
      [
        { id: 'w1', date: '2026-08-10', name: 'A', duration_min: null, notes: null },
        { id: 'w2', date: '2026-08-12', name: 'B', duration_min: null, notes: null },
      ],
      [
        {
          id: 's1',
          workout_id: 'w1',
          exercise: 'Squat',
          set_index: 1,
          reps: 5,
          weight_kg: 100,
        },
        {
          id: 's2',
          workout_id: 'w2',
          exercise: 'Squat',
          set_index: 1,
          reps: 5,
          weight_kg: 100,
        },
      ],
    )
    expect(volume).toHaveLength(1)
    expect(volume[0].week).toBe('2026-08-10')
    expect(volume[0].volume).toBe(1000)
    expect(volume[0].sessions).toBe(2)
  })
})

describe('habitStreak', () => {
  const logs = (dates: string[]): HabitLog[] =>
    dates.map((date, i) => ({ id: String(i), habit_id: 'h1', date }))

  it('counts consecutive days ending today', () => {
    expect(habitStreak(logs([daysAgo(0), daysAgo(1), daysAgo(2)]), 'h1')).toBe(3)
  })

  it('does not break a live streak just because today is not logged yet', () => {
    // The whole point: at 9am, yesterday's streak is still alive.
    expect(habitStreak(logs([daysAgo(1), daysAgo(2)]), 'h1')).toBe(2)
  })

  it('stops at the first missed day', () => {
    expect(habitStreak(logs([daysAgo(0), daysAgo(1), daysAgo(3)]), 'h1')).toBe(2)
  })

  it('is zero when neither today nor yesterday was logged', () => {
    expect(habitStreak(logs([daysAgo(2), daysAgo(3)]), 'h1')).toBe(0)
  })

  it('is zero with no logs at all', () => {
    expect(habitStreak([], 'h1')).toBe(0)
  })

  it('counts only the habit asked for', () => {
    const mixed: HabitLog[] = [
      { id: '1', habit_id: 'h1', date: daysAgo(0) },
      { id: '2', habit_id: 'h2', date: daysAgo(1) },
    ]
    expect(habitStreak(mixed, 'h1')).toBe(1)
  })
})

describe('habitCompletion', () => {
  it('reports the share of the window that was logged', () => {
    const logs: HabitLog[] = [0, 1, 2, 3, 4].map((n) => ({
      id: String(n),
      habit_id: 'h1',
      date: daysAgo(n),
    }))
    expect(habitCompletion(logs, 'h1', 10)).toBe(50)
  })

  it('is zero for a habit with no logs', () => {
    expect(habitCompletion([], 'h1', 30)).toBe(0)
  })
})

describe('heatmapWeeks', () => {
  it('returns whole weeks, oldest first, seven days each', () => {
    const weeks = heatmapWeeks(4)
    expect(weeks).toHaveLength(4)
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    expect(weeks[0][0] < weeks[3][0]).toBe(true)
  })

  it('starts each week on a Monday', () => {
    for (const week of heatmapWeeks(3)) {
      expect(weekKey(week[0])).toBe(week[0])
    }
  })
})
