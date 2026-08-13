import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Trash2 } from 'lucide-react'
import { useTable } from '../lib/store'
import { Button, Card, EmptyState, Field, Stat, useToast } from '../components/ui'
import { TimeSeriesChart } from '../components/charts'
import { toISODate } from '../lib/format'
import { useUndoableDelete } from '../lib/undo'

const MOODS = [
  { value: 1, emoji: '😞', label: 'Rough' },
  { value: 2, emoji: '😕', label: 'Low' },
  { value: 3, emoji: '😐', label: 'Fine' },
  { value: 4, emoji: '🙂', label: 'Good' },
  { value: 5, emoji: '😄', label: 'Great' },
]

export default function Journal() {
  const journal = useTable('journal')
  const toast = useToast()
  const { removeRow } = useUndoableDelete()
  const today = toISODate()

  const existing = journal.rows.find((r) => r.date === today)

  const [mood, setMood] = useState(3)
  const [energy, setEnergy] = useState(3)
  const [entry, setEntry] = useState('')
  const [gratitude, setGratitude] = useState('')

  /*
   * Entries arrive asynchronously. Seeding the form from the first render left
   * it showing blank defaults even when today was already written — and saving
   * from there overwrote the real entry. Hydrate once the row appears, keyed on
   * its id so re-renders never clobber what is being typed.
   */
  const hydratedFrom = useRef<string | null>(null)
  useEffect(() => {
    if (!existing || hydratedFrom.current === existing.id) return
    hydratedFrom.current = existing.id
    setMood(existing.mood)
    setEnergy(existing.energy)
    setEntry(existing.entry)
    setGratitude(existing.gratitude ?? '')
  }, [existing])

  const sorted = useMemo(
    () => [...journal.rows].sort((a, b) => b.date.localeCompare(a.date)),
    [journal.rows],
  )

  const trend = useMemo(
    () =>
      [...journal.rows]
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-45)
        .map((r) => ({ date: r.date, mood: r.mood, energy: r.energy })),
    [journal.rows],
  )

  const last30 = sorted.slice(0, 30)
  const avgMood = last30.length ? last30.reduce((s, r) => s + r.mood, 0) / last30.length : 0
  const avgEnergy = last30.length
    ? last30.reduce((s, r) => s + r.energy, 0) / last30.length
    : 0

  const save = async () => {
    const payload = {
      date: today,
      mood,
      energy,
      entry: entry.trim(),
      gratitude: gratitude.trim() || null,
    }
    if (existing) {
      await journal.update(existing.id, payload)
    } else {
      await journal.insert(payload)
    }
    toast.push('Journal saved')
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Journal</h1>
        <p className="text-xs text-ink-secondary">
          {journal.rows.length} entries · a minute a day is enough
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Average mood (30d)"
          value={avgMood ? avgMood.toFixed(1) : '—'}
          hint="Out of 5"
          intent={
            avgMood >= 3.5 ? 'good' : avgMood > 0 && avgMood < 2.5 ? 'bad' : 'neutral'
          }
        />
        <Stat
          label="Average energy (30d)"
          value={avgEnergy ? avgEnergy.toFixed(1) : '—'}
          hint="Out of 5"
        />
        <Stat label="Entries logged" value={journal.rows.length} />
      </div>

      <Card
        title={existing ? "Today's entry" : 'How was today?'}
        subtitle={new Date().toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })}
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="label">Mood</p>
              <div className="flex gap-2">
                {MOODS.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setMood(m.value)}
                    className="flex flex-1 flex-col items-center gap-1 rounded-xl border px-2 py-2 transition-colors"
                    style={{
                      borderColor: mood === m.value ? 'var(--accent)' : 'var(--border)',
                      background: mood === m.value ? 'var(--surface-3)' : 'transparent',
                    }}
                    aria-pressed={mood === m.value}
                    aria-label={m.label}
                  >
                    <span className="text-lg">{m.emoji}</span>
                    <span className="text-[10px] text-ink-secondary">{m.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="label">Energy</p>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setEnergy(n)}
                    className="flex-1 rounded-xl border py-3 text-sm font-medium transition-colors"
                    style={{
                      borderColor: energy === n ? 'var(--accent)' : 'var(--border)',
                      background: energy === n ? 'var(--surface-3)' : 'transparent',
                      color: energy === n ? 'var(--text-primary)' : 'var(--text-secondary)',
                    }}
                    aria-pressed={energy === n}
                    aria-label={`Energy ${n} of 5`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Field label="What happened?">
            <textarea
              className="input min-h-[6rem]"
              placeholder="A couple of sentences is plenty."
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
            />
          </Field>

          <Field
            label="One good thing"
            hint="Optional, but it changes the tone of the entry"
          >
            <input
              className="input"
              value={gratitude}
              onChange={(e) => setGratitude(e.target.value)}
            />
          </Field>

          <Button variant="primary" onClick={() => void save()}>
            {existing ? 'Update entry' : 'Save entry'}
          </Button>
        </div>
      </Card>

      {trend.length > 1 && (
        <TimeSeriesChart
          title="Mood and energy"
          subtitle="Both on a 1–5 scale, so they share one axis"
          data={trend}
          xKey="date"
          xFormat={(v) =>
            new Date(v + 'T00:00:00').toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })
          }
          yFormat={(v) => v.toFixed(0)}
          yDomain={[1, 5]}
          series={[
            { key: 'mood', label: 'Mood', slot: 1, kind: 'line' },
            { key: 'energy', label: 'Energy', slot: 2, kind: 'line' },
          ]}
        />
      )}

      <Card title="Past entries">
        {sorted.length === 0 ? (
          <EmptyState icon={<BookOpen size={20} />} title="Nothing written yet" />
        ) : (
          <ul className="divide-y divide-line">
            {sorted.slice(0, 20).map((r) => (
              <li key={r.id} className="group py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-xs text-ink-secondary">
                      <span>{MOODS.find((m) => m.value === r.mood)?.emoji}</span>
                      {new Date(r.date + 'T00:00:00').toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                      <span className="text-ink-muted">energy {r.energy}/5</span>
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-ink-primary">
                      {r.entry}
                    </p>
                    {r.gratitude && (
                      <p className="mt-1 text-xs italic text-ink-secondary">
                        Grateful for: {r.gratitude}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => void removeRow('journal', r, journal.remove, 'Entry')}
                    className="btn btn-ghost !p-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    aria-label="Delete entry"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
