import { fromISODate, toISODate } from './format'
import type { HabitLog, WeightEntry, Workout, WorkoutSet } from './types'

/* ---------------- weight ---------------- */

export interface WeightPoint {
  date: string
  weight_kg: number
  trend_kg: number
}

/**
 * Daily weight is mostly water noise, so the 7-day trend line is the series
 * people should actually read. Both are returned; the chart labels the trend.
 */
export function weightSeries(entries: WeightEntry[], windowDays = 7): WeightPoint[] {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date))
  return sorted.map((entry, i) => {
    const cutoff = fromISODate(entry.date).getTime() - windowDays * 86_400_000
    const window = sorted
      .slice(0, i + 1)
      .filter((e) => fromISODate(e.date).getTime() > cutoff)
    const trend = window.reduce((s, e) => s + e.weight_kg, 0) / (window.length || 1)
    return {
      date: entry.date,
      weight_kg: entry.weight_kg,
      trend_kg: Number(trend.toFixed(2)),
    }
  })
}

/** kg per week, from the trend line rather than raw endpoints. */
export function weightRateOfChange(points: WeightPoint[], days = 28) {
  if (points.length < 2) return 0
  const last = points[points.length - 1]
  const cutoff = fromISODate(last.date).getTime() - days * 86_400_000
  const window = points.filter((p) => fromISODate(p.date).getTime() >= cutoff)
  if (window.length < 2) return 0
  const first = window[0]
  const spanDays =
    (fromISODate(last.date).getTime() - fromISODate(first.date).getTime()) / 86_400_000
  if (spanDays <= 0) return 0
  return ((last.trend_kg - first.trend_kg) / spanDays) * 7
}

/* ---------------- lifting ---------------- */

export interface ExerciseProgress {
  exercise: string
  sessions: Array<{ date: string; topSet: number; volume: number; estimated1RM: number }>
  best: number
  latest: number
  changePct: number
}

/** Epley formula. Good enough for tracking, not a max attempt. */
export function estimate1RM(weightKg: number, reps: number) {
  if (reps <= 1) return weightKg
  return weightKg * (1 + reps / 30)
}

export function exerciseProgress(
  workouts: Workout[],
  sets: WorkoutSet[],
): ExerciseProgress[] {
  const byWorkout = new Map(workouts.map((w) => [w.id, w]))
  const grouped = new Map<string, Map<string, WorkoutSet[]>>()

  for (const set of sets) {
    const workout = byWorkout.get(set.workout_id)
    if (!workout) continue
    let byDate = grouped.get(set.exercise)
    if (!byDate) {
      byDate = new Map()
      grouped.set(set.exercise, byDate)
    }
    const list = byDate.get(workout.date) ?? []
    list.push(set)
    byDate.set(workout.date, list)
  }

  return [...grouped.entries()]
    .map(([exercise, byDate]) => {
      const sessions = [...byDate.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, daySets]) => ({
          date,
          topSet: Math.max(...daySets.map((s) => s.weight_kg)),
          volume: daySets.reduce((s, x) => s + x.weight_kg * x.reps, 0),
          estimated1RM: Math.round(
            Math.max(...daySets.map((s) => estimate1RM(s.weight_kg, s.reps))),
          ),
        }))
      const best = Math.max(...sessions.map((s) => s.topSet))
      const latest = sessions[sessions.length - 1]?.topSet ?? 0
      const first = sessions[0]?.topSet ?? 0
      return {
        exercise,
        sessions,
        best,
        latest,
        changePct: first > 0 ? ((latest - first) / first) * 100 : 0,
      }
    })
    .sort((a, b) => b.sessions.length - a.sessions.length)
}

export function weeklyVolume(workouts: Workout[], sets: WorkoutSet[], weeks = 12) {
  const byWorkout = new Map(workouts.map((w) => [w.id, w]))
  const totals = new Map<string, { volume: number; sessions: Set<string> }>()

  for (const set of sets) {
    const workout = byWorkout.get(set.workout_id)
    if (!workout) continue
    const key = weekKey(workout.date)
    const entry = totals.get(key) ?? { volume: 0, sessions: new Set<string>() }
    entry.volume += set.weight_kg * set.reps
    entry.sessions.add(workout.id)
    totals.set(key, entry)
  }

  return [...totals.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-weeks)
    .map(([key, v]) => ({
      week: key,
      volume: Math.round(v.volume),
      sessions: v.sessions.size,
    }))
}

/** ISO-ish week key: the Monday that starts the week. */
export function weekKey(iso: string) {
  const d = fromISODate(iso)
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  return toISODate(d)
}

/* ---------------- habits ---------------- */

export function habitStreak(logs: HabitLog[], habitId: string) {
  const dates = new Set(logs.filter((l) => l.habit_id === habitId).map((l) => l.date))
  let streak = 0
  const cursor = new Date()

  // Today not being logged yet should not break a streak that is otherwise live.
  if (!dates.has(toISODate(cursor))) cursor.setDate(cursor.getDate() - 1)

  while (dates.has(toISODate(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export function habitCompletion(logs: HabitLog[], habitId: string, days = 30) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffISO = toISODate(cutoff)
  const hits = logs.filter((l) => l.habit_id === habitId && l.date >= cutoffISO).length
  return (hits / days) * 100
}

/** Last `weeks` weeks as a grid of ISO dates, oldest week first. */
export function heatmapWeeks(weeks = 17) {
  const out: string[][] = []
  const end = new Date()
  const endDay = (end.getDay() + 6) % 7
  end.setDate(end.getDate() - endDay)

  for (let w = weeks - 1; w >= 0; w--) {
    const weekStart = new Date(end)
    weekStart.setDate(weekStart.getDate() - w * 7)
    const days: string[] = []
    for (let d = 0; d < 7; d++) {
      const day = new Date(weekStart)
      day.setDate(day.getDate() + d)
      days.push(toISODate(day))
    }
    out.push(days)
  }
  return out
}

export const COMMON_EXERCISES = [
  'Barbell Squat',
  'Front Squat',
  'Bench Press',
  'Incline Bench Press',
  'Deadlift',
  'Romanian Deadlift',
  'Overhead Press',
  'Barbell Row',
  'Pull-up',
  'Chin-up',
  'Dip',
  'Lat Pulldown',
  'Leg Press',
  'Lunge',
  'Hip Thrust',
  'Bicep Curl',
  'Tricep Extension',
  'Lateral Raise',
  'Face Pull',
  'Calf Raise',
]
