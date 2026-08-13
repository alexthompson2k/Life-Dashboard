import { fromISODate, monthKey, toISODate } from './format'
import { NON_SPEND_CATEGORIES } from './finance'
import type { Goal, Transaction } from './types'

/**
 * The analysis layer.
 *
 * This is the part a unified dashboard can do that five separate apps cannot:
 * project a trend forward, notice a recurring charge, and look across domains
 * for a relationship. Everything here is deliberately conservative — a
 * confident-sounding wrong answer about your money or your health is worse
 * than no answer, so each function has an explicit "not enough to say" path.
 */

/* ------------------------------------------------------------------ */
/* Trend projection                                                    */
/* ------------------------------------------------------------------ */

export interface Trend {
  /** Units per day. */
  slope: number
  intercept: number
  /** Coefficient of determination: how well the line actually fits. */
  r2: number
  points: number
}

/** Ordinary least squares over (day offset, value). */
export function linearTrend(series: Array<{ date: string; value: number }>): Trend | null {
  if (series.length < 3) return null

  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date))
  const origin = fromISODate(sorted[0].date).getTime()
  const xs = sorted.map((p) => (fromISODate(p.date).getTime() - origin) / 86_400_000)
  const ys = sorted.map((p) => p.value)

  const n = xs.length
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n

  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY)
    den += (xs[i] - meanX) ** 2
  }
  if (den === 0) return null

  const slope = num / den
  const intercept = meanY - slope * meanX

  let ssRes = 0
  let ssTot = 0
  for (let i = 0; i < n; i++) {
    const predicted = intercept + slope * xs[i]
    ssRes += (ys[i] - predicted) ** 2
    ssTot += (ys[i] - meanY) ** 2
  }

  return {
    slope,
    intercept,
    r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot,
    points: n,
  }
}

export type ProjectionStatus =
  'achieved' | 'on-track' | 'slow' | 'wrong-direction' | 'stalled' | 'insufficient-data'

export interface Projection {
  status: ProjectionStatus
  /** ISO date the target is reached, when that is a meaningful answer. */
  etaDate: string | null
  daysRemaining: number | null
  /** Change per day, in the goal's own units. */
  perDay: number
  /** How much of the variance the trend explains — low means noisy. */
  confidence: number
  message: string
}

/**
 * Projects when a goal will be met. Refuses to answer when the trend is flat,
 * pointing the wrong way, or too noisy to mean anything — printing "March 2031"
 * from three scattered points would be worse than saying nothing.
 */
export function projectGoal(
  goal: Goal,
  history: Array<{ date: string; value: number }>,
): Projection {
  const direction = Math.sign(goal.target_value - goal.start_value)
  const reached =
    direction >= 0
      ? goal.current_value >= goal.target_value
      : goal.current_value <= goal.target_value

  if (reached) {
    return {
      status: 'achieved',
      etaDate: null,
      daysRemaining: null,
      perDay: 0,
      confidence: 1,
      message: 'Target reached.',
    }
  }

  const trend = linearTrend(history)
  if (!trend || trend.points < 4) {
    return {
      status: 'insufficient-data',
      etaDate: null,
      daysRemaining: null,
      perDay: 0,
      confidence: 0,
      message: 'Not enough history yet to project a date.',
    }
  }

  const remaining = goal.target_value - goal.current_value
  const perDay = trend.slope

  // Effectively flat: any ETA derived from this would be noise.
  if (Math.abs(perDay) < 1e-9) {
    return {
      status: 'stalled',
      etaDate: null,
      daysRemaining: null,
      perDay,
      confidence: trend.r2,
      message: 'Flat over this period — no progress to project from.',
    }
  }

  if (Math.sign(perDay) !== Math.sign(remaining)) {
    return {
      status: 'wrong-direction',
      etaDate: null,
      daysRemaining: null,
      perDay,
      confidence: trend.r2,
      message: 'Moving away from this target at the current rate.',
    }
  }

  const days = Math.ceil(remaining / perDay)

  // Beyond a decade the arithmetic is technically right and practically absurd.
  if (days > 3650) {
    return {
      status: 'slow',
      etaDate: null,
      daysRemaining: days,
      perDay,
      confidence: trend.r2,
      message: 'On track, but more than ten years away at this rate.',
    }
  }

  const eta = new Date()
  eta.setDate(eta.getDate() + days)
  const etaDate = toISODate(eta)

  const beatsDeadline = !goal.due_date || etaDate <= goal.due_date

  return {
    status: beatsDeadline ? 'on-track' : 'slow',
    etaDate,
    daysRemaining: days,
    perDay,
    confidence: trend.r2,
    message: beatsDeadline
      ? `On track to finish around ${etaDate}.`
      : `At this rate you finish around ${etaDate}, after the deadline.`,
  }
}

