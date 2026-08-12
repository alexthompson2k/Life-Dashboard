import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, Newspaper, RefreshCw } from 'lucide-react'
import { useSettings } from '../lib/settings'
import { Button, Callout, Card, EmptyState, SegmentedControl, Skeleton } from '../components/ui'
import { fetchNews, NEWS_TOPICS, timeAgo, type NewsItem } from '../lib/news'

export default function News() {
  const { settings, save } = useSettings()
  const [items, setItems] = useState<NewsItem[]>([])
  const [failed, setFailed] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<string>('all')

  const topics = settings.news_topics

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchNews(topics, 15)
      setItems(res.items)
      setFailed(res.failed_topics)
    } catch (err) {
      setError((err as Error).message)
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [topics])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(
    () => (active === 'all' ? items : items.filter((i) => i.topic === active)),
    [items, active],
  )

  const toggleTopic = async (topic: string) => {
    const next = topics.includes(topic)
      ? topics.filter((t) => t !== topic)
      : [...topics, topic]
    if (next.length === 0) return
    await save({ news_topics: next })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">News</h1>
          <p className="text-xs text-ink-secondary">
            {items.length} stories across {topics.length} topics
          </p>
        </div>
        <Button onClick={() => void load()} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
        </Button>
      </div>

      <Card title="Your topics" subtitle="Pick the feeds you want on the dashboard">
        <div className="flex flex-wrap gap-2">
          {NEWS_TOPICS.map((topic) => {
            const on = topics.includes(topic)
            return (
              <button
                key={topic}
                onClick={() => void toggleTopic(topic)}
                className="chip transition-colors"
                style={
                  on
                    ? {
                        background: 'var(--accent)',
                        borderColor: 'transparent',
                        color: '#fff',
                      }
                    : undefined
                }
                aria-pressed={on}
              >
                {topic}
              </button>
            )
          })}
        </div>
      </Card>

      {error && (
        <Callout intent="warning">
          {error} The dashboard works fine without it — every other panel is unaffected.
        </Callout>
      )}

      {failed.length > 0 && (
        <Callout intent="info">
          Could not reach the feed for: {failed.join(', ')}. Showing what loaded.
        </Callout>
      )}

      {items.length > 1 && (
        <SegmentedControl
          size="sm"
          value={active}
          onChange={setActive}
          options={[
            { value: 'all', label: 'All' },
            ...[...new Set(items.map((i) => i.topic))].map((t) => ({ value: t, label: t })),
          ]}
        />
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Newspaper size={20} />}
            title="No stories loaded"
            description={
              error
                ? 'Start the API server with `npm run server` to pull feeds.'
                : 'Try a different topic or refresh.'
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visible.map((item) => (
            <a
              key={item.id}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="card group flex flex-col gap-2 p-4 transition-colors hover:bg-surface-2"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-sm font-medium leading-snug text-ink-primary">
                  {item.title}
                </h2>
                <ExternalLink
                  size={14}
                  className="mt-0.5 shrink-0 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100"
                />
              </div>
              {item.summary && (
                <p className="line-clamp-2 text-xs leading-relaxed text-ink-secondary">
                  {item.summary}
                </p>
              )}
              <div className="mt-auto flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
                <span className="chip !py-0.5">{item.topic}</span>
                <span>{item.source}</span>
                {item.published_at && <span>· {timeAgo(item.published_at)}</span>}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
