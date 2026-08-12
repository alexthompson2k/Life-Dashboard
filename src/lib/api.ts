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
