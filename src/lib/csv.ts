import { toISODate } from './format'
import type { Transaction } from './types'

/**
 * CSV import for accounts Plaid cannot reach.
 *
 * Bank exports are inconsistent — different column names, date formats, and two
 * different conventions for representing an outflow. The parser handles the
 * common shapes and asks the user to confirm the mapping rather than guessing
 * silently.
 */

export interface CsvTable {
  headers: string[]
  rows: string[][]
}

/**
 * RFC 4180-ish parser. Written by hand rather than split(',') because bank
 * exports routinely contain quoted commas in the description field.
 */
export function parseCsv(text: string): CsvTable {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  const cleaned = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i]

    if (inQuotes) {
      if (char === '"') {
        if (cleaned[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  const nonEmpty = rows.filter((r) => r.some((cell) => cell.trim() !== ''))
  if (nonEmpty.length === 0) return { headers: [], rows: [] }

  return {
    headers: nonEmpty[0].map((h) => h.trim()),
    rows: nonEmpty.slice(1),
  }
}

/* ------------------------------------------------------------------ */
/* Column detection                                                    */
/* ------------------------------------------------------------------ */

export interface ColumnMapping {
  date: number
  description: number
  amount: number
  /** Some exports use separate debit/credit columns instead of one signed one. */
  debit: number
  credit: number
  category: number
}

const CANDIDATES: Record<keyof ColumnMapping, string[]> = {
  date: ['date', 'transaction date', 'posted date', 'posting date', 'trans date'],
  description: [
    'description',
    'name',
    'payee',
    'merchant',
    'details',
    'memo',
    'transaction',
  ],
  amount: ['amount', 'value'],
  debit: ['debit', 'withdrawal', 'money out', 'paid out'],
  credit: ['credit', 'deposit', 'money in', 'paid in'],
  category: ['category', 'type', 'classification'],
}

/** Best-guess column mapping; -1 means "not present". */
export function detectColumns(headers: string[]): ColumnMapping {
  const normalized = headers.map((h) => h.trim().toLowerCase())

  const find = (options: string[]) => {
    const exact = normalized.findIndex((h) => options.includes(h))
    if (exact !== -1) return exact
    return normalized.findIndex((h) => options.some((o) => h.includes(o)))
  }

  return {
    date: find(CANDIDATES.date),
    description: find(CANDIDATES.description),
    amount: find(CANDIDATES.amount),
    debit: find(CANDIDATES.debit),
    credit: find(CANDIDATES.credit),
    category: find(CANDIDATES.category),
  }
}

/* ------------------------------------------------------------------ */
/* Value parsing                                                       */
/* ------------------------------------------------------------------ */

/**
 * Handles the date formats banks actually emit. Ambiguous DD/MM vs MM/DD is
 * resolved by `dayFirst`, which the import UI exposes — there is no way to
 * infer it correctly from a single row.
 */
export function parseDate(value: string, dayFirst = false): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  // Already ISO.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(trimmed)
  if (slash) {
    const first = Number(slash[1])
    const second = Number(slash[2])
    let year = Number(slash[3])
    if (year < 100) year += year < 70 ? 2000 : 1900

    // A value above 12 can only be the day, whatever the stated convention.
    const day = dayFirst || first > 12 ? first : second
    const month = dayFirst || first > 12 ? second : first
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return toISODate(new Date(year, month - 1, day))
  }

  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? null : toISODate(parsed)
}

/** Strips currency symbols, thousands separators and parenthesised negatives. */
export function parseAmount(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  // Accounting style: (12.34) means -12.34.
  const parenthesised = /^\((.*)\)$/.exec(trimmed)
  const body = parenthesised ? parenthesised[1] : trimmed

  const cleaned = body.replace(/[^\d.,-]/g, '').replace(/,/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.') return null

  const number = Number(cleaned)
  if (Number.isNaN(number)) return null
  return parenthesised ? -Math.abs(number) : number
}

/* ------------------------------------------------------------------ */
/* Row mapping                                                         */
/* ------------------------------------------------------------------ */

export type ImportRow = Omit<Transaction, 'id'>

export interface MapOptions {
  mapping: ColumnMapping
  dayFirst?: boolean
  /** True when the file writes outflows as positive numbers. */
  outflowPositive?: boolean
  accountId: string | null
  defaultCategory?: string
}

export interface MapResult {
  rows: ImportRow[]
  skipped: number
}

export function mapRows(table: CsvTable, options: MapOptions): MapResult {
  const {
    mapping,
    dayFirst = false,
    outflowPositive = false,
    accountId,
    defaultCategory = 'Other',
  } = options

  const rows: ImportRow[] = []
  let skipped = 0

  for (const cells of table.rows) {
    const date = parseDate(cells[mapping.date] ?? '', dayFirst)
    const name = (cells[mapping.description] ?? '').trim()

    let amount: number | null = null
    if (mapping.amount !== -1) {
      amount = parseAmount(cells[mapping.amount] ?? '')
      if (amount !== null && outflowPositive) amount = -amount
    } else if (mapping.debit !== -1 || mapping.credit !== -1) {
      // Separate debit/credit columns: exactly one is filled per row.
      const debit = mapping.debit === -1 ? null : parseAmount(cells[mapping.debit] ?? '')
      const credit = mapping.credit === -1 ? null : parseAmount(cells[mapping.credit] ?? '')
      if (debit) amount = -Math.abs(debit)
      else if (credit) amount = Math.abs(credit)
    }

    if (!date || !name || amount === null || amount === 0) {
      skipped++
      continue
    }

    const category =
      mapping.category !== -1 && (cells[mapping.category] ?? '').trim()
        ? (cells[mapping.category] ?? '').trim()
        : defaultCategory

    rows.push({
      account_id: accountId,
      date,
      name,
      merchant: name,
      amount,
      category,
      pending: false,
      plaid_transaction_id: null,
      notes: null,
    })
  }

  return { rows, skipped }
}

/**
 * Drops rows that already exist. Bank exports overlap month to month, so
 * re-importing without this quietly doubles the overlap.
 */
export function dedupe(incoming: ImportRow[], existing: Transaction[]) {
  const key = (row: { date: string; amount: number; name: string }) =>
    `${row.date}|${row.amount.toFixed(2)}|${row.name.trim().toLowerCase()}`

  const seen = new Set(existing.map(key))
  const unique: ImportRow[] = []
  let duplicates = 0

  for (const row of incoming) {
    const rowKey = key(row)
    if (seen.has(rowKey)) {
      duplicates++
      continue
    }
    seen.add(rowKey)
    unique.push(row)
  }

  return { unique, duplicates }
}
