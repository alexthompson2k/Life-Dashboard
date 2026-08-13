import { fromISODate, toISODate } from './format'
import { NON_SPEND_CATEGORIES } from './finance'
import { weightSeries } from './fitness'
import type {
  HabitLog,
  Habit,
  JournalEntry,
  Task,
  Transaction,
  WeightEntry,
  Workout,
  WorkoutSet,
} from './types'

/**
 * The weekly review.
 *
 * Every panel in the app answers "what is true now". This answers "what
 * changed", across all of it at once, which is the thing you cannot get from
 * five separate apps. Pure so the wording and the comparisons are testable.
 */

export interface WeekRange {
  start: string
  end: string
}

/** The Monday-to-Sunday week containing `date`. */
export function weekRange(date = toISODate()): WeekRange {
  const d = fromISODate(date)
  const offset = (d.getDay() + 6) % 7
  const start = new Date(d)
  start.setDate(start.getDate() - offset)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return { start: toISODate(start), end: toISODate(end) }
}

export function shiftWeek(range: WeekRange, weeks: number): WeekRange {
  const start = fromISODate(range.start)
  start.setDate(start.getDate() + weeks * 7)
  return weekRange(toISODate(start))
}

function inRange(date: string, range: WeekRange) {
  return date >= range.start && date <= range.end
}

export interface Metric {
  label: string
  value: number
  previous: number
  /** Which direction counts as an improvement, for colouring. */
  better: 'higher' | 'lower' | 'neutral'
  format: 'number' | 'currency' | 'weight' | 'percent'
}

export interface ReviewData {
  range: WeekRange
  previous: WeekRange
  metrics: Metric[]
  topCategories: Array<{ category: string; amount: number }>
  completedTasks: Task[]
  workouts: Workout[]
  habitSummary: Array<{ name: string; done: number; target: number }>
  journalEntries: JournalEntry[]
  weightChangeKg: number | null
  headline: string
}

export interface ReviewInput {
  date?: string
  tasks: Task[]
  transactions: Transaction[]
  workouts: Workout[]
  sets: WorkoutSet[]
  weights: WeightEntry[]
  habits: Habit[]
  habitLogs: HabitLog[]
  journal: JournalEntry[]
}

function spendIn(transactions: Transaction[], range: WeekRange) {
  return transactions
    .filter(
      (t) =>
        inRange(t.date, range) && t.amount < 0 && !NON_SPEND_CATEGORIES.has(t.category),
    )
    .reduce((sum, t) => sum + Math.abs(t.amount), 0)
}

function volumeIn(workouts: Workout[], sets: WorkoutSet[], range: WeekRange) {
  const ids = new Set(workouts.filter((w) => inRange(w.date, range)).map((w) => w.id))
  return sets
    .filter((s) => ids.has(s.workout_id))
    .reduce((sum, s) => sum + s.weight_kg * s.reps, 0)
}

/** Trend weight on the last day of the week, so daily noise is smoothed out. */
function trendWeightAt(weights: WeightEntry[], range: WeekRange): number | null {
  const upTo = weights.filter((w) => w.date <= range.end)
  if (upTo.length === 0) return null
  const series = weightSeries(upTo)
  return series[series.length - 1]?.trend_kg ?? null
}

