import { describe, expect, it } from 'vitest'
import {
  budgetStatuses,
  categoryTotals,
  incomeOf,
  isLiability,
  monthlySummaries,
  netWorth,
  netWorthSeries,
  runwayMonths,
  spendOf,
  totalAssets,
  totalLiabilities,
} from './finance'
import type { Account, Budget, Transaction } from './types'

function account(
  over: Partial<Account> & Pick<Account, 'id' | 'type' | 'balance'>,
): Account {
  return {
    name: over.id,
    institution: null,
    currency: 'USD',
    plaid_account_id: null,
    plaid_item_id: null,
    is_manual: true,
    updated_at: '2026-08-12T00:00:00.000Z',
    ...over,
  }
}

function txn(
  over: Partial<Transaction> & Pick<Transaction, 'id' | 'date' | 'amount' | 'category'>,
): Transaction {
  return {
    account_id: null,
    name: over.id,
    merchant: null,
    pending: false,
    plaid_transaction_id: null,
    notes: null,
    ...over,
  }
}

describe('net worth', () => {
  const accounts = [
    account({ id: 'checking', type: 'checking', balance: 5000 }),
    account({ id: 'brokerage', type: 'investment', balance: 20000 }),
    account({ id: 'card', type: 'credit', balance: 1500 }),
    account({ id: 'loan', type: 'loan', balance: 8000 }),
  ]

  it('subtracts liabilities rather than adding them', () => {
    // Liability balances are stored as a positive "amount owed".
    expect(netWorth(accounts)).toBe(5000 + 20000 - 1500 - 8000)
  })

  it('classifies credit and loan as liabilities, everything else as assets', () => {
    expect(accounts.filter(isLiability).map((a) => a.id)).toEqual(['card', 'loan'])
    expect(totalAssets(accounts)).toBe(25000)
    expect(totalLiabilities(accounts)).toBe(9500)
  })

  it('reports negative net worth when debt exceeds assets', () => {
    expect(
      netWorth([
        account({ id: 'checking', type: 'checking', balance: 100 }),
        account({ id: 'loan', type: 'loan', balance: 900 }),
      ]),
    ).toBe(-800)
  })

  it('is zero for no accounts', () => {
    expect(netWorth([])).toBe(0)
  })
})

describe('spend and income', () => {
  const rows = [
    txn({ id: 'salary', date: '2026-08-01', amount: 3000, category: 'Income' }),
    txn({ id: 'groceries', date: '2026-08-02', amount: -120, category: 'Groceries' }),
    txn({ id: 'rent', date: '2026-08-03', amount: -2000, category: 'Rent' }),
    txn({ id: 'to-savings', date: '2026-08-04', amount: -500, category: 'Transfer' }),
    txn({ id: 'from-savings', date: '2026-08-05', amount: 500, category: 'Transfer' }),
  ]

  it('excludes transfers from spending — moving money is not consuming it', () => {
    expect(spendOf(rows)).toBe(2120)
  })

  it('excludes transfers from income', () => {
    expect(incomeOf(rows)).toBe(3000)
  })

  it('ignores inflows when totalling spend', () => {
    expect(
      spendOf([
        txn({ id: 'refund', date: '2026-08-01', amount: 50, category: 'Shopping' }),
      ]),
    ).toBe(0)
  })
})

describe('monthlySummaries', () => {
  const rows = [
    txn({ id: 'jul-in', date: '2026-07-01', amount: 4000, category: 'Income' }),
    txn({ id: 'jul-out', date: '2026-07-15', amount: -1000, category: 'Groceries' }),
    txn({ id: 'aug-in', date: '2026-08-01', amount: 4000, category: 'Income' }),
    txn({ id: 'aug-out', date: '2026-08-10', amount: -3000, category: 'Groceries' }),
  ]

  it('summarises per month with a savings rate', () => {
    const [july, august] = monthlySummaries(rows, 6)
    expect(july.key).toBe('2026-07')
    expect(july.net).toBe(3000)
    expect(july.savingsRate).toBe(75)
    expect(august.net).toBe(1000)
    expect(august.savingsRate).toBe(25)
  })

  it('keeps only the most recent N months', () => {
    expect(monthlySummaries(rows, 1).map((m) => m.key)).toEqual(['2026-08'])
  })

  it('reports a zero savings rate rather than dividing by zero income', () => {
    const [only] = monthlySummaries(
      [txn({ id: 'spend', date: '2026-08-01', amount: -50, category: 'Dining' })],
      6,
    )
    expect(only.savingsRate).toBe(0)
  })
})