/* ------------------------------------------------------------------ */
/* Recurring charges                                                   */
/* ------------------------------------------------------------------ */

export interface Recurring {
  merchant: string
  category: string
  /** Most recent amount, as a positive number. */
  amount: number
  /** Typical gap in days between charges. */
  cadenceDays: number
  cadence: 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  occurrences: number
  lastDate: string
  nextEstimated: string
  monthlyCost: number
  /** Set when the latest charge is meaningfully above the earlier ones. */
  priceIncrease: { from: number; to: number } | null
  /** True when it is overdue by more than half a cycle — cancelled, maybe. */
  possiblyEnded: boolean
}

function normalizeMerchant(name: string) {
  return name
    .toLowerCase()
    .replace(/[0-9]{3,}/g, '') // order/store numbers
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const CADENCE_BANDS: Array<{ cadence: Recurring['cadence']; min: number; max: number }> = [
  { cadence: 'weekly', min: 6, max: 8 },
  { cadence: 'monthly', min: 26, max: 35 },
  { cadence: 'quarterly', min: 85, max: 96 },
  { cadence: 'yearly', min: 350, max: 380 },
]

const MONTHLY_FACTOR: Record<Recurring['cadence'], number> = {
  weekly: 52 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
}

/**
 * Finds charges that repeat on a regular cadence at a consistent amount.
 *
 * Requires at least three occurrences: two could be coincidence, and a
 * subscriptions list padded with coincidences is one nobody trusts.
 */
export function findRecurring(
  transactions: Transaction[],
  today = toISODate(),
): Recurring[] {
  const groups = new Map<string, Transaction[]>()

  for (const txn of transactions) {
    if (txn.amount >= 0 || NON_SPEND_CATEGORIES.has(txn.category)) continue
    const key = normalizeMerchant(txn.merchant ?? txn.name)
    if (!key) continue
    const list = groups.get(key) ?? []
    list.push(txn)
    groups.set(key, list)
  }

  const found: Recurring[] = []

  for (const [, rows] of groups) {
    if (rows.length < 3) continue

    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
    const gaps: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(
        (fromISODate(sorted[i].date).getTime() -
          fromISODate(sorted[i - 1].date).getTime()) /
          86_400_000,
      )
    }

    const medianGap = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
    const band = CADENCE_BANDS.find((b) => medianGap >= b.min && medianGap <= b.max)
    if (!band) continue

    // Most gaps should match the cadence, not just the median.
    const consistent = gaps.filter((g) => g >= band.min && g <= band.max).length
    if (consistent / gaps.length < 0.6) continue

    const amounts = sorted.map((t) => Math.abs(t.amount))
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length
    const withinTolerance = amounts.filter((a) => Math.abs(a - mean) / mean <= 0.15).length
    if (withinTolerance / amounts.length < 0.7) continue

    const latest = sorted[sorted.length - 1]
    const latestAmount = Math.abs(latest.amount)
    const earlier = amounts.slice(0, -1)
    const earlierMean = earlier.reduce((a, b) => a + b, 0) / earlier.length

    const nextDate = fromISODate(latest.date)
    nextDate.setDate(nextDate.getDate() + Math.round(medianGap))

    const daysSinceLast =
      (fromISODate(today).getTime() - fromISODate(latest.date).getTime()) / 86_400_000

    found.push({
      merchant: latest.merchant ?? latest.name,
      category: latest.category,
      amount: latestAmount,
      cadenceDays: Math.round(medianGap),
      cadence: band.cadence,
      occurrences: sorted.length,
      lastDate: latest.date,
      nextEstimated: toISODate(nextDate),
      monthlyCost: latestAmount * MONTHLY_FACTOR[band.cadence],
      priceIncrease:
        latestAmount > earlierMean * 1.1
          ? { from: Number(earlierMean.toFixed(2)), to: latestAmount }
          : null,
      possiblyEnded: daysSinceLast > medianGap * 1.5,
    })
  }

  return found.sort((a, b) => b.monthlyCost - a.monthlyCost)
}

/* ------------------------------------------------------------------ */
/* Spending anomalies                                                  */
/* ------------------------------------------------------------------ */

export interface Anomaly {
  category: string
  thisMonth: number
  average: number
  changePct: number
  direction: 'up' | 'down'
}

