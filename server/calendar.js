import { safeFetch } from './urlguard.js'

/**
 * ICS calendar subscription.
 *
 * Read-only and no OAuth: Google, Apple and Outlook all expose a secret ICS
 * URL, which is far less setup than an OAuth app for something the dashboard
 * only ever reads. Fetched here rather than in the browser because calendar
 * hosts do not send CORS headers.
 *
 * The URL is user-supplied, so every fetch goes through the SSRF guard.
 */

const cache = new Map()
const CACHE_TTL_MS = 10 * 60 * 1000

/* ------------------------------------------------------------------ */
/* Parsing (pure — unit tested)                                        */
/* ------------------------------------------------------------------ */

/**
 * Undoes RFC 5545 line folding: continuation lines begin with a space or tab
 * and belong to the previous line.
 */
export function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '')
}

function unescapeText(value) {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

/**
 * Parses an ICS date-time. Values come in three shapes:
 *   20260812T090000Z  — UTC
 *   20260812T090000   — floating or zoned local time
 *   20260812          — a whole day
 */
export function parseIcsDate(value, params = '') {
  if (!value) return null

  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value)
  if (dateOnly) {
    const [, y, m, d] = dateOnly
    return { date: new Date(Number(y), Number(m) - 1, Number(d)), allDay: true }
  }

  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value)
  if (!dateTime) return null

  const [, y, m, d, hh, mm, ss, zulu] = dateTime.map((v) => v)
  if (zulu) {
    return {
      date: new Date(
        Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)),
      ),
      allDay: false,
    }
  }

  // Without a Z the time is local to the calendar's timezone. Without a full
  // tz database that cannot be converted exactly, so it is treated as local —
  // correct for the common case where the feed matches the reader's zone.
  void params
  return {
    date: new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)),
    allDay: false,
  }
}

/**
 * Extracts VEVENTs. Recurrence rules are intentionally not expanded — a
 * partial RRULE implementation that silently drops or duplicates occurrences
 * is worse than not claiming to support them.
 */
export function parseIcs(text, { label = 'Calendar' } = {}) {
  const lines = unfold(text).split('\n')
  const events = []
  let current = null

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    if (line === 'BEGIN:VEVENT') {
      current = {}
      continue
    }

    if (line === 'END:VEVENT') {
      if (current?.start) {
        events.push({
          id: `ics:${label}:${current.uid ?? `${current.start.date.toISOString()}:${current.summary ?? ''}`}`,
          title: current.summary || '(no title)',
          start_at: current.start.date.toISOString(),
          end_at: current.end?.date.toISOString() ?? null,
          all_day: current.start.allDay,
          location: current.location ?? null,
          source: label,
          recurring: Boolean(current.rrule),
        })
      }
      current = null
      continue
    }

    if (!current) continue

    const separator = line.indexOf(':')
    if (separator === -1) continue

    const rawKey = line.slice(0, separator)
    const value = line.slice(separator + 1)
    const [name, ...paramParts] = rawKey.split(';')
    const params = paramParts.join(';')

    switch (name.toUpperCase()) {
      case 'UID':
        current.uid = value
        break
      case 'SUMMARY':
        current.summary = unescapeText(value)
        break
      case 'LOCATION':
        current.location = unescapeText(value) || null
        break
      case 'DTSTART':
        current.start = parseIcsDate(value, params)
        break
      case 'DTEND':
        current.end = parseIcsDate(value, params)
        break
      case 'RRULE':
        current.rrule = value
        break
      default:
        break
    }
  }

  return events
}

/** Keeps the payload small: only what the dashboard actually shows. */
export function withinWindow(events, { from, to }) {
  return events
    .filter((event) => {
      const start = new Date(event.start_at).getTime()
      return start >= from.getTime() && start <= to.getTime()
    })
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
}

/* ------------------------------------------------------------------ */
/* Fetching                                                            */
/* ------------------------------------------------------------------ */

export async function fetchCalendar(url, { label = 'Calendar', force = false } = {}) {
  const cached = cache.get(url)
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.events
  }

  const response = await safeFetch(url, {
    headers: { 'User-Agent': 'LifeDashboard/1.0 (personal use)' },
  })
  if (!response.ok) {
    throw new Error(`Calendar responded ${response.status}`)
  }

  const text = await response.text()
  if (!text.includes('BEGIN:VCALENDAR')) {
    throw new Error('That URL did not return an iCalendar feed.')
  }

  const events = parseIcs(text, { label })
  cache.set(url, { at: Date.now(), events })
  return events
}
