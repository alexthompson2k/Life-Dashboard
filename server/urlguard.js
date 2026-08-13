import { lookup } from 'node:dns/promises'
import net from 'node:net'

/**
 * SSRF protection for user-supplied URLs.
 *
 * The calendar endpoint fetches whatever URL the user configures. Without this,
 * anyone who can set that URL can make the server issue requests to hosts the
 * browser could never reach — cloud metadata endpoints (169.254.169.254),
 * localhost admin panels, private network ranges — and read the response.
 *
 * The check has to happen *after* DNS resolution, because a public hostname can
 * resolve to a private address. It is deliberately an allowlist of schemes plus
 * a denylist of resolved ranges, and it re-checks every redirect hop.
 */

const ALLOWED_PROTOCOLS = new Set(['https:', 'http:'])

/** Ranges that must never be reachable from a user-supplied URL. */
function isBlockedAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 0) return true // "this" network
    if (a === 10) return true // private
    if (a === 127) return true // loopback
    if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true // private
    if (a === 192 && b === 168) return true // private
    if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
    if (a >= 224) return true // multicast and reserved
    return false
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase()
    if (normalized === '::1' || normalized === '::') return true // loopback / unspecified
    if (normalized.startsWith('fe80')) return true // link-local
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true // unique local
    // IPv4-mapped addresses (::ffff:10.0.0.1) must be checked as IPv4.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)
    if (mapped) return isBlockedAddress(mapped[1])
    return false
  }

  // Anything unparseable is refused rather than assumed safe.
  return true
}

export class BlockedUrlError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BlockedUrlError'
  }
}

/** Throws BlockedUrlError unless the URL is safe for the server to fetch. */
export async function assertPublicUrl(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new BlockedUrlError('That is not a valid URL.')
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new BlockedUrlError('Only http and https URLs are allowed.')
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '')

  // A literal IP skips DNS entirely.
  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new BlockedUrlError('That address is not reachable from the server.')
    }
    return url
  }

  let records
  try {
    records = await lookup(hostname, { all: true })
  } catch {
    throw new BlockedUrlError('That hostname could not be resolved.')
  }

  if (!records.length) throw new BlockedUrlError('That hostname could not be resolved.')

  // Every resolved address must be safe: one private answer among several is
  // enough for a DNS-rebinding attempt to succeed.
  for (const record of records) {
    if (isBlockedAddress(record.address)) {
      throw new BlockedUrlError('That address is not reachable from the server.')
    }
  }

  return url
}

/**
 * Fetch that re-validates on every redirect. `fetch` with the default
 * `redirect: 'follow'` would happily follow a public URL to a private one, so
 * redirects are handled manually.
 */
export async function safeFetch(
  rawUrl,
  { maxRedirects = 3, timeoutMs = 10000, headers = {} } = {},
) {
  let target = rawUrl

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicUrl(target)

    const response = await fetch(url, {
      redirect: 'manual',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return response
      target = new URL(location, url).toString()
      continue
    }

    return response
  }

  throw new BlockedUrlError('Too many redirects.')
}

export { isBlockedAddress }
