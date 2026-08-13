import { describe, expect, it } from 'vitest'
import {
  findAnomalies,
  findRecurring,
  linearTrend,
  MIN_R,
  MIN_SAMPLES,
  pearson,
  projectGoal,
  scoreCorrelations,
} from './insights'
import type { Goal, Transaction } from './types'

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g1',
  title: 'Save',
  category: 'Money',
  metric: 'Balance',
  start_value: 0,
  current_value: 50,
  target_value: 100,
  unit: 'USD',
  due_date: null,
  ...over,
})

function series(start: string, values: number[]) {
  const [y, m, d] = start.split('-').map(Number)
  return values.map((value, i) => {
    const date = new Date(y, m - 1, d + i)
    const pad = (n: number) => String(n).padStart(2, '0')
    return {
      date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      value,
    }
  })
}

describe('linearTrend', () => {
  it('recovers the slope of a clean line', () => {
    const trend = linearTrend(series('2026-08-01', [10, 12, 14, 16, 18]))
    expect(trend?.slope).toBeCloseTo(2, 6)
    expect(trend?.r2).toBeCloseTo(1, 6)
  })

  it('reports a negative slope when falling', () => {
    expect(linearTrend(series('2026-08-01', [20, 18, 16, 14]))?.slope).toBeCloseTo(-2, 6)
  })

  it('reports a low fit for noise', () => {
    const trend = linearTrend(series('2026-08-01', [10, 30, 5, 28, 8, 33]))
    expect(trend!.r2).toBeLessThan(0.4)
  })

  it('refuses fewer than three points', () => {
    expect(linearTrend(series('2026-08-01', [1, 2]))).toBeNull()
  })

  it('refuses a flat series with no x-spread', () => {
    expect(
      linearTrend([
        { date: '2026-08-01', value: 1 },
        { date: '2026-08-01', value: 2 },
        { date: '2026-08-01', value: 3 },
      ]),
    ).toBeNull()
  })
})

describe('projectGoal', () => {
  it('says so when the target is already met', () => {
    const result = projectGoal(
      goal({ current_value: 120 }),
      series('2026-08-01', [100, 110, 120]),
    )
    expect(result.status).toBe('achieved')
  })

  it('handles count-down goals reaching their target', () => {
    // Paying off a loan: start high, target zero.
    const result = projectGoal(
      goal({ start_value: 1000, current_value: 0, target_value: 0 }),
      series('2026-08-01', [400, 200, 0]),
    )
    expect(result.status).toBe('achieved')
  })

  it('projects a date when the trend is clean and heading the right way', () => {
    const result = projectGoal(
      goal({ current_value: 50 }),
      series('2026-08-01', [10, 20, 30, 40, 50]),
    )
    expect(result.status).toBe('on-track')
    expect(result.etaDate).not.toBeNull()
    expect(result.daysRemaining).toBe(5)
  })

  it('refuses to guess without enough history', () => {
    const result = projectGoal(goal(), series('2026-08-01', [40, 50]))
    expect(result.status).toBe('insufficient-data')
    expect(result.etaDate).toBeNull()
  })

  it('says stalled rather than printing an absurd date', () => {
    const result = projectGoal(goal(), series('2026-08-01', [50, 50, 50, 50, 50]))
    expect(result.status).toBe('stalled')
    expect(result.etaDate).toBeNull()
  })

  it('flags moving away from the target', () => {
    const result = projectGoal(
      goal({ current_value: 30 }),
      series('2026-08-01', [60, 50, 40, 30]),
    )
    expect(result.status).toBe('wrong-direction')
    expect(result.etaDate).toBeNull()
  })

  it('does not print a date more than a decade out', () => {
    const result = projectGoal(
      goal({ current_value: 1, target_value: 100000 }),
      series('2026-08-01', [0.1, 0.2, 0.3, 0.4, 0.5]),
    )
    expect(result.status).toBe('slow')
    expect(result.etaDate).toBeNull()
  })

  it('marks a goal that will miss its deadline', () => {
    const result = projectGoal(
      goal({ current_value: 50, due_date: '2026-08-06' }),
      series('2026-08-01', [10, 20, 30, 40, 50]),
    )
    expect(result.status).toBe('slow')
    expect(result.etaDate).not.toBeNull()
  })
})

/* ------------------------------------------------------------------ */