/**
 * Compares this month against the same stretch of earlier months.
 *
 * The obvious approach — scale each prior month by the fraction elapsed —
 * assumes spending is spread evenly through the month. It is not: rent and
 * subscriptions land on day one, so on the 13th every fixed bill looks 138%
 * over budget and the panel cries wolf every month. Comparing "spend through
 * day 13" against "spend through day 13 of prior months" needs no assumption
 * about how spending is distributed.
 */
export function findAnomalies(
  transactions: Transaction[],
  { today = toISODate(), months = 3, threshold = 40 } = {},
): Anomaly[] {
  const currentKey = monthKey(today)
  const dayOfMonth = fromISODate(today).getDate()

  // Spend per category, per month, counting only days up to today's day number.
  const byMonth = new Map<string, Map<string, number>>()
  const monthsSeen = new Set<string>()

  for (const txn of transactions) {
    if (txn.amount >= 0 || NON_SPEND_CATEGORIES.has(txn.category)) continue
    const key = monthKey(txn.date)
    monthsSeen.add(key)
    if (fromISODate(txn.date).getDate() > dayOfMonth) continue

    const categories = byMonth.get(key) ?? new Map<string, number>()
    categories.set(txn.category, (categories.get(txn.category) ?? 0) + Math.abs(txn.amount))
    byMonth.set(key, categories)
  }

  const priorKeys = [...monthsSeen]
    .filter((k) => k < currentKey)
    .sort()
    .slice(-months)
  if (priorKeys.length === 0) return []

  const current = byMonth.get(currentKey) ?? new Map<string, number>()
  const anomalies: Anomaly[] = []

  const categories = new Set<string>()
  for (const key of priorKeys) {
    for (const c of byMonth.get(key)?.keys() ?? []) categories.add(c)
  }
  for (const c of current.keys()) categories.add(c)

  for (const category of categories) {
    const history = priorKeys.map((k) => byMonth.get(k)?.get(category) ?? 0)
    const average = history.reduce((a, b) => a + b, 0) / history.length

    // Ignore trivial categories: +200% on a £3 habit is not news.
    if (average < 25) continue

    const spent = current.get(category) ?? 0
    const changePct = ((spent - average) / average) * 100
    if (Math.abs(changePct) < threshold) continue

    anomalies.push({
      category,
      thisMonth: spent,
      average,
      changePct,
      direction: changePct > 0 ? 'up' : 'down',
    })
  }

  return anomalies.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
}

/* ------------------------------------------------------------------ */
/* Correlations                                                        */
/* ------------------------------------------------------------------ */

export interface Correlation {
  id: string
  label: string
  r: number
  n: number
  strength: 'strong' | 'moderate'
  direction: 'positive' | 'negative'
  sentence: string
}

/** Pearson's r over paired samples. */
export function pearson(pairs: Array<[number, number]>): number | null {
  const n = pairs.length
  if (n < 3) return null

  const meanX = pairs.reduce((s, p) => s + p[0], 0) / n
  const meanY = pairs.reduce((s, p) => s + p[1], 0) / n

  let num = 0
  let denX = 0
  let denY = 0
  for (const [x, y] of pairs) {
    num += (x - meanX) * (y - meanY)
    denX += (x - meanX) ** 2
    denY += (y - meanY) ** 2
  }

  if (denX === 0 || denY === 0) return null
  return num / Math.sqrt(denX * denY)
}

/** Below these the result is noise dressed up as insight. */
export const MIN_SAMPLES = 20
export const MIN_R = 0.3

export interface CorrelationInput {
  id: string
  label: string
  /** Reads as: "<label> tends to go with <positive|negative>". */
  positive: string
  negative: string
  pairs: Array<[number, number]>
}

/**
 * Scores candidate relationships, keeping only those with enough samples and
 * enough strength to be worth showing. Everything else is hidden rather than
 * displayed with a caveat — a wall of weak correlations is how a dashboard
 * turns into astrology.
 */
export function scoreCorrelations(inputs: CorrelationInput[]): Correlation[] {
  const results: Correlation[] = []

  for (const input of inputs) {
    if (input.pairs.length < MIN_SAMPLES) continue
    const r = pearson(input.pairs)
    if (r === null || Number.isNaN(r)) continue
    if (Math.abs(r) < MIN_R) continue

    const direction = r > 0 ? 'positive' : 'negative'
    results.push({
      id: input.id,
      label: input.label,
      r,
      n: input.pairs.length,
      strength: Math.abs(r) >= 0.6 ? 'strong' : 'moderate',
      direction,
      sentence: direction === 'positive' ? input.positive : input.negative,
    })
  }

  return results.sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
}
