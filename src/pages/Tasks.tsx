import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Plus,
  Trash2,
} from 'lucide-react'
import { useTable } from '../lib/store'
import { useSettings } from '../lib/settings'
import {
  Button,
  Callout,
  Card,
  EmptyState,
  Field,
  Modal,
  SegmentedControl,
  Select,
  Stat,
  useToast,
} from '../components/ui'
import { usePalette, slotColor } from '../components/charts'
import { fromISODate, relativeDay, toISODate } from '../lib/format'
import { useUndoableDelete } from '../lib/undo'
import { fetchAllFeeds, type RemoteEvent } from '../lib/calendar'
import type { CalendarEvent, Priority, Recurrence, Task } from '../lib/types'

/** A local event or one from a subscribed feed; feed events cannot be edited. */
type DisplayEvent = CalendarEvent & { readOnly: boolean; source?: string }

const PRIORITY_SLOT: Record<Priority, number> = { high: 8, medium: 4, low: 3 }
const PRIORITY_LABEL: Record<Priority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export default function TasksPage() {
  const tasks = useTable('tasks')
  const events = useTable('events')
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [adding, setAdding] = useState(false)

  const today = toISODate()
  const open = tasks.rows.filter((t) => !t.completed)
  const overdue = open.filter((t) => t.due_date && t.due_date < today)
  const dueToday = open.filter((t) => t.due_date === today)
  const completedToday = tasks.rows.filter(
    (t) => t.completed && t.completed_at?.slice(0, 10) === today,
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Tasks &amp; Calendar</h1>
          <p className="text-xs text-ink-secondary">
            {open.length} open · {completedToday.length} done today
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedControl
            value={view}
            onChange={setView}
            options={[
              { value: 'list', label: 'List' },
              { value: 'calendar', label: 'Calendar' },
            ]}
          />
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus size={15} /> New
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Due today"
          value={dueToday.length}
          hint={dueToday.length === 0 ? 'Nothing scheduled' : undefined}
        />
        <Stat
          label="Overdue"
          value={overdue.length}
          intent={overdue.length > 0 ? 'bad' : 'good'}
          hint={overdue.length > 0 ? 'Reschedule or clear these first' : 'All caught up'}
        />
        <Stat label="Completed today" value={completedToday.length} intent="good" />
      </div>

      {view === 'list' ? (
        <ListView tasks={tasks} />
      ) : (
        <CalendarView tasks={tasks.rows} events={events} />
      )}

      <NewItemModal
        open={adding}
        onClose={() => setAdding(false)}
        onSaveTask={async (row) => {
          await tasks.insert(row)
        }}
        onSaveEvent={async (row) => {
          await events.insert(row)
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function ListView({ tasks }: { tasks: ReturnType<typeof useTable<'tasks'>> }) {
  const toast = useToast()
  const { removeRow } = useUndoableDelete()
  const [filter, setFilter] = useState<'open' | 'today' | 'all'>('open')
  const [list, setList] = useState('all')

  const today = toISODate()
  const lists = useMemo(
    () => [...new Set(tasks.rows.map((t) => t.list))].sort(),
    [tasks.rows],
  )

  const visible = useMemo(() => {
    return tasks.rows
      .filter((t) => {
        if (filter === 'open') return !t.completed
        if (filter === 'today')
          return !t.completed && t.due_date !== null && t.due_date <= today
        return true
      })
      .filter((t) => (list === 'all' ? true : t.list === list))
      .sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1
        // Undated tasks sink below dated ones rather than sorting as "oldest".
        if (!a.due_date && !b.due_date) return 0
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return a.due_date.localeCompare(b.due_date)
      })
  }, [tasks.rows, filter, list, today])

  const grouped = useMemo(() => {
    const groups = new Map<string, Task[]>()
    for (const task of visible) {
      const key = task.completed
        ? 'Completed'
        : !task.due_date
          ? 'Someday'
          : task.due_date < today
            ? 'Overdue'
            : relativeDay(task.due_date)
      const bucket = groups.get(key) ?? []
      bucket.push(task)
      groups.set(key, bucket)
    }
    // Overdue first, completed last; everything else keeps insertion order.
    return [...groups.entries()].sort(([a], [b]) => {
      const rank = (k: string) =>
        k === 'Overdue' ? -1 : k === 'Completed' ? 2 : k === 'Someday' ? 1 : 0
      return rank(a) - rank(b)
    })
  }, [visible, today])

  const toggle = async (task: Task) => {
    await tasks.update(task.id, {
      completed: !task.completed,
      completed_at: task.completed ? null : new Date().toISOString(),
    })
    if (!task.completed && task.recurrence !== 'none' && task.due_date) {
      // A recurring task rolls forward rather than disappearing.
      const next = nextOccurrence(task.due_date, task.recurrence)
      await tasks.insert({
        ...task,
        id: undefined,
        due_date: next,
        completed: false,
        completed_at: null,
        created_at: new Date().toISOString(),
      } as Omit<Task, 'id'>)
      toast.push(`Rescheduled for ${relativeDay(next)}`)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'today', label: 'Due now' },
            { value: 'all', label: 'All' },
          ]}
        />
        <div className="w-40">
          <Select
            value={list}
            onChange={(e) => setList(e.target.value)}
            options={[
              { value: 'all', label: 'All lists' },
              ...lists.map((l) => ({ value: l, label: l })),
            ]}
          />
        </div>
      </div>

      {grouped.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Check size={20} />}
            title="Nothing to do here"
            description="Add a task, or switch the filter to see completed ones."
          />
        </Card>
      ) : (
        // One card with sticky day headings, rather than a card per day —
        // a week of single-task days should not take a full screen of scroll.
        <Card bodyClassName="!p-0">
          {grouped.map(([group, items]) => (
            <section key={group}>
              <h2
                className="sticky top-[57px] z-10 flex items-baseline justify-between gap-2 border-b border-line bg-surface-2/95 px-5 py-2 text-xs font-semibold text-ink-primary backdrop-blur"
                style={
                  group === 'Overdue' ? { color: 'var(--status-critical)' } : undefined
                }
              >
                {group}
                <span className="text-[11px] font-normal text-ink-muted">
                  {items.length} item{items.length === 1 ? '' : 's'}
                </span>
              </h2>
              <ul className="divide-y divide-line px-5">
                {items.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onToggle={() => void toggle(task)}
                    onDelete={() => void removeRow('tasks', task, tasks.remove, 'Task')}
                  />
                ))}
              </ul>
            </section>
          ))}
        </Card>
      )}
    </div>
  )
}

