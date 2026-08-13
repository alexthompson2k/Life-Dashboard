import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isCloudMode, supabase } from './supabase'
import { buildDemoData } from './demoData'
import type { TableName, Tables } from './types'

/**
 * One data layer over two backends.
 *
 * Cloud mode talks to Supabase (RLS scopes every row to the signed-in user).
 * Local mode persists to localStorage, seeded once from the demo dataset.
 * Pages only ever see `useTable`, so nothing above this file branches on which
 * backend is live.
 */

type AnyRow = { id: string }

const LOCAL_PREFIX = 'ld.local.'
const SEEDED_KEY = 'ld.seeded.v1'

/* ------------------------------------------------------------------ */
/* Cross-component sync                                                */
/* ------------------------------------------------------------------ */

const listeners = new Map<TableName, Set<() => void>>()

/**
 * Per-table result cache plus in-flight de-duplication.
 *
 * The Overview alone reads nine tables, and several of them are also read by
 * the page beside it. Without this, every mount and every write fired one
 * request per subscriber — so ticking a habit produced a `habit_logs` fetch
 * for each component watching it. Now N subscribers share one request.
 */
const cache = new Map<TableName, unknown[]>()
const inflight = new Map<TableName, Promise<unknown[]>>()

function subscribe(table: TableName, fn: () => void) {
  let set = listeners.get(table)
  if (!set) {
    set = new Set()
    listeners.set(table, set)
  }
  set.add(fn)
  return () => {
    set!.delete(fn)
  }
}

/** Invalidates the cache and asks every subscriber to reload. */
function notify(table: TableName) {
  cache.delete(table)
  inflight.delete(table)
  listeners.get(table)?.forEach((fn) => fn())
}

/** Drops all cached reads — used when the signed-in user changes. */
export function invalidateAll() {
  cache.clear()
  inflight.clear()
  for (const table of listeners.keys()) {
    listeners.get(table)?.forEach((fn) => fn())
  }
}

/* ------------------------------------------------------------------ */
/* Local backend                                                       */
/* ------------------------------------------------------------------ */

function localRead<K extends TableName>(table: K): Tables[K][] {
  try {
    const raw = localStorage.getItem(LOCAL_PREFIX + table)
    return raw ? (JSON.parse(raw) as Tables[K][]) : []
  } catch {
    return []
  }
}

function localWrite<K extends TableName>(table: K, rows: Tables[K][]) {
  try {
    localStorage.setItem(LOCAL_PREFIX + table, JSON.stringify(rows))
  } catch (err) {
    console.error(`Could not persist ${table}. Storage may be full.`, err)
  }
}

/** Seeds the demo dataset once. Safe to call on every boot. */
export function ensureSeeded(force = false) {
  if (!force && localStorage.getItem(SEEDED_KEY)) return
  const data = buildDemoData()
  for (const [table, rows] of Object.entries(data)) {
    localWrite(table as TableName, rows as never)
  }
  localStorage.setItem(SEEDED_KEY, new Date().toISOString())
  ;(Object.keys(data) as TableName[]).forEach(notify)
}

export function clearLocalData() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(LOCAL_PREFIX)) localStorage.removeItem(key)
  }
  localStorage.removeItem(SEEDED_KEY)
  // Wiping storage without dropping the read cache would leave the UI showing
  // rows that no longer exist.
  invalidateAll()
}

/* ------------------------------------------------------------------ */
/* Backup                                                              */
/* ------------------------------------------------------------------ */

/** Every table the backup covers, in an order that respects foreign keys. */
const ALL_TABLES: TableName[] = [
  'settings',
  'accounts',
  'transactions',
  'budgets',
  'tasks',
  'events',
  'weights',
  'workouts',
  'workout_sets',
  'habits',
  'habit_logs',
  'journal',
  'goals',
]

export interface BackupFile {
  exported_at: string
  version: number
  tables: Partial<Record<TableName, unknown[]>>
}

