import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, Link2, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useTable } from '../lib/store'
import { useSettings } from '../lib/settings'
import { useToast } from '../components/ui'
import {
  Button,
  Callout,
  Card,
  EmptyState,
  Field,
  Modal,
  ProgressBar,
  SegmentedControl,
  Select,
  Stat,
} from '../components/ui'
import { CategoryBars, TimeSeriesChart } from '../components/charts'
import {
  budgetStatuses,
  categoryTotals,
  CATEGORY_OPTIONS,
  currentMonthKey,
  inMonth,
  isLiability,
  monthlySummaries,
  netWorth,
  netWorthSeries,
  runwayMonths,
  totalAssets,
  totalLiabilities,
} from '../lib/finance'
import { currency, monthLabel, monthLabelLong, monthKey, toISODate } from '../lib/format'
import { isCloudMode } from '../lib/supabase'
import { linkBank, listItems, syncNow, unlink, type LinkedItem } from '../lib/plaid'
import { useUndoableDelete } from '../lib/undo'
import { CsvImportModal } from '../components/CsvImportModal'
import type { Account, AccountType, Transaction } from '../lib/types'

const ACCOUNT_TYPES: Array<{ value: AccountType; label: string }> = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'investment', label: 'Investment' },
  { value: 'cash', label: 'Cash' },
  { value: 'credit', label: 'Credit card' },
  { value: 'loan', label: 'Loan' },
  { value: 'other', label: 'Other' },
]

type Tab = 'overview' | 'transactions' | 'budgets' | 'accounts'