const txn = (
  date: string,
  name: string,
  amount: number,
  category = 'Subscriptions',
): Transaction => ({
  id: `${name}-${date}`,
  account_id: null,
  date,
  name,
  merchant: name,
  amount,
  category,
  pending: false,
  plaid_transaction_id: null,
  notes: null,
})

describe('findRecurring', () => {
  const netflix = [
    txn('2026-05-06', 'Netflix', -15.49),
    txn('2026-06-06', 'Netflix', -15.49),
    txn('2026-07-06', 'Netflix', -15.49),
    txn('2026-08-06', 'Netflix', -15.49),
  ]

  it('finds a monthly subscription', () => {
    const [found] = findRecurring(netflix, '2026-08-12')
    expect(found.merchant).toBe('Netflix')
    expect(found.cadence).toBe('monthly')
    expect(found.occurrences).toBe(4)
    expect(found.monthlyCost).toBeCloseTo(15.49, 2)
  })

  it('estimates the next charge date', () => {
    const [found] = findRecurring(netflix, '2026-08-12')
    expect(found.nextEstimated.startsWith('2026-09')).toBe(true)
  })

  it('needs three occurrences — two could be coincidence', () => {
    expect(findRecurring(netflix.slice(0, 2), '2026-08-12')).toEqual([])
  })

  it('ignores irregular spending at the same merchant', () => {
    const groceries = [
      txn('2026-08-01', 'Tesco', -32, 'Groceries'),
      txn('2026-08-03', 'Tesco', -12, 'Groceries'),
      txn('2026-08-04', 'Tesco', -78, 'Groceries'),
      txn('2026-08-09', 'Tesco', -21, 'Groceries'),
    ]
    expect(findRecurring(groceries, '2026-08-12')).toEqual([])
  })

  it('ignores a series whose amounts jump around', () => {
    const erratic = [
      txn('2026-05-06', 'Something', -10),
      txn('2026-06-06', 'Something', -95),
      txn('2026-07-06', 'Something', -12),
      txn('2026-08-06', 'Something', -140),
    ]
    expect(findRecurring(erratic, '2026-08-12')).toEqual([])
  })

  it('spots a price increase', () => {
    const raised = [...netflix.slice(0, 3), txn('2026-08-06', 'Netflix', -18.99)]
    const [found] = findRecurring(raised, '2026-08-12')
    expect(found.priceIncrease).not.toBeNull()
    expect(found.priceIncrease?.to).toBeCloseTo(18.99, 2)
  })

  it('flags a charge that has stopped appearing', () => {
    // Cancelled, or a payment that silently failed — both worth surfacing.
    const [found] = findRecurring(netflix, '2026-10-20')
    expect(found.possiblyEnded).toBe(true)
  })

  it('converts other cadences to a monthly cost', () => {
    const yearly = [
      txn('2024-08-06', 'Domain', -60),
      txn('2025-08-06', 'Domain', -60),
      txn('2026-08-06', 'Domain', -60),
    ]
    const [found] = findRecurring(yearly, '2026-08-12')
    expect(found.cadence).toBe('yearly')
    expect(found.monthlyCost).toBeCloseTo(5, 2)
  })

  it('ignores income and transfers', () => {
    const income = [
      txn('2026-06-01', 'Payroll', 3000, 'Income'),
      txn('2026-07-01', 'Payroll', 3000, 'Income'),
      txn('2026-08-01', 'Payroll', 3000, 'Income'),
    ]
    expect(findRecurring(income, '2026-08-12')).toEqual([])
  })
})

