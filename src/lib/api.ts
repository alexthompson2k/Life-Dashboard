import { supabase } from './supabase'

/**
 * Base URL for the API server (Plaid + news).
 *
 * In development the Vite dev server proxies /api, so the default empty base
 * (same origin) is correct. Set VITE_API_BASE_URL when the built frontend is
 * hosted somewhere the API server is not — e.g. static hosting plus a
 * separately deployed server.
 */
const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export function apiUrl(path: string) {
  const suffix = path.startsWith('/') ? path : `/${path}`
  return BASE ? `${BASE}${suffix}` : suffix
}

/** True when the failure means "the API server isn't reachable". */
export function isServerUnreachable(res: Response) {
  return res.status === 404 || res.status === 502 || res.status === 503
}

/**
 * Calls a user-scoped endpoint with the Supabase access token attached.
 *
 * The server derives the user from this token and never from anything in the
 * request body, so a caller cannot act on another account's data.
 */
export async function apiFetch(
  path: string,
  {
    method = 'GET',
    body,
    signal,
  }: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<Response> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
  const token = data.session?.access_token
  if (!token) {
    throw new Error(
      'You need to be signed in for this. Add your Supabase keys to enable it.',
    )
  }

  return fetch(apiUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  })
}

/** Same, but unwraps JSON and turns a non-2xx into a readable Error. */
export async function apiJson<T>(
  path: string,
  options?: { method?: string; body?: unknown; signal?: AbortSignal },
): Promise<T> {
  const res = await apiFetch(path, options)
  const payload = (await res.json().catch(() => ({}))) as T & { error?: string }

  if (!res.ok) {
    if (isServerUnreachable(res) && !payload.error) {
      throw new Error('The API server is not running. Start it with `npm run server`.')
    }
    throw new Error(payload.error ?? `Request failed (${res.status}).`)
  }
  return payload
}
