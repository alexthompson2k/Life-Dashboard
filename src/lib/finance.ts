import { monthKey, toISODate } from './format'
import type { Account, Budget, Transaction } from './types'

/** Liability accounts count against net worth rather than toward it. */
export const LIABILITY_TYPES = new Set(['credit', 'loan'])

/** Categories that move money without being income or spending. */
export const NON_SPEND_CATEGORIES = new Set(['Income', 'Transfer'])

export function isLiability(account: Account) {
  return LIABILITY_TYPES.has(account.type)
}

export function netWorth(accounts: Account[]) {
  return accounts.reduce(
    (sum, a) => sum + (isLiability(a) ? -a.balance : a.balance),
    0,
  )
}

export function totalAssets(accounts: Account[]) {
  return accounts.filter((a) => !isLiability(a)).reduce((s, a) => s + a.balance, 0)
}

export function totalLiabilities(accounts: Account[]) {
  return accounts.filter(isLiability).reduce((s, a) => s + a.balance, 0)
}

export function currentMonthKey() {
  return monthKey(toISODate())
}

export function inMonth(txns: Transaction[], key: string) {
  return txns.filter((t) => monthKey(t.date) === key)
}

/** Spending is outflow excluding transfers — a transfer is not consumption. */
export function spendOf(txns: Transaction[]) {
  return txns
    .filter((t) => t.amount < 0 && !NON_SPEND_CATEGORIES.has(t.category))
    .reduce((s, t) => s + Math.abs(t.amount), 0)
}

export function incomeOf(txns: Transaction[]) {
  return txns.filter((t) => t.amount > 0 && t.category !== 'Transfer').reduce((s, t) => s + t.amount, 0)
}

export interface MonthSummary {
  key: string
  income: number
  spend: number
  net: number
  savingsRate: number
}

export function monthlySummaries(txns: Transaction[], months = 6): MonthSummary[] {
  const keys = new Set(txns.map((t) => monthKey(t.date)))
  return [...keys]
    .sort()
    .slice(-months)
    .map((key) => {
      const rows = inMonth(txns, key)
      const income = incomeOf(rows)
      const spend = spendOf(rows)
      return {
        key,
        income,
        spend,
        net: income - spend,
        savingsRate: income > 0 ? ((income - spend) / income) * 100 : 0,
      }
    })
}

export interface CategoryTotal {
  category: string
  amount: number
  share: number
}

export function categoryTotals(txns: Transaction[], topN = 7): CategoryTotal[] {
  const totals = new Map<string, number>()
  for (const t of txns) {
    if (t.amount >= 0 || NON_SPEND_CATEGORIES.has(t.category)) continue
    totals.set(t.category, (totals.get(t.category) ?? 0) + Math.abs(t.amount))
  }

  const sorted = [...totals.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)

  // Never generate a colour past the palette: the tail folds into "Other".
  const head = sorted.slice(0, topN)
  const tail = sorted.slice(topN)
  if (tail.length) {
    head.push({ category: 'Other', amount: tail.reduce((s, r) => s + r.amount, 0) })
  }

  const grand = head.reduce((s, r) => s + r.amount, 0) || 1
  return head.map((r) => ({ ...r, share: (r.amount / grand) * 100 }))
}

export interface BudgetStatus {
  category: string
  limit: number
  spent: number
  remaining: number
  pctUsed: number
  state: 'good' | 'warning' | 'critical'
}

export function budgetStatuses(budgets: Budget[], monthTxns: Transaction[]): BudgetStatus[] {
  return budgets
    .map((b) => {
      const spent = monthTxns
        .filter((t) => t.category === b.category && t.amount < 0)
        .reduce((s, t) => s + Math.abs(t.amount), 0)
      const pctUsed = b.monthly_limit > 0 ? (spent / b.monthly_limit) * 100 : 0
      return {
        category: b.category,
        limit: b.monthly_limit,
        spent,
        remaining: b.monthly_limit - spent,
        pctUsed,
        state: pctUsed > 100 ? 'critical' : pctUsed >= 80 ? 'warning' : 'good',
      } as BudgetStatus
    })
    .sort((a, b) => b.pctUsed - a.pctUsed)
}

/**
 * Reconstructs a net-worth series by walking today's balances backwards
 * through the transaction history. Exact only for accounts whose activity is
 * fully captured; good enough to show the trend.
 */
export function netWorthSeries(accounts: Account[], txns: Transaction[], months = 6) {
  const keys = [...new Set(txns.map((t) => monthKey(t.date)))].sort().slice(-months)
  const flowByMonth = new Map<string, number>()
  for (const t of txns) {
    if (t.category === 'Transfer') continue
    const k = monthKey(t.date)
    flowByMonth.set(k, (flowByMonth.get(k) ?? 0) + t.amount)
  }

  const current = netWorth(accounts)
  const series: Array<{ key: string; value: number }> = []
  let running = current
  for (let i = keys.length - 1; i >= 0; i--) {
    series.unshift({ key: keys[i], value: Number(running.toFixed(2)) })
    running -= flowByMonth.get(keys[i]) ?? 0
  }
  return series
}

/** Months of spending the liquid accounts would cover. */
export function runwayMonths(accounts: Account[], summaries: MonthSummary[]) {
  const liquid = accounts
    .filter((a) => a.type === 'checking' || a.type === 'savings' || a.type === 'cash')
    .reduce((s, a) => s + a.balance, 0)
  const recent = summaries.slice(-3)
  const avgSpend = recent.length
    ? recent.reduce((s, m) => s + m.spend, 0) / recent.length
    : 0
  return avgSpend > 0 ? liquid / avgSpend : 0
}

export const CATEGORY_OPTIONS = [
  'Groceries',
  'Dining',
  'Rent',
  'Utilities',
  'Transport',
  'Shopping',
  'Entertainment',
  'Subscriptions',
  'Health',
  'Fitness',
  'Travel',
  'Education',
  'Gifts',
  'Loan Payment',
  'Income',
  'Transfer',
  'Other',
]
