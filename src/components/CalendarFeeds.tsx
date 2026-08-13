import { useState } from 'react'
import { CalendarPlus, Trash2 } from 'lucide-react'
import { useSettings } from '../lib/settings'
import { isCloudMode } from '../lib/supabase'
import { fetchFeed } from '../lib/calendar'
import { Button, Callout, Card, Field, useToast } from './ui'

/**
 * Subscribing to a calendar. A hand-maintained calendar goes stale within a
 * week, so this is the difference between the calendar being useful and being
 * decoration.
 */
export function CalendarFeeds() {
  const { settings, save } = useSettings()
  const toast = useToast()
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const feeds = settings.calendar_feeds ?? []

  const add = async () => {
    const trimmedUrl = url.trim()
    if (!trimmedUrl) return

    setBusy(true)
    try {
      const feed = { label: label.trim() || 'Calendar', url: trimmedUrl }
      // Fetch once before saving: a URL that does not work should fail here,
      // not silently produce an empty calendar later.
      const events = await fetchFeed(feed)
      await save({ calendar_feeds: [...feeds, feed] })
      toast.push(`Added ${feed.label} — ${events.length} events found`)
      setLabel('')
      setUrl('')
    } catch (err) {
      toast.push((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (target: string) => {
    await save({ calendar_feeds: feeds.filter((f) => f.url !== target) })
    toast.push('Calendar removed')
  }

  return (
    <Card
      title="Calendar subscriptions"
      subtitle="Read-only ICS feeds from Google, Apple or Outlook"
    >
      <div className="space-y-3">
        {!isCloudMode ? (
          <Callout intent="info">
            Calendar feeds are fetched by the API server, which needs cloud mode to know
            whose calendars to read. Manually added events work either way.
          </Callout>
        ) : (
          <>
            {feeds.length > 0 && (
              <ul className="divide-y divide-line">
                {feeds.map((feed) => (
                  <li
                    key={feed.url}
                    className="flex items-center justify-between gap-3 py-2 first:pt-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-ink-primary">{feed.label}</p>
                      <p className="truncate text-[11px] text-ink-muted">{feed.url}</p>
                    </div>
                    <button
                      onClick={() => void remove(feed.url)}
                      className="btn btn-ghost !p-1.5"
                      aria-label={`Remove ${feed.label}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
              <Field label="Name">
                <input
                  className="input"
                  placeholder="Work"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </Field>
              <Field label="Secret iCal address">
                <input
                  className="input"
                  placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
            </div>

            <Button
              variant="primary"
              onClick={() => void add()}
              disabled={busy || !url.trim()}
            >
              <CalendarPlus size={15} /> {busy ? 'Checking…' : 'Add calendar'}
            </Button>

            <p className="text-[11px] leading-relaxed text-ink-muted">
              In Google Calendar: Settings → your calendar → “Secret address in iCal
              format”. Anyone with that URL can read the calendar, so treat it like a
              password. Events are shown read-only, and repeating events appear on their
              first date only — expanding recurrence rules half-correctly would be worse
              than not doing it.
            </p>
          </>
        )}
      </div>
    </Card>
  )
}