describe('findAnomalies', () => {
  const on = (date: string, amount: number, category: string) =>
    txn(date, 'X', -amount, category)

  it('flags a category running hot against the same stretch of earlier months', () => {
    const rows = [
      on('2026-05-05', 100, 'Dining'),
      on('2026-06-05', 100, 'Dining'),
      on('2026-07-05', 100, 'Dining'),
      on('2026-08-05', 300, 'Dining'),
    ]
    const [anomaly] = findAnomalies(rows, { today: '2026-08-15' })
    expect(anomaly.category).toBe('Dining')
    expect(anomaly.direction).toBe('up')
    expect(anomaly.average).toBe(100)
  })

  it('does not flag fixed bills that simply land early in the month', () => {
    // Rent on the 1st is fully paid by the 13th every month. Scaling prior
    // months by the fraction elapsed would report it as ~138% over, every time.
    const rows = [
      on('2026-05-01', 2150, 'Rent'),
      on('2026-06-01', 2150, 'Rent'),
      on('2026-07-01', 2150, 'Rent'),
      on('2026-08-01', 2150, 'Rent'),
    ]
    expect(findAnomalies(rows, { today: '2026-08-13' })).toEqual([])
  })

  it('ignores spending later in prior months than today, so early days compare fairly', () => {
    // Prior months also spent late; through the 3rd, nothing has happened yet.
    const rows = [
      on('2026-06-20', 200, 'Dining'),
      on('2026-07-20', 200, 'Dining'),
      on('2026-08-02', 20, 'Dining'),
    ]
    expect(findAnomalies(rows, { today: '2026-08-03' })).toEqual([])
  })

  it('flags a category that has gone quiet', () => {
    const rows = [
      on('2026-05-05', 200, 'Dining'),
      on('2026-06-05', 200, 'Dining'),
      on('2026-07-05', 200, 'Dining'),
    ]
    const [anomaly] = findAnomalies(rows, { today: '2026-08-15' })
    expect(anomaly.direction).toBe('down')
    expect(anomaly.thisMonth).toBe(0)
  })

  it('ignores categories too small to matter', () => {
    const rows = [
      on('2026-06-05', 5, 'Coffee'),
      on('2026-07-05', 5, 'Coffee'),
      on('2026-08-05', 20, 'Coffee'),
    ]
    expect(findAnomalies(rows, { today: '2026-08-15' })).toEqual([])
  })

  it('returns nothing without prior months to compare against', () => {
    expect(
      findAnomalies([on('2026-08-05', 500, 'Dining')], { today: '2026-08-15' }),
    ).toEqual([])
  })
})

/* ------------------------------------------------------------------ */

describe('pearson', () => {
  it('is 1 for a perfect positive relationship', () => {
    expect(
      pearson([
        [1, 2],
        [2, 4],
        [3, 6],
        [4, 8],
      ]),
    ).toBeCloseTo(1, 6)
  })

  it('is -1 for a perfect inverse relationship', () => {
    expect(
      pearson([
        [1, 8],
        [2, 6],
        [3, 4],
        [4, 2],
      ]),
    ).toBeCloseTo(-1, 6)
  })

  it('is null when one side never varies', () => {
    expect(
      pearson([
        [1, 5],
        [2, 5],
        [3, 5],
      ]),
    ).toBeNull()
  })

  it('is null below three pairs', () => {
    expect(
      pearson([
        [1, 2],
        [2, 4],
      ]),
    ).toBeNull()
  })
})

describe('scoreCorrelations', () => {
  const pairs = (n: number, f: (i: number) => [number, number]) =>
    Array.from({ length: n }, (_, i) => f(i))

  const input = (over = {}) => ({
    id: 'sleep-mood',
    label: 'Sleep and mood',
    positive: 'More sleep goes with better mood.',
    negative: 'More sleep goes with worse mood.',
    pairs: pairs(30, (i) => [i, i * 2]),
    ...over,
  })

  it('keeps a strong relationship with enough samples', () => {
    const [result] = scoreCorrelations([input()])
    expect(result.strength).toBe('strong')
    expect(result.direction).toBe('positive')
    expect(result.sentence).toContain('better mood')
  })

  it('hides anything under the sample floor', () => {
    // Fewer than MIN_SAMPLES is not evidence, however strong it looks.
    expect(
      scoreCorrelations([input({ pairs: pairs(MIN_SAMPLES - 1, (i) => [i, i * 2]) })]),
    ).toEqual([])
  })

  it('hides weak relationships rather than showing them with a caveat', () => {
    const noisy = pairs(40, (i) => [i, (i % 7) * 3 - (i % 3)])
    const results = scoreCorrelations([input({ pairs: noisy })])
    for (const result of results) expect(Math.abs(result.r)).toBeGreaterThanOrEqual(MIN_R)
  })

  it('uses the negative phrasing for an inverse relationship', () => {
    const [result] = scoreCorrelations([input({ pairs: pairs(30, (i) => [i, -i * 2]) })])
    expect(result.direction).toBe('negative')
    expect(result.sentence).toContain('worse mood')
  })

  it('ranks the strongest relationship first', () => {
    const results = scoreCorrelations([
      input({ id: 'weak', pairs: pairs(30, (i) => [i, i * 2 + (i % 5) * 9]) }),
      input({ id: 'strong', pairs: pairs(30, (i) => [i, i * 2]) }),
    ])
    expect(results[0].id).toBe('strong')
  })
})