export function buildReview(input: ReviewInput): ReviewData {
  const range = weekRange(input.date ?? toISODate())
  const previous = shiftWeek(range, -1)

  const completedIn = (r: WeekRange) =>
    input.tasks.filter(
      (t) => t.completed && t.completed_at && inRange(t.completed_at.slice(0, 10), r),
    )

  const workoutsIn = (r: WeekRange) => input.workouts.filter((w) => inRange(w.date, r))
  const habitLogsIn = (r: WeekRange) => input.habitLogs.filter((l) => inRange(l.date, r))
  const journalIn = (r: WeekRange) => input.journal.filter((j) => inRange(j.date, r))

  const moodAvg = (r: WeekRange) => {
    const entries = journalIn(r)
    return entries.length ? entries.reduce((s, e) => s + e.mood, 0) / entries.length : 0
  }

  const thisWeight = trendWeightAt(input.weights, range)
  const lastWeight = trendWeightAt(input.weights, previous)

  const metrics: Metric[] = [
    {
      label: 'Tasks completed',
      value: completedIn(range).length,
      previous: completedIn(previous).length,
      better: 'higher',
      format: 'number',
    },
    {
      label: 'Workouts',
      value: workoutsIn(range).length,
      previous: workoutsIn(previous).length,
      better: 'higher',
      format: 'number',
    },
    {
      label: 'Training volume',
      value: Math.round(volumeIn(input.workouts, input.sets, range)),
      previous: Math.round(volumeIn(input.workouts, input.sets, previous)),
      better: 'higher',
      format: 'weight',
    },
    {
      label: 'Spending',
      value: spendIn(input.transactions, range),
      previous: spendIn(input.transactions, previous),
      better: 'lower',
      format: 'currency',
    },
    {
      label: 'Habit check-ins',
      value: habitLogsIn(range).length,
      previous: habitLogsIn(previous).length,
      better: 'higher',
      format: 'number',
    },
    {
      label: 'Average mood',
      value: Number(moodAvg(range).toFixed(1)),
      previous: Number(moodAvg(previous).toFixed(1)),
      better: 'higher',
      format: 'number',
    },
  ]

  const categoryTotals = new Map<string, number>()
  for (const t of input.transactions) {
    if (!inRange(t.date, range) || t.amount >= 0 || NON_SPEND_CATEGORIES.has(t.category))
      continue
    categoryTotals.set(
      t.category,
      (categoryTotals.get(t.category) ?? 0) + Math.abs(t.amount),
    )
  }

  const logs = habitLogsIn(range)
  const habitSummary = input.habits
    .filter((h) => !h.archived)
    .map((habit) => ({
      name: habit.name,
      done: logs.filter((l) => l.habit_id === habit.id).length,
      target: habit.target_per_week,
    }))

  return {
    range,
    previous,
    metrics,
    topCategories: [...categoryTotals.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5),
    completedTasks: completedIn(range),
    workouts: workoutsIn(range),
    habitSummary,
    journalEntries: journalIn(range),
    weightChangeKg:
      thisWeight !== null && lastWeight !== null
        ? Number((thisWeight - lastWeight).toFixed(2))
        : null,
    headline: headlineFor({
      metrics,
      habitSummary,
      weightChangeKg:
        thisWeight !== null && lastWeight !== null ? thisWeight - lastWeight : null,
    }),
  }
}

/**
 * One sentence summarising the week. Picks the single most notable thing
 * rather than listing everything — the metrics below already do that.
 */
function headlineFor({
  metrics,
  habitSummary,
  weightChangeKg,
}: {
  metrics: Metric[]
  habitSummary: Array<{ name: string; done: number; target: number }>
  weightChangeKg: number | null
}): string {
  const by = (label: string) => metrics.find((m) => m.label === label)!

  const workouts = by('Workouts')
  const spending = by('Spending')
  const tasks = by('Tasks completed')

  const nothingHappened = metrics.every((m) => m.value === 0)
  if (nothingHappened) return 'A quiet week — nothing logged.'

  if (workouts.value > 0 && workouts.value > workouts.previous) {
    return `Training picked up: ${workouts.value} sessions, up from ${workouts.previous}.`
  }

  if (spending.previous > 0 && spending.value > spending.previous * 1.35) {
    return 'Spending ran well above last week — worth a look at the categories below.'
  }

  const hitTargets = habitSummary.filter((h) => h.done >= h.target).length
  if (habitSummary.length > 0 && hitTargets === habitSummary.length) {
    return 'Every habit target met this week.'
  }

  if (tasks.value > tasks.previous && tasks.value > 0) {
    return `Cleared ${tasks.value} tasks, more than last week.`
  }

  if (weightChangeKg !== null && Math.abs(weightChangeKg) >= 0.3) {
    return weightChangeKg < 0
      ? 'Weight trend moved down this week.'
      : 'Weight trend moved up this week.'
  }

  return 'A steady week — no big swings in either direction.'
}
