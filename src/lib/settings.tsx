import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTable } from './store'
import type { Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings_local',
  display_name: '',
  unit_system: 'imperial',
  currency: 'USD',
  location_name: 'San Francisco, CA',
  latitude: 37.7749,
  longitude: -122.4194,
  news_topics: ['Top stories', 'Technology', 'Business', 'Science'],
  week_starts_on: 1,
}

interface SettingsContextValue {
  settings: Settings
  loading: boolean
  save: (patch: Partial<Settings>) => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const table = useTable('settings')
  const [creating, setCreating] = useState(false)

  const settings = useMemo<Settings>(
    () => ({ ...DEFAULT_SETTINGS, ...(table.rows[0] ?? {}) }),
    [table.rows],
  )

  // A brand-new cloud account has no settings row yet; create one on first load.
  useEffect(() => {
    if (table.loading || creating || table.rows.length > 0) return
    setCreating(true)
    const { id: _id, ...rest } = DEFAULT_SETTINGS
    void table.insert(rest).finally(() => setCreating(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.loading, table.rows.length])

  const save = useCallback(
    async (patch: Partial<Settings>) => {
      const existing = table.rows[0]
      if (existing) {
        await table.update(existing.id, patch)
      } else {
        const { id: _id, ...rest } = DEFAULT_SETTINGS
        await table.insert({ ...rest, ...patch })
      }
    },
    [table],
  )

  const value = useMemo(
    () => ({ settings, loading: table.loading, save }),
    [settings, table.loading, save],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>')
  return ctx
}