function TaskRow({
  task,
  onToggle,
  onDelete,
}: {
  task: Task
  onToggle: () => void
  onDelete: () => void
}) {
  const palette = usePalette()
  return (
    <li className="group flex items-start gap-3 py-2.5">
      <button
        onClick={onToggle}
        className="mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border transition-colors"
        style={{
          borderColor: task.completed ? 'var(--status-good)' : 'var(--border)',
          background: task.completed ? 'var(--status-good)' : 'transparent',
        }}
        aria-label={
          task.completed ? `Mark ${task.title} as not done` : `Complete ${task.title}`
        }
      >
        {task.completed && <Check size={12} className="text-white" />}
      </button>

      <div className="min-w-0 flex-1">
        <p
          className={`text-sm ${
            task.completed ? 'text-ink-muted line-through' : 'text-ink-primary'
          }`}
        >
          {task.title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-secondary">
          <span className="flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background: slotColor(palette, PRIORITY_SLOT[task.priority]),
              }}
            />
            {PRIORITY_LABEL[task.priority]}
          </span>
          <span>{task.list}</span>
          {task.due_date && (
            <span className="flex items-center gap-1">
              <CalendarDays size={11} />
              {relativeDay(task.due_date)}
              {task.due_time && ` · ${task.due_time}`}
            </span>
          )}
          {task.recurrence !== 'none' && (
            <span className="chip !py-0.5">{task.recurrence}</span>
          )}
        </div>
        {task.notes && <p className="mt-1 text-xs text-ink-muted">{task.notes}</p>}
      </div>

      <button
        onClick={onDelete}
        className="btn btn-ghost !p-1 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
        aria-label={`Delete ${task.title}`}
      >
        <Trash2 size={14} />
      </button>
    </li>
  )
}

