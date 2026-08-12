import { apiUrl, isServerUnreachable } from './api'

export interface NewsItem {
  id: string
  title: string
  link: string
  source: string
  topic: string
  published_at: string | null
  summary: string | null
}

export interface NewsResponse {
  items: NewsItem[]
  fetched_at: string
  failed_topics: string[]
}

/** Topics the API server knows how to resolve to a feed. */
export const NEWS_TOPICS = [
  'Top stories',
  'World',
  'Business',
  'Technology',
  'Science',
  'Health',
  'Sports',
  'Entertainment',
  'Markets',
] as const

export type NewsTopic = (typeof NEWS_TOPICS)[number]

/**
 * Feeds are fetched through the API server rather than the browser: RSS hosts
 * do not send CORS headers, so a direct fetch would be blocked.
 */
export async function fetchNews(topics: string[], limit = 12): Promise<NewsResponse> {
  const params = new URLSearchParams({ topics: topics.join(','), limit: String(limit) })

  let res: Response
  try {
    res = await fetch(`${apiUrl('/api/news')}?${params}`)
  } catch {
    throw new Error('The news service is not running. Start it with `npm run server`.')
  }

  if (!res.ok) {
    if (isServerUnreachable(res)) {
      throw new Error('The news service is not running. Start it with `npm run server`.')
    }
    const detail = await res.text().catch(() => '')
    throw new Error(`News service returned ${res.status}. ${detail}`.trim())
  }
  return (await res.json()) as NewsResponse
}

export function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
