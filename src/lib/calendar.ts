import { apiJson } from './api'

/**
 * Subscribed calendar feeds.
 *
 * Read-only ICS rather than OAuth: every major calendar exposes a secret .ics
 * URL, which is far less setup for something the dashboard only reads. Fetched
 * through the API server because calendar hosts do not send CORS headers, and
 * because a user-supplied URL needs SSRF checks before anything fetches it.
 */

export interface CalendarFeed {
  label: string
  url: string
}

export interface RemoteEvent {
  id: string
  title: string
  start_at: string
  end_at: string | null
  all_day: boolean
  location: string | null
  source: string
  recurring: boolean
}

export async function fetchFeed(feed: CalendarFeed, { force = false } = {}) {
  const params = new URLSearchParams({ url: feed.url, label: feed.label })
  if (force) params.set('force', '1')
  const { events } = await apiJson<{ events: RemoteEvent[] }>(`/api/calendar?${params}`)
  return events
}

export interface FeedResult {
  events: RemoteEvent[]
  failed: Array<{ label: string; message: string }>
}

/** One bad feed should not hide the others. */
export async function fetchAllFeeds(
  feeds: CalendarFeed[],
  { force = false } = {},
): Promise<FeedResult> {
  if (feeds.length === 0) return { events: [], failed: [] }

  const results = await Promise.allSettled(feeds.map((feed) => fetchFeed(feed, { force })))
  const events: RemoteEvent[] = []
  const failed: Array<{ label: string; message: string }> = []

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') events.push(...result.value)
    else failed.push({ label: feeds[i].label, message: (result.reason as Error).message })
  })

  events.sort((a, b) => a.start_at.localeCompare(b.start_at))
  return { events, failed }
}