function nextOccurrence(iso: string, recurrence: Recurrence) {
  const d = fromISODate(iso)
  switch (recurrence) {
    case 'daily':
      d.setDate(d.getDate() + 1)
      break
    case 'weekdays':
      do {
        d.setDate(d.getDate() + 1)
      } while (d.getDay() === 0 || d.getDay() === 6)
      break
    case 'weekly':
      d.setDate(d.getDate() + 7)
      break
    case 'monthly':
      d.setMonth(d.getMonth() + 1)
      break
    default:
      break
  }
  return toISODate(d)
}

/* ------------------------------------------------------------------ */

function CalendarView({
  tasks,
  events,
}: {
  tasks: Task[]
  events: ReturnType<typeof useTable<'events'>>
}) {
  const { settings } = useSettings()
  const palette = usePalette()
  const { removeRow } = useUndoableDelete()

  /*
   * Subscribed ICS feeds are merged in read-only. They are kept separate from
   * the `events` table rather than copied into it: the feed is the source of
   * truth, so importing would immediately drift.
   */
  const [remote, setRemote] = useState<RemoteEvent[]>([])
  const [feedErrors, setFeedErrors] = useState<Array<{ label: string; message: string }>>(
    [],
  )

  useEffect(() => {
    let cancelled = false
    const feeds = settings.calendar_feeds ?? []
    if (feeds.length === 0) {
      setRemote([])
      setFeedErrors([])
      return
    }
    void fetchAllFeeds(feeds).then((result) => {
      if (cancelled) return
      setRemote(result.events)
      setFeedErrors(result.failed)
    })
    return () => {
      cancelled = true
    }
  }, [settings.calendar_feeds])
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [selected, setSelected] = useState(toISODate())

  const weekStart = settings.week_starts_on
  const monthName = cursor.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  const grid = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const offset = (first.getDay() - weekStart + 7) % 7
    const start = new Date(first)
    start.setDate(start.getDate() - offset)

    const days: string[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      days.push(toISODate(d))
    }
    return days
  }, [cursor, weekStart])

  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      if (!t.due_date) continue
      const list = map.get(t.due_date) ?? []
      list.push(t)
      map.set(t.due_date, list)
    }
    return map
  }, [tasks])

  const eventsByDate = useMemo(() => {
    const map = new Map<string, DisplayEvent[]>()

    const add = (event: DisplayEvent) => {
      // Group by local date, not the UTC prefix of the timestamp — an evening
      // event would otherwise land on the following day west of UTC.
      const key = toISODate(new Date(event.start_at))
      const list = map.get(key) ?? []
      list.push(event)
      map.set(key, list)
    }

    for (const e of events.rows) add({ ...e, readOnly: false })
    for (const e of remote) {
      add({
        id: e.id,
        title: e.title,
        start_at: e.start_at,
        end_at: e.end_at,
        all_day: e.all_day,
        location: e.location,
        color_slot: 7,
        readOnly: true,
        source: e.source,
      })
    }

    for (const list of map.values())
      list.sort((a, b) => a.start_at.localeCompare(b.start_at))
    return map
  }, [events.rows, remote])

  const dayNames = useMemo(() => {
    const base = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return [...base.slice(weekStart), ...base.slice(0, weekStart)]
  }, [weekStart])

  const today = toISODate()
  const selectedTasks = tasksByDate.get(selected) ?? []
  const selectedEvents = eventsByDate.get(selected) ?? []

  return (
    <div className="space-y-4">
      {feedErrors.length > 0 && (
        <Callout intent="warning">
          Could not read {feedErrors.map((f) => f.label).join(', ')}. Everything else is
          shown.
        </Callout>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card
          title={monthName}
          action={
            <div className="flex items-center gap-1">
              <button
                className="btn btn-ghost !p-1.5"
                onClick={() =>
                  setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
                }
                aria-label="Previous month"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                className="btn btn-ghost !px-2 !py-1 text-xs"
                onClick={() => {
                  const d = new Date()
                  setCursor(new Date(d.getFullYear(), d.getMonth(), 1))
                  setSelected(toISODate())
                }}
              >
                Today
              </button>
              <button
                className="btn btn-ghost !p-1.5"
                onClick={() =>
                  setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
                }
                aria-label="Next month"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          }
          bodyClassName="!p-3"
        >
          <div className="grid grid-cols-7 gap-1">
            {dayNames.map((d) => (
              <div
                key={d}
                className="pb-1 text-center text-[10px] font-medium uppercase tracking-wide text-ink-muted"
              >
                {d}
              </div>
            ))}

            {grid.map((iso) => {
              const inMonth = fromISODate(iso).getMonth() === cursor.getMonth()
              const dayTasks = tasksByDate.get(iso) ?? []
              const dayEvents = eventsByDate.get(iso) ?? []
              const openCount = dayTasks.filter((t) => !t.completed).length
              const isToday = iso === today
              const isSelected = iso === selected

              return (
                <button
                  key={iso}
                  onClick={() => setSelected(iso)}
                  className={`min-h-[4.5rem] rounded-lg border p-1.5 text-left transition-colors ${
                    isSelected
                      ? 'border-transparent bg-surface-3'
                      : 'border-line hover:bg-surface-2'
                  } ${inMonth ? '' : 'opacity-40'}`}
                  style={
                    isSelected ? { boxShadow: `inset 0 0 0 2px var(--accent)` } : undefined
                  }
                  aria-label={`${iso}, ${openCount} tasks, ${dayEvents.length} events`}
                  aria-pressed={isSelected}
                >
                  <span
                    className={`tnum inline-grid h-5 w-5 place-items-center rounded-full text-[11px] font-medium ${
                      isToday ? 'text-white' : 'text-ink-secondary'
                    }`}
                    style={isToday ? { background: 'var(--accent)' } : undefined}
                  >
                    {fromISODate(iso).getDate()}
                  </span>

                  <div className="mt-1 space-y-0.5">
                    {dayEvents.slice(0, 2).map((e) => (
                      <div key={e.id} className="flex items-center gap-1">
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{
                            background: slotColor(palette, e.color_slot),
                          }}
                        />
                        <span className="truncate text-[10px] text-ink-secondary">
                          {e.title}
                        </span>
                      </div>
                    ))}
                    {openCount > 0 && (
                      <p className="text-[10px] text-ink-muted">
                        {openCount} task{openCount === 1 ? '' : 's'}
                      </p>
                    )}
                    {dayEvents.length > 2 && (
                      <p className="text-[10px] text-ink-muted">
                        +{dayEvents.length - 2} more
                      </p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </Card>

        <Card
          title={relativeDay(selected)}
          subtitle={fromISODate(selected).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        >
          <div className="space-y-4">
            <div>
              <p className="label">Events</p>
              {selectedEvents.length === 0 ? (
                <p className="text-xs text-ink-muted">Nothing scheduled.</p>
              ) : (
                <ul className="space-y-2">
                  {selectedEvents.map((e) => (
                    <li key={e.id} className="group flex items-start gap-2">
                      <span
                        aria-hidden
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{ background: slotColor(palette, e.color_slot) }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink-primary">{e.title}</p>
                        <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-ink-secondary">
                          <span className="flex items-center gap-1">
                            <Clock size={10} />
                            {new Date(e.start_at).toLocaleTimeString('en-US', {
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </span>
                          {e.location && (
                            <span className="flex items-center gap-1">
                              <MapPin size={10} />
                              {e.location}
                            </span>
                          )}
                        </p>
                      </div>
                      {!e.readOnly && (
                        <button
                          onClick={() =>
                            void removeRow(
                              'events',
                              e as CalendarEvent,
                              events.remove,
                              'Event',
                            )
                          }
                          className="btn btn-ghost !p-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
                          aria-label={`Delete ${e.title}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-line pt-3">
              <p className="label">Tasks</p>
              {selectedTasks.length === 0 ? (
                <p className="text-xs text-ink-muted">No tasks due.</p>
              ) : (
                <ul className="space-y-1.5">
                  {selectedTasks.map((t) => (
                    <li key={t.id} className="flex items-center gap-2 text-sm">
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 rounded-full"
                        style={{
                          background: slotColor(palette, PRIORITY_SLOT[t.priority]),
                        }}
                      />
                      <span
                        className={
                          t.completed ? 'text-ink-muted line-through' : 'text-ink-primary'
                        }
                      >
                        {t.title}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function NewItemModal({
  open,
  onClose,
  onSaveTask,
  onSaveEvent,
}: {
  open: boolean
  onClose: () => void
  onSaveTask: (row: Omit<Task, 'id'>) => Promise<void>
  onSaveEvent: (row: Omit<CalendarEvent, 'id'>) => Promise<void>
}) {
  const [kind, setKind] = useState<'task' | 'event'>('task')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(toISODate())
  const [time, setTime] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [recurrence, setRecurrence] = useState<Recurrence>('none')
  const [list, setList] = useState('Inbox')
  const [location, setLocation] = useState('')
  const [duration, setDuration] = useState('60')

  const reset = () => {
    setTitle('')
    setNotes('')
    setTime('')
    setLocation('')
  }

  const submit = async () => {
    if (!title.trim()) return
    if (kind === 'task') {
      await onSaveTask({
        title: title.trim(),
        notes: notes.trim() || null,
        due_date: date || null,
        due_time: time || null,
        priority,
        completed: false,
        completed_at: null,
        list: list.trim() || 'Inbox',
        recurrence,
        created_at: new Date().toISOString(),
      })
    } else {
      const start = new Date(`${date}T${time || '09:00'}:00`)
      const end = new Date(start.getTime() + Number(duration || 60) * 60000)
      await onSaveEvent({
        title: title.trim(),
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        all_day: false,
        location: location.trim() || null,
        color_slot: 1,
      })
    }
    reset()
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add to your day"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <SegmentedControl
        value={kind}
        onChange={setKind}
        options={[
          { value: 'task', label: 'Task' },
          { value: 'event', label: 'Event' },
        ]}
      />

      <Field label="Title">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={kind === 'task' ? 'Due date' : 'Date'}>
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label={kind === 'task' ? 'Time (optional)' : 'Start time'}>
          <input
            className="input"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </Field>
      </div>

      {kind === 'task' ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority">
              <Select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                options={[
                  { value: 'high', label: 'High' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'low', label: 'Low' },
                ]}
              />
            </Field>
            <Field label="Repeats">
              <Select
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value as Recurrence)}
                options={[
                  { value: 'none', label: 'Never' },
                  { value: 'daily', label: 'Daily' },
                  { value: 'weekdays', label: 'Weekdays' },
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'monthly', label: 'Monthly' },
                ]}
              />
            </Field>
          </div>
          <Field label="List">
            <input
              className="input"
              value={list}
              onChange={(e) => setList(e.target.value)}
            />
          </Field>
          <Field label="Notes">
            <textarea
              className="input min-h-[4rem]"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Duration (minutes)">
            <input
              className="input tnum"
              type="number"
              min="15"
              step="15"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </Field>
          <Field label="Location">
            <input
              className="input"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </Field>
        </div>
      )}
    </Modal>
  )
}
