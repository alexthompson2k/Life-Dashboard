import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Link2,
  Repeat,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useTable } from '../lib/store'
import { useSettings } from '../lib/settings'
import { Callout, Card, EmptyState, ProgressBar } from '../components/ui'
import { CategoryBars } from '../components/charts'
import { buildReview, shiftWeek, weekRange, type Metric } from '../lib/review'
import {
  findAnomalies,
  findRecurring,
  MIN_R,
  MIN_SAMPLES,
  scoreCorrelations,
  type CorrelationInput,
} from '../lib/insights'
import { currency, fromISODate, kgToDisplay, weightUnit } from '../lib/format'

export default function Review() {
  const { settings } = useSettings()
  const tasks = useTable('tasks')
  const transactions = useTable('transactions')
  const workouts = useTable('workouts')
  const sets = useTable('workout_sets')
  const weights = useTable('weights')
  const habits = useTable('habits')
  const habitLogs = useTable('habit_logs')
  const journal = useTable('journal')

  const [offset, setOffset] = useState(0)
  const units = settings.unit_system
  const code = settings.currency

  const range = useMemo(() => shiftWeek(weekRange(), offset), [offset])

  const review = useMemo(
    () =>
      buildReview({
        date: range.start,
        tasks: tasks.rows,
        transactions: transactions.rows,
        workouts: workouts.rows,
        sets: sets.rows,
        weights: weights.rows,
        habits: habits.rows,
        habitLogs: habitLogs.rows,
        journal: journal.rows,
      }),
    [
      range.start,
      tasks.rows,
      transactions.rows,
      workouts.rows,
      sets.rows,
      weights.rows,
      habits.rows,
      habitLogs.rows,
      journal.rows,
    ],
  )

  const recurring = useMemo(() => findRecurring(transactions.rows), [transactions.rows])
  const anomalies = useMemo(() => findAnomalies(transactions.rows), [transactions.rows])
  const correlations = useMemo(
    () =>
      scoreCorrelations(
        buildCorrelationInputs({
          journal: journal.rows,
          workouts: workouts.rows,
          habitLogs: habitLogs.rows,
          transactions: transactions.rows,
        }),
      ),
    [journal.rows, workouts.rows, habitLogs.rows, transactions.rows],
  )

  const monthlySubscriptions = recurring
    .filter((r) => !r.possiblyEnded)
    .reduce((sum, r) => sum + r.monthlyCost, 0)

  const formatMetric = (metric: Metric, value: number) => {
    switch (metric.format) {
      case 'currency':
        return currency(value, code)
      case 'weight':
        return `${Math.round(kgToDisplay(value, units)).toLocaleString()} ${weightUnit(units)}`
      case 'percent':
        return `${value.toFixed(0)}%`
      default:
        return value.toLocaleString()
    }
  }

  const isCurrentWeek = offset === 0
  const weekLabel = `${fromISODate(range.start).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })} – ${fromISODate(range.end).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })}`

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Weekly review</h1>
          <p className="text-xs text-ink-secondary">
            {isCurrentWeek ? 'This week' : weekLabel} · compared with the week before
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="btn btn-ghost !p-1.5"
            onClick={() => setOffset((o) => o - 1)}
            aria-label="Previous week"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            className="btn btn-ghost !px-2 !py-1 text-xs"
            onClick={() => setOffset(0)}
            disabled={isCurrentWeek}
          >
            This week
          </button>
          <button
            className="btn btn-ghost !p-1.5"
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
            aria-label="Next week"
            disabled={isCurrentWeek}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      <Card>
        <p className="text-sm text-ink-primary">{review.headline}</p>
        {review.weightChangeKg !== null && Math.abs(review.weightChangeKg) >= 0.05 && (
          <p className="mt-1 text-xs text-ink-secondary">
            Weight trend {review.weightChangeKg < 0 ? 'down' : 'up'}{' '}
            {Math.abs(kgToDisplay(review.weightChangeKg, units)).toFixed(2)}{' '}
            {weightUnit(units)} over the week.
          </p>
        )}
      </Card>

      {/* Week-over-week deltas */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {review.metrics.map((metric) => {
          const delta = metric.value - metric.previous
          const improved =
            metric.better === 'neutral'
              ? null
              : metric.better === 'higher'
                ? delta > 0
                : delta < 0
          const color =
            delta === 0 || improved === null
              ? 'var(--text-secondary)'
              : improved
                ? 'var(--status-good)'
                : 'var(--status-critical)'

          return (
            <div key={metric.label} className="card p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-secondary">
                {metric.label}
              </p>
              <p className="tnum mt-2 text-2xl font-semibold text-ink-primary">
                {formatMetric(metric, metric.value)}
              </p>
              <p className="tnum mt-1 flex items-center gap-1 text-xs" style={{ color }}>
                {delta !== 0 &&
                  (delta > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />)}
                {delta === 0
                  ? 'Same as last week'
                  : `${delta > 0 ? '+' : '−'}${formatMetric(metric, Math.abs(delta))} vs last week`}
              </p>
            </div>
          )
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {review.topCategories.length > 0 ? (
          <CategoryBars
            title="Where the week went"
            subtitle="Spending by category, transfers excluded"
            rows={review.topCategories.map((c) => ({ label: c.category, value: c.amount }))}
            format={(v) => currency(v, code)}
          />
        ) : (
          <Card title="Where the week went">
            <EmptyState title="No spending recorded this week" />
          </Card>
        )}

        <Card title="Habits" subtitle="Against your weekly targets">
          {review.habitSummary.length === 0 ? (
            <EmptyState title="No habits tracked" />
          ) : (
            <div className="space-y-3">
              {review.habitSummary.map((habit) => (
                <div key={habit.name}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-ink-primary">{habit.name}</span>
                    <span className="tnum text-ink-secondary">
                      {habit.done}/{habit.target}
                    </span>
                  </div>
                  <ProgressBar
                    value={habit.done}
                    max={habit.target}
                    state={habit.done >= habit.target ? 'good' : 'accent'}
                  />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Spending anomalies */}
      {anomalies.length > 0 && (
        <Card
          title="Running hot"
          subtitle="Spending so far this month against the same stretch of previous months"
        >
          <ul className="space-y-2.5">
            {anomalies.slice(0, 5).map((anomaly) => (
              <li
                key={anomaly.category}
                className="flex items-center justify-between gap-3"
              >
                <span className="flex items-center gap-2 text-sm text-ink-primary">
                  <AlertTriangle
                    size={13}
                    style={{
                      color:
                        anomaly.direction === 'up'
                          ? 'var(--status-warning)'
                          : 'var(--status-good)',
                    }}
                  />
                  {anomaly.category}
                </span>
                <span className="tnum text-xs text-ink-secondary">
                  {currency(anomaly.thisMonth, code)} vs {currency(anomaly.average, code)}{' '}
                  usual ·{' '}
                  <span
                    style={{
                      color:
                        anomaly.direction === 'up'
                          ? 'var(--status-warning)'
                          : 'var(--status-good)',
                    }}
                  >
                    {anomaly.changePct > 0 ? '+' : '−'}
                    {Math.abs(anomaly.changePct).toFixed(0)}%
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Recurring charges */}
      <Card
        title="Recurring charges"
        subtitle={
          recurring.length
            ? `${currency(monthlySubscriptions, code)} a month across ${recurring.filter((r) => !r.possiblyEnded).length} active charges`
            : 'Detected from repeating amounts at the same merchant'
        }
      >
        {recurring.length === 0 ? (
          <EmptyState
            icon={<Repeat size={20} />}
            title="Nothing detected yet"
            description="Three or more charges at a regular interval are needed before something counts as recurring."
          />
        ) : (
          <ul className="divide-y divide-line">
            {recurring.map((item) => (
              <li
                key={item.merchant}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-sm text-ink-primary">
                    {item.merchant}
                    {item.possiblyEnded && (
                      <span className="ml-2 text-[11px] text-ink-muted">
                        not seen since {item.lastDate}
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-ink-secondary">
                    {item.cadence} · {item.occurrences} charges
                    {!item.possiblyEnded && ` · next around ${item.nextEstimated}`}
                    {item.priceIncrease && (
                      <span style={{ color: 'var(--status-warning)' }}>
                        {' '}
                        · went up from {currency(item.priceIncrease.from, code)}
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="tnum text-sm font-medium text-ink-primary">
                    {currency(item.amount, code)}
                  </p>
                  {item.cadence !== 'monthly' && (
                    <p className="tnum text-[11px] text-ink-muted">
                      {currency(item.monthlyCost, code)}/mo
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Cross-domain correlations */}
      <Card
        title="Patterns across your data"
        subtitle="Relationships between things the dashboard tracks separately"
      >
        {correlations.length === 0 ? (
          <EmptyState
            icon={<Link2 size={20} />}
            title="Nothing solid to report"
            description={`Relationships are only shown with at least ${MIN_SAMPLES} days of overlapping data and a correlation of ${MIN_R} or stronger. Keep logging and they will appear.`}
          />
        ) : (
          <div className="space-y-3">
            {correlations.map((c) => (
              <div key={c.id} className="rounded-xl border border-line bg-surface-2 p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm text-ink-primary">{c.sentence}</p>
                  <span className="tnum shrink-0 text-xs text-ink-muted">
                    r = {c.r.toFixed(2)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-ink-muted">
                  {c.strength === 'strong' ? 'Strong' : 'Moderate'} association over {c.n}{' '}
                  days.
                </p>
              </div>
            ))}
            <Callout intent="info">
              These are associations, not causes. Two things moving together can share a
              third explanation, or be coincidence — treat them as a prompt to look closer,
              not a conclusion.
            </Callout>
          </div>
        )}
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Builds the candidate relationships worth testing.
 *
 * Everything is aligned by day so the pairs actually correspond. Only pairs
 * where both sides have a value that day are included — filling gaps with
 * zeroes would invent a relationship out of missing data.
 */
function buildCorrelationInputs({
  journal,
  workouts,
  habitLogs,
  transactions,
}: {
  journal: ReturnType<typeof useTable<'journal'>>['rows']
  workouts: ReturnType<typeof useTable<'workouts'>>['rows']
  habitLogs: ReturnType<typeof useTable<'habit_logs'>>['rows']
  transactions: ReturnType<typeof useTable<'transactions'>>['rows']
}): CorrelationInput[] {
  const moodByDate = new Map(journal.map((j) => [j.date, j.mood]))
  const energyByDate = new Map(journal.map((j) => [j.date, j.energy]))

  const workoutDates = new Set(workouts.map((w) => w.date))

  const habitCountByDate = new Map<string, number>()
  for (const log of habitLogs) {
    habitCountByDate.set(log.date, (habitCountByDate.get(log.date) ?? 0) + 1)
  }

  const spendByDate = new Map<string, number>()
  for (const t of transactions) {
    if (t.amount >= 0 || t.category === 'Transfer') continue
    spendByDate.set(t.date, (spendByDate.get(t.date) ?? 0) + Math.abs(t.amount))
  }

  const journalDates = [...moodByDate.keys()].sort()

  const pairsFrom = (
    pick: (date: string) => number | null,
    target: Map<string, number>,
  ) => {
    const pairs: Array<[number, number]> = []
    for (const date of journalDates) {
      const x = pick(date)
      const y = target.get(date)
      if (x === null || y === undefined) continue
      pairs.push([x, y])
    }
    return pairs
  }

  // Only days that were actually journalled count; a missing entry is unknown,
  // not zero.
  const trainingDays = (date: string) => (workoutDates.has(date) ? 1 : 0)

  return [
    {
      id: 'habits-mood',
      label: 'Habits and mood',
      positive: 'Days you check off more habits tend to be better days.',
      negative: 'Days you check off more habits tend to score lower on mood.',
      pairs: pairsFrom((d) => habitCountByDate.get(d) ?? 0, moodByDate),
    },
    {
      id: 'training-mood',
      label: 'Training and mood',
      positive: 'Training days tend to come with a better mood.',
      negative: 'Training days tend to come with a lower mood.',
      pairs: pairsFrom(trainingDays, moodByDate),
    },
    {
      id: 'training-energy',
      label: 'Training and energy',
      positive: 'Training days tend to come with higher energy.',
      negative: 'Training days tend to come with lower energy.',
      pairs: pairsFrom(trainingDays, energyByDate),
    },
    {
      id: 'spend-mood',
      label: 'Spending and mood',
      positive: 'Higher-spending days tend to score higher on mood.',
      negative: 'Higher-spending days tend to score lower on mood.',
      pairs: pairsFrom((d) => spendByDate.get(d) ?? null, moodByDate),
    },
    {
      id: 'mood-energy',
      label: 'Mood and energy',
      positive: 'Mood and energy move together.',
      negative: 'Mood and energy move in opposite directions.',
      pairs: pairsFrom((d) => moodByDate.get(d) ?? null, energyByDate),
    },
  ]
}