describe('categoryTotals', () => {
  it('folds the tail into "Other" so colours never run past the palette', () => {
    // The chart palette has 8 categorical slots and must never cycle.
    const rows = Array.from({ length: 12 }, (_, i) =>
      txn({ id: `t${i}`, date: '2026-08-01', amount: -(100 - i), category: `Cat${i}` }),
    )
    const totals = categoryTotals(rows, 7)

    expect(totals).toHaveLength(8)
    expect(totals[totals.length - 1].category).toBe('Other')
    // Nothing is lost in the fold.
    expect(totals.reduce((s, r) => s + r.amount, 0)).toBe(
      rows.reduce((s, r) => s + Math.abs(r.amount), 0),
    )
  })

  it('does not add an "Other" bucket when everything already fits', () => {
    const totals = categoryTotals(
      [
        txn({ id: 'a', date: '2026-08-01', amount: -10, category: 'Dining' }),
        txn({ id: 'b', date: '2026-08-01', amount: -20, category: 'Groceries' }),
      ],
      7,
    )
    expect(totals.map((t) => t.category)).toEqual(['Groceries', 'Dining'])
  })

  it('sorts descending and reports shares that total 100%', () => {
    const totals = categoryTotals([
      txn({ id: 'a', date: '2026-08-01', amount: -75, category: 'Rent' }),
      txn({ id: 'b', date: '2026-08-01', amount: -25, category: 'Dining' }),
    ])
    expect(totals[0].category).toBe('Rent')
    expect(totals[0].share).toBeCloseTo(75)
    expect(totals.reduce((s, t) => s + t.share, 0)).toBeCloseTo(100)
  })

  it('excludes transfers and income from the breakdown', () => {
    expect(
      categoryTotals([
        txn({ id: 'a', date: '2026-08-01', amount: -500, category: 'Transfer' }),
        txn({ id: 'b', date: '2026-08-01', amount: 3000, category: 'Income' }),
      ]),
    ).toEqual([])
  })
})

describe('budgetStatuses', () => {
  const budgets: Budget[] = [{ id: 'b1', category: 'Dining', monthly_limit: 100 }]
  const spend = (amount: number) => [
    txn({ id: 't', date: '2026-08-01', amount: -amount, category: 'Dining' }),
  ]

  it('is good below 80% used', () => {
    const [status] = budgetStatuses(budgets, spend(79))
    expect(status.state).toBe('good')
    expect(status.remaining).toBe(21)
  })

  it('warns from 80% up to the limit', () => {
    expect(budgetStatuses(budgets, spend(80))[0].state).toBe('warning')
    expect(budgetStatuses(budgets, spend(100))[0].state).toBe('warning')
  })

  it('is critical only once the limit is passed', () => {
    const [status] = budgetStatuses(budgets, spend(101))
    expect(status.state).toBe('critical')
    expect(status.remaining).toBe(-1)
  })

  it('ignores spending in other categories', () => {
    const [status] = budgetStatuses(budgets, [
      txn({ id: 't', date: '2026-08-01', amount: -500, category: 'Groceries' }),
    ])
    expect(status.spent).toBe(0)
  })

  it('sorts the most-used budget first', () => {
    const statuses = budgetStatuses(
      [
        { id: 'b1', category: 'Dining', monthly_limit: 100 },
        { id: 'b2', category: 'Groceries', monthly_limit: 100 },
      ],
      [
        txn({ id: 'a', date: '2026-08-01', amount: -10, category: 'Dining' }),
        txn({ id: 'b', date: '2026-08-01', amount: -90, category: 'Groceries' }),
      ],
    )
    expect(statuses[0].category).toBe('Groceries')
  })
})

describe('netWorthSeries', () => {
  it('walks balances backwards so the last point is today’s net worth', () => {
    const accounts = [account({ id: 'checking', type: 'checking', balance: 5000 })]
    const rows = [
      txn({ id: 'jul', date: '2026-07-10', amount: 1000, category: 'Income' }),
      txn({ id: 'aug', date: '2026-08-10', amount: 2000, category: 'Income' }),
    ]
    const series = netWorthSeries(accounts, rows, 6)

    expect(series.map((s) => s.key)).toEqual(['2026-07', '2026-08'])
    expect(series[series.length - 1].value).toBe(5000)
    // August added 2000, so the month before it stood 2000 lower.
    expect(series[0].value).toBe(3000)
  })

  it('ignores transfers, which move money without changing net worth', () => {
    const accounts = [account({ id: 'checking', type: 'checking', balance: 1000 })]
    const series = netWorthSeries(
      accounts,
      [
        txn({ id: 'jul', date: '2026-07-01', amount: 0, category: 'Income' }),
        txn({ id: 'move', date: '2026-08-01', amount: -900, category: 'Transfer' }),
      ],
      6,
    )
    expect(series.every((p) => p.value === 1000)).toBe(true)
  })
})

describe('runwayMonths', () => {
  it('divides liquid savings by recent average spend', () => {
    const accounts = [
      account({ id: 'checking', type: 'checking', balance: 3000 }),
      account({ id: 'savings', type: 'savings', balance: 9000 }),
      // Investments are not liquid and must not count toward runway.
      account({ id: 'brokerage', type: 'investment', balance: 100000 }),
    ]
    const summaries = [
      { key: '2026-06', income: 0, spend: 2000, net: 0, savingsRate: 0 },
      { key: '2026-07', income: 0, spend: 2000, net: 0, savingsRate: 0 },
      { key: '2026-08', income: 0, spend: 2000, net: 0, savingsRate: 0 },
    ]
    expect(runwayMonths(accounts, summaries)).toBe(6)
  })

  it('is zero when there is no spending history to divide by', () => {
    expect(runwayMonths([account({ id: 'c', type: 'checking', balance: 100 })], [])).toBe(0)
  })
})
