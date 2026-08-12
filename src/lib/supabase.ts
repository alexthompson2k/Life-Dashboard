import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * Supabase is optional at runtime. With no keys the app runs against the local
 * demo store instead, so the dashboard is usable (and reviewable) before any
 * cloud setup happens. Everything else in the app reads `isCloudMode` rather
 * than checking for keys itself.
 */
export const isCloudMode = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = isCloudMode
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local',
    )
  }
  return supabase
}
