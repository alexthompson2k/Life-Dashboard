import { describe, expect, it } from 'vitest'
import { dedupe, detectColumns, mapRows, parseAmount, parseCsv, parseDate } from './csv'
import type { Transaction } from './types'

describe('parseCsv', () => {
  it('reads headers and rows', () => {
    const table = parseCsv('Date,Description,Amount\n2026-08-12,Coffee,-4.50')
    expect(table.headers).toEqual(['Date', 'Description', 'Amount'])
    expect(table.rows).toEqual([['2026-08-12', 'Coffee', '-4.50']])
  })

  it('keeps commas inside quoted fields', () => {
    // The reason this is not split(',') — descriptions routinely contain commas.
    const table = parseCsv('Date,Description,Amount\n2026-08-12,"Coffee, large",-4.50')
    expect(table.rows[0][1]).toBe('Coffee, large')
  })

  it('handles escaped quotes', () => {
    const table = parseCsv('A\n"He said ""hi"""')
    expect(table.rows[0][0]).toBe('He said "hi"')
  })

  it('handles CRLF endings and a BOM', () => {
    const table = parseCsv('﻿Date,Amount\r\n2026-08-12,5\r\n')
    expect(table.headers).toEqual(['Date', 'Amount'])
    expect(table.rows).toHaveLength(1)
  })

  it('ignores blank lines', () => {
    const table = parseCsv('Date,Amount\n\n2026-08-12,5\n\n')
    expect(table.rows).toHaveLength(1)
  })

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] })
  })
})

describe('detectColumns', () => {
  it('finds the common header names', () => {
    const mapping = detectColumns(['Date', 'Description', 'Amount', 'Category'])
    expect(mapping.date).toBe(0)
    expect(mapping.description).toBe(1)
    expect(mapping.amount).toBe(2)
    expect(mapping.category).toBe(3)
  })

  it('matches the variants different banks use', () => {
    const mapping = detectColumns(['Posted Date', 'Payee', 'Debit', 'Credit'])
    expect(mapping.date).toBe(0)
    expect(mapping.description).toBe(1)
    expect(mapping.debit).toBe(2)
    expect(mapping.credit).toBe(3)
  })

  it('reports -1 for columns that are not there', () => {
    expect(detectColumns(['Foo', 'Bar']).amount).toBe(-1)
  })
})

describe('parseDate', () => {
  it('passes ISO through', () => {
    expect(parseDate('2026-08-12')).toBe('2026-08-12')
    expect(parseDate('2026-08-12T09:00:00Z')).toBe('2026-08-12')
  })

  it('reads US-style month-first dates by default', () => {
    expect(parseDate('08/12/2026')).toBe('2026-08-12')
  })

  it('reads day-first when told to', () => {
    expect(parseDate('12/08/2026', true)).toBe('2026-08-12')
  })

  it('infers day-first when the first part cannot be a month', () => {
    // 25 can only be a day, whatever the file claims.
    expect(parseDate('25/08/2026')).toBe('2026-08-25')
  })

  it('expands two-digit years', () => {
    expect(parseDate('08/12/26')).toBe('2026-08-12')
  })

  it('accepts dots and dashes as separators', () => {
    expect(parseDate('08.12.2026')).toBe('2026-08-12')
    expect(parseDate('08-12-2026')).toBe('2026-08-12')
  })

  it('rejects impossible and empty dates', () => {
    expect(parseDate('13/13/2026')).toBeNull()
    expect(parseDate('')).toBeNull()
    expect(parseDate('not a date')).toBeNull()
  })
})

describe('parseAmount', () => {
  it('strips currency symbols and separators', () => {
    expect(parseAmount('$1,234.56')).toBe(1234.56)
    expect(parseAmount('£45.00')).toBe(45)
  })

  it('keeps a leading minus', () => {
    expect(parseAmount('-42.50')).toBe(-42.5)
  })

  it('reads accounting-style parentheses as negative', () => {
    expect(parseAmount('(42.50)')).toBe(-42.5)
    expect(parseAmount('($1,000.00)')).toBe(-1000)
  })

  it('returns null for blanks and junk', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('   ')).toBeNull()
    expect(parseAmount('n/a')).toBeNull()
  })
})

