import { createClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client.
 *
 * This key bypasses row-level security, so it must never leave the server and
 * every query made with it has to filter by user_id explicitly — RLS is not
 * there to catch mistakes on this path.
 */

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export const supabaseConfigured = Boolean(url && serviceKey)

let client = null

export function serviceClient() {
  if (!supabaseConfigured) return null
  if (!client) {
    client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return client
}

/** Verifies a user access token and returns their id, or null. */
export async function userIdFromToken(token) {
  const admin = serviceClient()
  if (!admin || !token) return null
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user.id
}