/**
 * Reads through the same abstraction the app uses, so a backup works in cloud
 * mode as well as locally. Without this, switching to Supabase would mean
 * losing the only escape hatch for your data.
 */
export async function exportAllData(): Promise<string> {
  const tables: Partial<Record<TableName, unknown[]>> = {}
  for (const table of ALL_TABLES) {
    tables[table] = await listTable(table)
  }
  const file: BackupFile = {
    exported_at: new Date().toISOString(),
    version: 1,
    tables,
  }
  return JSON.stringify(file, null, 2)
}

/**
 * Restores a backup. Rows are written through `insertRow`, which means cloud
 * mode stamps them with the signed-in user rather than trusting whatever
 * `user_id` the file carried.
 *
 * Ids are preserved so relationships (workout → sets, habit → logs) survive.
 * Importing into an account that already holds those ids will conflict, so the
 * caller should clear first — Settings does exactly that.
 */
export async function importAllData(json: string): Promise<{ imported: number }> {
  let parsed: BackupFile
  try {
    parsed = JSON.parse(json) as BackupFile
  } catch {
    throw new Error('That file is not valid JSON.')
  }

  if (!parsed || typeof parsed !== 'object' || !parsed.tables) {
    throw new Error('File is missing a "tables" object — is it a dashboard backup?')
  }

  let imported = 0
  for (const table of ALL_TABLES) {
    const rows = parsed.tables[table]
    if (!Array.isArray(rows)) continue

    if (!isCloudMode || !supabase) {
      // Local mode can write the whole table in one shot.
      localWrite(table, rows as never)
      notify(table)
      imported += rows.length
      continue
    }

    for (const row of rows) {
      const { user_id: _ignored, ...rest } = row as Record<string, unknown>
      await insertRow(table, rest as never)
      imported++
    }
  }

  if (!isCloudMode) localStorage.setItem(SEEDED_KEY, new Date().toISOString())
  return { imported }
}

/* ------------------------------------------------------------------ */
/* Reads / writes                                                      */
/* ------------------------------------------------------------------ */

function newId() {
  return crypto.randomUUID()
}

async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

async function fetchTable<K extends TableName>(table: K): Promise<Tables[K][]> {
  if (!isCloudMode || !supabase) return localRead(table)

  const { data, error } = await supabase.from(table).select('*')
  if (error) throw new Error(`Could not load ${table}: ${error.message}`)
  return (data ?? []) as Tables[K][]
}

/**
 * Reads a table, sharing both the cached result and any in-flight request
 * between callers. Pass `fresh` to force a round trip.
 */
export async function listTable<K extends TableName>(
  table: K,
  { fresh = false } = {},
): Promise<Tables[K][]> {
  if (fresh) {
    cache.delete(table)
    inflight.delete(table)
  } else {
    const cached = cache.get(table)
    if (cached) return cached as Tables[K][]
  }

  const existing = inflight.get(table)
  if (existing) return existing as Promise<Tables[K][]>

  const request = fetchTable(table)
    .then((rows) => {
      cache.set(table, rows)
      inflight.delete(table)
      return rows as unknown[]
    })
    .catch((err) => {
      inflight.delete(table)
      throw err
    })

  inflight.set(table, request)
  return request as Promise<Tables[K][]>
}

/** Synchronous peek at the cache, so a remount does not flash a spinner. */
function peek<K extends TableName>(table: K): Tables[K][] | null {
  return (cache.get(table) as Tables[K][] | undefined) ?? null
}

export async function insertRow<K extends TableName>(
  table: K,
  row: Omit<Tables[K], 'id'> & { id?: string },
): Promise<Tables[K]> {
  const withId = { ...row, id: row.id ?? newId() } as Tables[K] & AnyRow

  if (!isCloudMode || !supabase) {
    const rows = localRead(table)
    localWrite(table, [withId, ...rows] as Tables[K][])
    notify(table)
    return withId
  }

  const userId = await currentUserId()
  const { data, error } = await supabase
    .from(table)
    .insert({ ...withId, user_id: userId })
    .select()
    .single()
  if (error) throw new Error(`Could not save to ${table}: ${error.message}`)
  notify(table)
  return data as Tables[K]
}

