import { useMemo, useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import {
  dedupe,
  detectColumns,
  mapRows,
  parseCsv,
  type ColumnMapping,
  type CsvTable,
  type ImportRow,
} from '../lib/csv'
import { CATEGORY_OPTIONS } from '../lib/finance'
import { currency } from '../lib/format'
import { useSettings } from '../lib/settings'
import { Button, Callout, Field, Modal, Select, useToast } from './ui'
import type { Account, Transaction } from '../lib/types'

/**
 * CSV import with a confirmation step.
 *
 * Bank exports vary enough that guessing silently is the wrong move — a
 * mis-detected sign convention would flip every transaction in the file. The
 * columns are auto-detected, then shown with a preview so a wrong guess is
 * obvious before anything is written.
 */
export function CsvImportModal({
  open,
  onClose,
  accounts,
  existing,
  onImport,
}: {
  open: boolean
  onClose: () => void
  accounts: Account[]
  existing: Transaction[]
  onImport: (rows: ImportRow[]) => Promise<void>
}) {
  const { settings } = useSettings()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [table, setTable] = useState<CsvTable | null>(null)
  const [fileName, setFileName] = useState('')
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [dayFirst, setDayFirst] = useState(false)
  const [outflowPositive, setOutflowPositive] = useState(false)
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? '')
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setTable(null)
    setMapping(null)
    setFileName('')
  }

  const readFile = async (file: File) => {
    const parsed = parseCsv(await file.text())
    if (parsed.headers.length === 0) {
      toast.push('That file has no readable rows.', 'error')
      return
    }
    setTable(parsed)
    setMapping(detectColumns(parsed.headers))
    setFileName(file.name)
  }

  const preview = useMemo(() => {
    if (!table || !mapping) return null
    const { rows, skipped } = mapRows(table, {
      mapping,
      dayFirst,
      outflowPositive,
      accountId: accountId || null,
    })
    const { unique, duplicates } = dedupe(rows, existing)
    return { rows: unique, skipped, duplicates }
  }, [table, mapping, dayFirst, outflowPositive, accountId, existing])

  const columnOptions = useMemo(() => {
    if (!table) return []
    return [
      { value: '-1', label: '— none —' },
      ...table.headers.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` })),
    ]
  }, [table])

  const setColumn = (key: keyof ColumnMapping, value: string) =>
    setMapping((m) => (m ? { ...m, [key]: Number(value) } : m))

  const commit = async () => {
    if (!preview?.rows.length) return
    setBusy(true)
    try {
      await onImport(preview.rows)
      toast.push(`Imported ${preview.rows.length} transactions`)
      reset()
      onClose()
    } catch (err) {
      toast.push((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="Import transactions from CSV"
      width="max-w-3xl"
      footer={
        <>
          <Button
            onClick={() => {
              reset()
              onClose()
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void commit()}
            disabled={busy || !preview?.rows.length}
          >
            {preview?.rows.length ? `Import ${preview.rows.length}` : 'Import'}
          </Button>
        </>
      }
    >
      {!table ? (
        <div className="space-y-3">
          <Callout intent="info">
            Export a statement as CSV from your bank. Columns are detected automatically and
            you get a preview before anything is saved.
          </Callout>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-surface-2 px-4 py-10 text-center transition-colors hover:bg-surface-3"
          >
            <FileUp size={22} className="text-ink-muted" />
            <span className="text-sm font-medium text-ink-primary">Choose a CSV file</span>
            <span className="text-xs text-ink-secondary">or drop it here</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void readFile(file)
              e.target.value = ''
            }}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-xs text-ink-secondary">
              {fileName} · {table.rows.length} rows
            </p>
            <button onClick={reset} className="btn btn-ghost !px-2 !py-1 text-xs">
              Choose another file
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Date column">
              <Select
                value={String(mapping?.date ?? -1)}
                onChange={(e) => setColumn('date', e.target.value)}
                options={columnOptions}
              />
            </Field>
            <Field label="Description column">
              <Select
                value={String(mapping?.description ?? -1)}
                onChange={(e) => setColumn('description', e.target.value)}
                options={columnOptions}
              />
            </Field>
            <Field label="Amount column">
              <Select
                value={String(mapping?.amount ?? -1)}
                onChange={(e) => setColumn('amount', e.target.value)}
                options={columnOptions}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Debit column" hint="If the file splits money in and out">
              <Select
                value={String(mapping?.debit ?? -1)}
                onChange={(e) => setColumn('debit', e.target.value)}
                options={columnOptions}
              />
            </Field>
            <Field label="Credit column">
              <Select
                value={String(mapping?.credit ?? -1)}
                onChange={(e) => setColumn('credit', e.target.value)}
                options={columnOptions}
              />
            </Field>
            <Field label="Import into account">
              <Select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                options={[
                  { value: '', label: 'Unassigned' },
                  ...accounts.map((a) => ({ value: a.id, label: a.name })),
                ]}
              />
            </Field>
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-xs text-ink-secondary">
              <input
                type="checkbox"
                checked={dayFirst}
                onChange={(e) => setDayFirst(e.target.checked)}
              />
              Dates are day/month (not month/day)
            </label>
            <label className="flex items-center gap-2 text-xs text-ink-secondary">
              <input
                type="checkbox"
                checked={outflowPositive}
                onChange={(e) => setOutflowPositive(e.target.checked)}
              />
              Spending is written as a positive number
            </label>
          </div>

          {preview && (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="chip">{preview.rows.length} to import</span>
                {preview.duplicates > 0 && (
                  <span className="chip">{preview.duplicates} already imported</span>
                )}
                {preview.skipped > 0 && (
                  <span className="chip">{preview.skipped} unreadable</span>
                )}
              </div>

              {preview.rows.length === 0 ? (
                <Callout intent="warning">
                  Nothing to import with these settings. Check the column choices above — if
                  every row is unreadable, the date or amount column is probably wrong.
                </Callout>
              ) : (
                <div className="max-h-56 overflow-auto rounded-xl border border-line">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface-2">
                      <tr className="text-ink-secondary">
                        <th className="px-2 py-1.5 text-left font-medium">Date</th>
                        <th className="px-2 py-1.5 text-left font-medium">Description</th>
                        <th className="px-2 py-1.5 text-left font-medium">Category</th>
                        <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 40).map((row, i) => (
                        <tr key={i} className="border-t border-line/60">
                          <td className="tnum px-2 py-1 text-ink-secondary">{row.date}</td>
                          <td className="max-w-[16rem] truncate px-2 py-1 text-ink-primary">
                            {row.name}
                          </td>
                          <td className="px-2 py-1 text-ink-secondary">{row.category}</td>
                          <td
                            className="tnum px-2 py-1 text-right font-medium"
                            style={{
                              color:
                                row.amount > 0
                                  ? 'var(--status-good)'
                                  : 'var(--text-primary)',
                            }}
                          >
                            {row.amount > 0 ? '+' : '−'}
                            {currency(Math.abs(row.amount), settings.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="text-[11px] text-ink-muted">
                Check a couple of rows: money out should show as a negative amount. If it is
                inverted, tick “spending is written as a positive number”. Categories
                default to {CATEGORY_OPTIONS[CATEGORY_OPTIONS.length - 1]} unless the file
                has a category column.
              </p>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