export default function Financials() {
  const { settings } = useSettings()
  const accounts = useTable('accounts')
  const transactions = useTable('transactions')
  const budgets = useTable('budgets')
  const [tab, setTab] = useState<Tab>('overview')

  const code = settings.currency
  const fmt = (v: number) => currency(v, code)
  const fmtCompact = (v: number) => currency(v, code, { compact: true })

  const thisMonth = currentMonthKey()
  const monthTxns = useMemo(
    () => inMonth(transactions.rows, thisMonth),
    [transactions.rows, thisMonth],
  )
  const summaries = useMemo(
    () => monthlySummaries(transactions.rows, 6),
    [transactions.rows],
  )
  const current = summaries[summaries.length - 1]
  const previous = summaries[summaries.length - 2]

  const worth = netWorth(accounts.rows)
  const worthSeries = useMemo(
    () => netWorthSeries(accounts.rows, transactions.rows, 6),
    [accounts.rows, transactions.rows],
  )
  const worthChange = worthSeries.length > 1 ? worth - worthSeries[0].value : 0

  const runway = runwayMonths(accounts.rows, summaries)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Financials</h1>
          <p className="text-xs text-ink-secondary">
            {accounts.rows.length} accounts · {transactions.rows.length} transactions
          </p>
        </div>
        <SegmentedControl<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'transactions', label: 'Transactions' },
            { value: 'budgets', label: 'Budgets' },
            { value: 'accounts', label: 'Accounts' },
          ]}
        />
      </div>

      {tab === 'overview' && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Net worth"
              value={fmt(worth)}
              deltaLabel={`${worthChange >= 0 ? '+' : '−'}${currency(Math.abs(worthChange), code, { compact: true })} over 6 months`}
              intent={worthChange >= 0 ? 'good' : 'bad'}
            />
            <Stat
              label="Spent this month"
              value={fmt(current?.spend ?? 0)}
              deltaLabel={
                previous
                  ? `${current.spend <= previous.spend ? '−' : '+'}${currency(
                      Math.abs(current.spend - previous.spend),
                      code,
                      { compact: true },
                    )} vs last month`
                  : undefined
              }
              intent={
                previous ? (current.spend <= previous.spend ? 'good' : 'bad') : 'neutral'
              }
            />
            <Stat
              label="Savings rate"
              value={`${(current?.savingsRate ?? 0).toFixed(0)}%`}
              hint={current ? `${fmt(current.net)} kept this month` : undefined}
              intent={(current?.savingsRate ?? 0) >= 20 ? 'good' : 'neutral'}
            />
            <Stat
              label="Cash runway"
              value={`${runway.toFixed(1)} mo`}
              hint="Liquid savings ÷ recent average spend"
              intent={runway >= 6 ? 'good' : runway >= 3 ? 'neutral' : 'bad'}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <TimeSeriesChart
              title="Net worth"
              subtitle="Reconstructed by walking today's balances back through your transaction history"
              data={worthSeries}
              xKey="key"
              xFormat={monthLabel}
              yFormat={fmtCompact}
              yDomain={['auto', 'auto']}
              // A line, not an area: the axis is truncated (net worth never
              // starts at zero), and a fill from a non-zero baseline overstates
              // the magnitude of the change.
              series={[{ key: 'value', label: 'Net worth', slot: 1, kind: 'line' }]}
            />

            {/* Income and spend share a unit, so they belong on one axis. */}
            <TimeSeriesChart
              title="Income vs. spending"
              subtitle="Last 6 months"
              data={summaries}
              xKey="key"
              xFormat={monthLabel}
              yFormat={fmtCompact}
              series={[
                { key: 'income', label: 'Income', slot: 1, kind: 'bar' },
                { key: 'spend', label: 'Spending', slot: 2, kind: 'bar' },
              ]}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <CategoryBars
              title="Where the money went"
              subtitle={`${monthLabelLong(thisMonth)} · excludes transfers`}
              rows={categoryTotals(monthTxns).map((c) => ({
                label: c.category,
                value: c.amount,
                note: `${c.share.toFixed(0)}%`,
              }))}
              format={fmt}
            />

            <Card title="Budget health" subtitle={monthLabelLong(thisMonth)}>
              <BudgetList statuses={budgetStatuses(budgets.rows, monthTxns)} format={fmt} />
            </Card>
          </div>
        </>
      )}

      {tab === 'transactions' && (
        <TransactionsTab
          transactions={transactions}
          accounts={accounts.rows}
          format={fmt}
        />
      )}

      {tab === 'budgets' && (
        <BudgetsTab budgets={budgets} monthTxns={monthTxns} format={fmt} />
      )}

      {tab === 'accounts' && (
        <AccountsTab accounts={accounts} transactions={transactions} format={fmt} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function BudgetList({
  statuses,
  format,
}: {
  statuses: ReturnType<typeof budgetStatuses>
  format: (v: number) => string
}) {
  if (statuses.length === 0) {
    return (
      <EmptyState
        title="No budgets yet"
        description="Set a monthly limit per category to see how the month is tracking."
      />
    )
  }

  return (
    <div className="space-y-3.5">
      {statuses.map((b) => (
        <div key={b.category}>
          <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
            <span className="font-medium text-ink-primary">{b.category}</span>
            <span className="tnum text-ink-secondary">
              {format(b.spent)} <span className="text-ink-muted">of {format(b.limit)}</span>
            </span>
          </div>
          <ProgressBar value={b.spent} max={b.limit} state={b.state} />
          <p
            className="tnum mt-1 text-[11px]"
            style={{
              color:
                b.state === 'critical'
                  ? 'var(--status-critical)'
                  : b.state === 'warning'
                    ? 'var(--status-warning)'
                    : 'var(--text-muted)',
            }}
          >
            {b.remaining >= 0
              ? `${format(b.remaining)} left · ${b.pctUsed.toFixed(0)}% used`
              : `${format(Math.abs(b.remaining))} over budget`}
          </p>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function TransactionsTab({
  transactions,
  accounts,
  format,
}: {
  transactions: ReturnType<typeof useTable<'transactions'>>
  accounts: Account[]
  format: (v: number) => string
}) {
  const toast = useToast()
  const { removeRow } = useUndoableDelete()
  const [category, setCategory] = useState('all')
  const [month, setMonth] = useState(currentMonthKey())
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)

  const months = useMemo(
    () => [...new Set(transactions.rows.map((t) => monthKey(t.date)))].sort().reverse(),
    [transactions.rows],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return transactions.rows
      .filter((t) => (month === 'all' ? true : monthKey(t.date) === month))
      .filter((t) => (category === 'all' ? true : t.category === category))
      .filter((t) => (q ? t.name.toLowerCase().includes(q) : true))
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [transactions.rows, month, category, query])

  const totalOut = filtered
    .filter((t) => t.amount < 0)
    .reduce((s, t) => s + Math.abs(t.amount), 0)
  const totalIn = filtered.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const accountName = (id: string | null) =>
    accounts.find((a) => a.id === id)?.name ?? 'Unlinked'

  return (
    <div className="space-y-4">
      {/* Filters sit in one row above the data. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1">
          <span className="label">Search</span>
          <input
            className="input"
            placeholder="Merchant or description"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="w-36">
          <span className="label">Month</span>
          <Select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            options={[
              { value: 'all', label: 'All time' },
              ...months.map((m) => ({ value: m, label: monthLabel(m) })),
            ]}
          />
        </div>
        <div className="w-40">
          <span className="label">Category</span>
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={[
              { value: 'all', label: 'All categories' },
              ...CATEGORY_OPTIONS.map((c) => ({ value: c, label: c })),
            ]}
          />
        </div>
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus size={15} /> Add
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-ink-secondary">
        <span className="chip">
          {filtered.length} transaction{filtered.length === 1 ? '' : 's'}
        </span>
        <span className="chip">Out {format(totalOut)}</span>
        <span className="chip">In {format(totalIn)}</span>
      </div>

      <Card>
        {filtered.length === 0 ? (
          <EmptyState title="Nothing matches those filters" />
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[38rem] text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-ink-secondary">
                  <th scope="col" className="px-2 py-2 text-left font-medium">
                    Date
                  </th>
                  <th scope="col" className="px-2 py-2 text-left font-medium">
                    Description
                  </th>
                  <th scope="col" className="px-2 py-2 text-left font-medium">
                    Category
                  </th>
                  <th scope="col" className="px-2 py-2 text-left font-medium">
                    Account
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Amount
                  </th>
                  <th scope="col" className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 200).map((t) => (
                  <tr key={t.id} className="group border-b border-line/60 last:border-0">
                    <td className="tnum whitespace-nowrap px-2 py-2 text-ink-secondary">
                      {new Date(t.date + 'T00:00:00').toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className="px-2 py-2">
                      <span className="text-ink-primary">{t.name}</span>
                      {t.pending && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-ink-muted">
                          pending
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <span className="chip">{t.category}</span>
                    </td>
                    <td className="px-2 py-2 text-ink-secondary">
                      {accountName(t.account_id)}
                    </td>
                    <td
                      className="tnum whitespace-nowrap px-2 py-2 text-right font-medium"
                      style={{
                        color: t.amount > 0 ? 'var(--status-good)' : 'var(--text-primary)',
                      }}
                    >
                      {t.amount > 0 ? '+' : '−'}
                      {format(Math.abs(t.amount))}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        onClick={() =>
                          void removeRow(
                            'transactions',
                            t,
                            transactions.remove,
                            'Transaction',
                          )
                        }
                        className="btn btn-ghost !p-1 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                        aria-label={`Delete ${t.name}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 200 && (
              <p className="px-2 pt-3 text-xs text-ink-muted">
                Showing the 200 most recent of {filtered.length}. Narrow the filters to see
                more.
              </p>
            )}
          </div>
        )}
      </Card>

      <AddTransactionModal
        open={adding}
        onClose={() => setAdding(false)}
        accounts={accounts}
        onSave={async (row) => {
          await transactions.insert(row)
          toast.push('Transaction added')
        }}
      />
    </div>
  )
}

function AddTransactionModal({
  open,
  onClose,
  accounts,
  onSave,
}: {
  open: boolean
  onClose: () => void
  accounts: Account[]
  onSave: (row: Omit<Transaction, 'id'>) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState<'out' | 'in'>('out')
  const [category, setCategory] = useState('Groceries')
  const [date, setDate] = useState(toISODate())
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')

  const submit = async () => {
    const value = Number(amount)
    if (!name.trim() || Number.isNaN(value) || value <= 0) return
    await onSave({
      account_id: accountId || null,
      date,
      name: name.trim(),
      merchant: name.trim(),
      amount: direction === 'out' ? -value : value,
      category,
      pending: false,
      plaid_transaction_id: null,
      notes: null,
    })
    setName('')
    setAmount('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add transaction"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Description">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount">
          <input
            className="input tnum"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Direction">
          <Select
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'out' | 'in')}
            options={[
              { value: 'out', label: 'Money out' },
              { value: 'in', label: 'Money in' },
            ]}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={CATEGORY_OPTIONS.map((c) => ({ value: c, label: c }))}
          />
        </Field>
        <Field label="Date">
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Account">
        <Select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          options={accounts.map((a) => ({ value: a.id, label: a.name }))}
        />
      </Field>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */

function BudgetsTab({
  budgets,
  monthTxns,
  format,
}: {
  budgets: ReturnType<typeof useTable<'budgets'>>
  monthTxns: Transaction[]
  format: (v: number) => string
}) {
  const toast = useToast()
  const { removeRow } = useUndoableDelete()
  const [category, setCategory] = useState('Groceries')
  const [limit, setLimit] = useState('')

  const statuses = budgetStatuses(budgets.rows, monthTxns)
  const totalLimit = statuses.reduce((s, b) => s + b.limit, 0)
  const totalSpent = statuses.reduce((s, b) => s + b.spent, 0)

  const add = async () => {
    const value = Number(limit)
    if (Number.isNaN(value) || value <= 0) return
    const existing = budgets.rows.find((b) => b.category === category)
    if (existing) {
      await budgets.update(existing.id, { monthly_limit: value })
      toast.push(`${category} budget updated`)
    } else {
      await budgets.insert({ category, monthly_limit: value })
      toast.push(`${category} budget added`)
    }
    setLimit('')
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Budgeted" value={format(totalLimit)} />
          <Stat
            label="Spent"
            value={format(totalSpent)}
            hint={`${totalLimit > 0 ? ((totalSpent / totalLimit) * 100).toFixed(0) : 0}% of budget`}
          />
          <Stat
            label="Remaining"
            value={format(totalLimit - totalSpent)}
            intent={totalLimit - totalSpent >= 0 ? 'good' : 'bad'}
          />
        </div>

        <Card title="This month by category">
          <BudgetList statuses={statuses} format={format} />
        </Card>
      </div>

      <Card
        title="Set a budget"
        subtitle="Saving over an existing category replaces its limit"
      >
        <div className="space-y-3">
          <Field label="Category">
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={CATEGORY_OPTIONS.filter(
                (c) => c !== 'Income' && c !== 'Transfer',
              ).map((c) => ({ value: c, label: c }))}
            />
          </Field>
          <Field label="Monthly limit">
            <input
              className="input tnum"
              type="number"
              min="0"
              step="10"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
          </Field>
          <Button variant="primary" className="w-full" onClick={() => void add()}>
            Save budget
          </Button>

          {budgets.rows.length > 0 && (
            <div className="border-t border-line pt-3">
              <p className="label">Existing</p>
              <ul className="space-y-1">
                {budgets.rows.map((b) => (
                  <li key={b.id} className="flex items-center justify-between text-xs">
                    <span className="text-ink-secondary">{b.category}</span>
                    <span className="flex items-center gap-2">
                      <span className="tnum text-ink-primary">
                        {format(b.monthly_limit)}
                      </span>
                      <button
                        onClick={() =>
                          void removeRow('budgets', b, budgets.remove, 'Budget')
                        }
                        className="text-ink-muted hover:text-ink-primary"
                        aria-label={`Remove ${b.category} budget`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function AccountsTab({
  accounts,
  transactions,
  format,
}: {
  accounts: ReturnType<typeof useTable<'accounts'>>
  transactions: ReturnType<typeof useTable<'transactions'>>
  format: (v: number) => string
}) {
  const toast = useToast()
  const { removeRow } = useUndoableDelete()
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState<'link' | 'sync' | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [items, setItems] = useState<LinkedItem[]>([])

  const assets = accounts.rows.filter((a) => !isLiability(a))
  const liabilities = accounts.rows.filter(isLiability)

  const loadItems = useCallback(async () => {
    if (!isCloudMode) return
    try {
      setItems(await listItems())
    } catch {
      // Not being able to list linked banks should not break the page.
    }
  }, [])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const startLink = async () => {
    setBusy('link')
    setLinkError(null)
    try {
      const result = await linkBank()
      if (result) {
        toast.push(`Linked. Imported ${result.added} transactions.`)
        accounts.refresh()
        transactions.refresh()
        await loadItems()
      }
    } catch (err) {
      setLinkError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const sync = async () => {
    setBusy('sync')
    setLinkError(null)
    try {
      const result = await syncNow()
      accounts.refresh()
      transactions.refresh()
      await loadItems()
      toast.push(
        result.added || result.modified || result.removed
          ? `Synced: ${result.added} new, ${result.modified} updated, ${result.removed} removed.`
          : 'Already up to date.',
      )
    } catch (err) {
      setLinkError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Assets" value={format(totalAssets(accounts.rows))} />
        <Stat label="Liabilities" value={format(totalLiabilities(accounts.rows))} />
        <Stat
          label="Net worth"
          value={format(netWorth(accounts.rows))}
          intent={netWorth(accounts.rows) >= 0 ? 'good' : 'bad'}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void startLink()} disabled={busy !== null}>
          <Link2 size={15} /> {busy === 'link' ? 'Opening Plaid…' : 'Link a bank'}
        </Button>
        {items.length > 0 && (
          <Button onClick={() => void sync()} disabled={busy !== null}>
            <RefreshCw size={15} className={busy === 'sync' ? 'animate-spin' : ''} />
            {busy === 'sync' ? 'Syncing…' : 'Sync now'}
          </Button>
        )}
        <Button onClick={() => setImporting(true)}>
          <Upload size={15} /> Import CSV
        </Button>
        <Button onClick={() => setAdding(true)}>
          <Plus size={15} /> Add manually
        </Button>
      </div>

      {!isCloudMode && (
        <Callout intent="info">
          Bank linking needs cloud mode — synced accounts are written to your database by
          the server. CSV import and manual accounts work either way.
        </Callout>
      )}

      {linkError && (
        <Callout intent="warning">
          {linkError} Manual accounts and CSV import still work in the meantime.
        </Callout>
      )}

      {items.length > 0 && (
        <Card title="Linked banks" subtitle={`${items.length} connected`}>
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <li
                key={item.item_id}
                className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
              >
                <div>
                  <p className="text-sm text-ink-primary">
                    {item.institution_name ?? 'Linked bank'}
                  </p>
                  <p className="text-[11px] text-ink-muted">
                    {item.last_synced_at
                      ? `Last synced ${new Date(item.last_synced_at).toLocaleString()}`
                      : 'Not synced yet'}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    try {
                      await unlink(item.item_id)
                      await loadItems()
                      toast.push('Bank unlinked. Existing transactions were kept.')
                    } catch (err) {
                      toast.push((err as Error).message, 'error')
                    }
                  }}
                  className="btn btn-ghost !px-2 !py-1 text-xs"
                >
                  Unlink
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Assets" subtitle={`${assets.length} accounts`}>
          <AccountList
            accounts={assets}
            format={format}
            onDelete={(account) =>
              void removeRow('accounts', account, accounts.remove, 'Account')
            }
          />
        </Card>
        <Card title="Liabilities" subtitle={`${liabilities.length} accounts`}>
          <AccountList
            accounts={liabilities}
            format={format}
            onDelete={(account) =>
              void removeRow('accounts', account, accounts.remove, 'Account')
            }
          />
        </Card>
      </div>

      <AddAccountModal
        open={adding}
        onClose={() => setAdding(false)}
        onSave={async (row) => {
          await accounts.insert(row)
          toast.push('Account added')
        }}
      />

      <CsvImportModal
        open={importing}
        onClose={() => setImporting(false)}
        accounts={accounts.rows}
        existing={transactions.rows}
        onImport={async (rows) => {
          for (const row of rows) await transactions.insert(row)
          transactions.refresh()
        }}
      />
    </div>
  )
}

function AccountList({
  accounts,
  format,
  onDelete,
}: {
  accounts: Account[]
  format: (v: number) => string
  onDelete: (account: Account) => void
}) {
  if (accounts.length === 0) {
    return <EmptyState icon={<Building2 size={20} />} title="No accounts here yet" />
  }
  return (
    <ul className="divide-y divide-line">
      {accounts.map((a) => (
        <li
          key={a.id}
          className="group flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink-primary">{a.name}</p>
            <p className="truncate text-xs text-ink-secondary">
              {a.institution ?? 'Manual'} ·{' '}
              {ACCOUNT_TYPES.find((t) => t.value === a.type)?.label ?? a.type}
              {a.plaid_account_id && ' · synced'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="tnum text-sm font-medium text-ink-primary">
              {format(a.balance)}
            </span>
            <button
              onClick={() => onDelete(a)}
              className="btn btn-ghost !p-1 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
              aria-label={`Remove ${a.name}`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function AddAccountModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean
  onClose: () => void
  onSave: (row: Omit<Account, 'id'>) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [institution, setInstitution] = useState('')
  const [type, setType] = useState<AccountType>('checking')
  const [balance, setBalance] = useState('')

  const submit = async () => {
    const value = Number(balance)
    if (!name.trim() || Number.isNaN(value)) return
    await onSave({
      name: name.trim(),
      institution: institution.trim() || null,
      type,
      balance: value,
      currency: 'USD',
      plaid_account_id: null,
      plaid_item_id: null,
      is_manual: true,
      updated_at: new Date().toISOString(),
    })
    setName('')
    setInstitution('')
    setBalance('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add account"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Account name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Institution">
        <input
          className="input"
          value={institution}
          onChange={(e) => setInstitution(e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as AccountType)}
            options={ACCOUNT_TYPES}
          />
        </Field>
        <Field
          label="Balance"
          hint={
            type === 'credit' || type === 'loan'
              ? 'Enter the amount owed as a positive number.'
              : undefined
          }
        >
          <input
            className="input tnum"
            type="number"
            step="0.01"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  )
}