export async function updateRow<K extends TableName>(
  table: K,
  id: string,
  patch: Partial<Tables[K]>,
): Promise<void> {
  if (!isCloudMode || !supabase) {
    const rows = localRead(table) as AnyRow[]
    localWrite(
      table,
      rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) as Tables[K][],
    )
    notify(table)
    return
  }

  // The generated row types are a union across tables; postgrest-js cannot
  // narrow that from `K`, so the patch is widened here.
  const { error } = await supabase
    .from(table)
    .update(patch as Record<string, unknown>)
    .eq('id', id)
  if (error) throw new Error(`Could not update ${table}: ${error.message}`)
  notify(table)
}

export async function deleteRow<K extends TableName>(table: K, id: string): Promise<void> {
  if (!isCloudMode || !supabase) {
    const rows = localRead(table) as AnyRow[]
    localWrite(table, rows.filter((r) => r.id !== id) as Tables[K][])
    notify(table)
    return
  }

  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) throw new Error(`Could not delete from ${table}: ${error.message}`)
  notify(table)
}

/* ------------------------------------------------------------------ */
/* React binding                                                       */
/* ------------------------------------------------------------------ */

export interface TableHandle<K extends TableName> {
  rows: Tables[K][]
  loading: boolean
  error: string | null
  insert: (row: Omit<Tables[K], 'id'> & { id?: string }) => Promise<Tables[K] | null>
  update: (id: string, patch: Partial<Tables[K]>) => Promise<void>
  remove: (id: string) => Promise<void>
  refresh: () => void
}

export function useTable<K extends TableName>(table: K): TableHandle<K> {
  // Seed from the shared cache so navigating back to a page shows its data
  // immediately instead of flashing an empty state.
  const [rows, setRows] = useState<Tables[K][]>(() => peek(table) ?? [])
  const [loading, setLoading] = useState(() => peek(table) === null)
  const [error, setError] = useState<string | null>(null)

  // A generation counter rather than a per-call cancel flag: a notify while a
  // read is in flight would otherwise leave the older response free to land
  // after the newer one and overwrite it.
  const generation = useRef(0)
  const mounted = useRef(true)

  const load = useCallback(
    (fresh = false) => {
      const run = ++generation.current
      listTable(table, { fresh })
        .then((data) => {
          if (!mounted.current || run !== generation.current) return
          setRows(data)
          setError(null)
        })
        .catch((err: Error) => {
          if (!mounted.current || run !== generation.current) return
          setError(err.message)
        })
        .finally(() => {
          if (mounted.current && run === generation.current) setLoading(false)
        })
    },
    [table],
  )

  useEffect(() => {
    mounted.current = true
    load()
    const unsub = subscribe(table, () => load())
    return () => {
      mounted.current = false
      unsub()
    }
  }, [table, load])

  /** Forces a round trip, bypassing the shared cache. */
  const refresh = useCallback(() => load(true), [load])

  const insert = useCallback(
    async (row: Omit<Tables[K], 'id'> & { id?: string }) => {
      try {
        return await insertRow(table, row)
      } catch (err) {
        setError((err as Error).message)
        return null
      }
    },
    [table],
  )

  const update = useCallback(
    async (id: string, patch: Partial<Tables[K]>) => {
      try {
        await updateRow(table, id, patch)
      } catch (err) {
        setError((err as Error).message)
      }
    },
    [table],
  )

  const remove = useCallback(
    async (id: string) => {
      try {
        await deleteRow(table, id)
      } catch (err) {
        setError((err as Error).message)
      }
    },
    [table],
  )

  return useMemo(
    () => ({ rows, loading, error, insert, update, remove, refresh }),
    [rows, loading, error, insert, update, remove, refresh],
  )
}
