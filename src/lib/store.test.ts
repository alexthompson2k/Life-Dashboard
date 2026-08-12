import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * These cover the local backend, which is what runs whenever Supabase keys are
 * absent. `import.meta.env` has no VITE_SUPABASE_* values under test, so
 * `isCloudMode` is false and every call below takes the localStorage path.
 */

/**
 * Mirrors the real localStorage: methods live on the prototype and entries are
 * own enumerable properties, so `Object.keys(localStorage)` returns just the
 * stored keys — which is what the clear/export helpers rely on.
 */
class MemoryStorage {
  private entries(): Record<string, string> {
    return this as unknown as Record<string, string>
  }
  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this, key) ? this.entries()[key] : null
  }
  setItem(key: string, value: string) {
    this.entries()[key] = String(value)
  }
  removeItem(key: string) {
    delete this.entries()[key]
  }
  clear() {
    for (const key of Object.keys(this)) this.removeItem(key)
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('crypto', { randomUUID: () => `id-${Math.random().toString(36).slice(2)}` })
  vi.resetModules()
})

describe('local CRUD', () => {
  it('round-trips an insert through a list', async () => {
    const { insertRow, listTable } = await import('./store')

    const saved = await insertRow('tasks', {
      title: 'Call the dentist',
      notes: null,
      due_date: '2026-08-12',
      due_time: null,
      priority: 'high',
      completed: false,
      completed_at: null,
      list: 'Inbox',
      recurrence: 'none',
      created_at: '2026-08-12T00:00:00.000Z',
    })

    expect(saved.id).toBeTruthy()
    const rows = await listTable('tasks')
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('Call the dentist')
  })

  it('honours a caller-supplied id instead of generating one', async () => {
    const { insertRow } = await import('./store')
    const saved = await insertRow('budgets', {
      id: 'fixed-id',
      category: 'Dining',
      monthly_limit: 100,
    })
    expect(saved.id).toBe('fixed-id')
  })

  it('patches only the fields given', async () => {
    const { insertRow, updateRow, listTable } = await import('./store')

    const saved = await insertRow('budgets', { category: 'Dining', monthly_limit: 100 })
    await updateRow('budgets', saved.id, { monthly_limit: 250 })

    const [row] = await listTable('budgets')
    expect(row.monthly_limit).toBe(250)
    expect(row.category).toBe('Dining')
  })

  it('deletes only the row asked for', async () => {
    const { insertRow, deleteRow, listTable } = await import('./store')

    const a = await insertRow('budgets', { category: 'Dining', monthly_limit: 100 })
    await insertRow('budgets', { category: 'Groceries', monthly_limit: 500 })
    await deleteRow('budgets', a.id)

    const rows = await listTable('budgets')
    expect(rows.map((r) => r.category)).toEqual(['Groceries'])
  })

  it('returns an empty list for a table never written to', async () => {
    const { listTable } = await import('./store')
    expect(await listTable('goals')).toEqual([])
  })

  it('survives corrupt stored JSON rather than throwing', async () => {
    localStorage.setItem('ld.local.tasks', '{not json')
    const { listTable } = await import('./store')
    expect(await listTable('tasks')).toEqual([])
  })
})

describe('seeding', () => {
  it('populates every table on first run', async () => {
    const { ensureSeeded, listTable } = await import('./store')
    ensureSeeded()

    expect((await listTable('accounts')).length).toBeGreaterThan(0)
    expect((await listTable('transactions')).length).toBeGreaterThan(0)
    expect((await listTable('habits')).length).toBeGreaterThan(0)
  })

  it('does not re-seed over existing data', async () => {
    const { ensureSeeded, insertRow, listTable } = await import('./store')
    ensureSeeded()
    await insertRow('budgets', { category: 'Custom', monthly_limit: 1 })
    const before = (await listTable('budgets')).length

    ensureSeeded()
    expect((await listTable('budgets')).length).toBe(before)
  })

  it('re-seeds when forced', async () => {
    const { ensureSeeded, insertRow, listTable } = await import('./store')
    ensureSeeded()
    await insertRow('budgets', { category: 'Custom', monthly_limit: 1 })

    ensureSeeded(true)
    const categories = (await listTable('budgets')).map((b) => b.category)
    expect(categories).not.toContain('Custom')
  })
})

describe('backup', () => {
  it('exports and re-imports every table', async () => {
    const { ensureSeeded, exportAllData, importAllData, clearLocalData, listTable } =
      await import('./store')

    ensureSeeded()
    const before = (await listTable('transactions')).length
    const backup = await exportAllData()

    clearLocalData()
    expect(await listTable('transactions')).toEqual([])

    await importAllData(backup)
    expect((await listTable('transactions')).length).toBe(before)
  })

  it('rejects a file that is not a dashboard backup', async () => {
    const { importAllData } = await import('./store')
    await expect(importAllData('{"nope":true}')).rejects.toThrow(/tables/)
  })

  it('rejects malformed JSON', async () => {
    const { importAllData } = await import('./store')
    await expect(importAllData('{{{')).rejects.toThrow()
  })
})