describe('mapRows', () => {
  const table = parseCsv(
    ['Date,Description,Amount', '2026-08-12,Coffee,-4.50', '2026-08-13,Salary,3000'].join(
      '\n',
    ),
  )
  const mapping = detectColumns(table.headers)

  it('maps a signed-amount file', () => {
    const { rows, skipped } = mapRows(table, { mapping, accountId: 'acc_1' })
    expect(skipped).toBe(0)
    expect(rows[0]).toMatchObject({ date: '2026-08-12', name: 'Coffee', amount: -4.5 })
    expect(rows[1].amount).toBe(3000)
    expect(rows[0].account_id).toBe('acc_1')
  })

  it('flips the sign for exports that write outflows positive', () => {
    const { rows } = mapRows(table, { mapping, accountId: null, outflowPositive: true })
    expect(rows[0].amount).toBe(4.5)
    expect(rows[1].amount).toBe(-3000)
  })

  it('combines separate debit and credit columns', () => {
    const split = parseCsv(
      [
        'Date,Payee,Debit,Credit',
        '2026-08-12,Coffee,4.50,',
        '2026-08-13,Salary,,3000',
      ].join('\n'),
    )
    const { rows } = mapRows(split, {
      mapping: detectColumns(split.headers),
      accountId: null,
    })
    expect(rows[0].amount).toBe(-4.5)
    expect(rows[1].amount).toBe(3000)
  })

  it('skips unusable rows instead of importing rubbish', () => {
    const messy = parseCsv(
      [
        'Date,Description,Amount',
        'not a date,Coffee,-4.50',
        '2026-08-12,,-4.50',
        '2026-08-12,Zero,0',
      ].join('\n'),
    )
    const { rows, skipped } = mapRows(messy, {
      mapping: detectColumns(messy.headers),
      accountId: null,
    })
    expect(rows).toHaveLength(0)
    expect(skipped).toBe(3)
  })

  it('uses the file category when present, the default otherwise', () => {
    const withCategory = parseCsv(
      [
        'Date,Description,Amount,Category',
        '2026-08-12,Coffee,-4.50,Dining',
        '2026-08-13,Thing,-1,',
      ].join('\n'),
    )
    const { rows } = mapRows(withCategory, {
      mapping: detectColumns(withCategory.headers),
      accountId: null,
      defaultCategory: 'Other',
    })
    expect(rows[0].category).toBe('Dining')
    expect(rows[1].category).toBe('Other')
  })
})

describe('dedupe', () => {
  const existing = [
    {
      id: 't1',
      account_id: null,
      date: '2026-08-12',
      name: 'Coffee',
      merchant: null,
      amount: -4.5,
      category: 'Dining',
      pending: false,
      plaid_transaction_id: null,
      notes: null,
    } satisfies Transaction,
  ]

  const incoming = [
    { date: '2026-08-12', name: 'Coffee', amount: -4.5 },
    { date: '2026-08-13', name: 'Lunch', amount: -12 },
  ].map((r) => ({
    ...r,
    account_id: null,
    merchant: null,
    category: 'Other',
    pending: false,
    plaid_transaction_id: null,
    notes: null,
  }))

  it('drops rows that already exist', () => {
    // Bank exports overlap month to month; without this the overlap doubles.
    const { unique, duplicates } = dedupe(incoming, existing)
    expect(duplicates).toBe(1)
    expect(unique.map((r) => r.name)).toEqual(['Lunch'])
  })

  it('ignores case and padding when comparing', () => {
    const { duplicates } = dedupe([{ ...incoming[0], name: '  COFFEE ' }], existing)
    expect(duplicates).toBe(1)
  })

  it('drops duplicates inside the same file', () => {
    const { unique } = dedupe([incoming[1], incoming[1]], [])
    expect(unique).toHaveLength(1)
  })
})
