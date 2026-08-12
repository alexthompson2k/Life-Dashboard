import { useMemo, useState } from 'react'
import { Flame, Plus, Repeat, Trash2 } from 'lucide-react'
import { useTable } from '../lib/store'
import {
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  ProgressBar,
  Select,
  Stat,
  useToast,
} from '../components/ui'
import { slotColor, usePalette } from '../components/charts'
import { habitCompletion, habitStreak, heatmapWeeks } from '../lib/fitness'
import { toISODate } from '../lib/format'
import type { Habit, HabitLog } from '../lib/types'

export default function Habits() {
  const habits = useTable('habits')
  const logs = useTable('habit_logs')
  const toast = useToast()
  const [adding, setAdding] = useState(false)

  const today = toISODate()
  const active = habits.rows.filter((h) => !h.archived)

  const loggedToday = useMemo(() => {
    const set = new Set(logs.rows.filter((l) => l.date === today).map((l) => l.habit_id))
    return set
  }, [logs.rows, today])

  const toggle = async (habit: Habit) => {
    const existing = logs.rows.find((l) => l.habit_id === habit.id && l.date === today)
    if (existing) {
      await logs.remove(existing.id)
    } else {
      await logs.insert({ habit_id: habit.id, date: today })
      toast.push(`${habit.name} logged`)
    }
  }

  const doneToday = active.filter((h) => loggedToday.has(h.id)).length
  const bestStreak = active.reduce((max, h) => Math.max(max, habitStreak(logs.rows, h.id)), 0)
  const avgCompletion = active.length
    ? active.reduce((sum, h) => sum + habitCompletion(logs.rows, h.id), 0) / active.length
    : 0

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Habits</h1>
          <p className="text-xs text-ink-secondary">
            {doneToday} of {active.length} done today
          </p>
        </div>
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus size={15} /> New habit
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Today"
          value={`${doneToday}/${active.length}`}
          intent={active.length > 0 && doneToday === active.length ? 'good' : 'neutral'}
        />
        <Stat
          label="Best current streak"
          value={`${bestStreak} day${bestStreak === 1 ? '' : 's'}`}
          icon={<Flame size={15} />}
          intent={bestStreak >= 7 ? 'good' : 'neutral'}
        />
        <Stat
          label="30-day consistency"
          value={`${avgCompletion.toFixed(0)}%`}
          intent={avgCompletion >= 70 ? 'good' : avgCompletion >= 40 ? 'neutral' : 'bad'}
        />
      </div>

      {active.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Repeat size={20} />}
            title="No habits yet"
            description="Start with one or two. Consistency beats ambition."
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                Add your first habit
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {active.map((habit) => (
            <HabitCard
              key={habit.id}
              habit={habit}
              logs={logs.rows}
              doneToday={loggedToday.has(habit.id)}
              onToggle={() => void toggle(habit)}
              onDelete={() => {
                void habits.remove(habit.id)
                toast.push('Habit removed')
              }}
            />
          ))}
        </div>
      )}

      <AddHabitModal
        open={adding}
        onClose={() => setAdding(false)}
        usedSlots={active.map((h) => h.color_slot)}
        onSave={async (row) => {
          await habits.insert(row)
          toast.push('Habit added')
        }}
      />
    </div>
  )
}

function HabitCard({
  habit,
  logs,
  doneToday,
  onToggle,
  onDelete,
}: {
  habit: Habit
  logs: HabitLog[]
  doneToday: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  const palette = usePalette()
  const color = slotColor(palette, habit.color_slot)

  const logged = useMemo(
    () => new Set(logs.filter((l) => l.habit_id === habit.id).map((l) => l.date)),
    [logs, habit.id],
  )

  const streak = habitStreak(logs, habit.id)
  const weeks = useMemo(() => heatmapWeeks(17), [])
  const today = toISODate()

  const thisWeek = weeks[weeks.length - 1].filter((d) => d <= today && logged.has(d)).length

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button
            onClick={onToggle}
            className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border-2 transition-all"
            style={{
              borderColor: color,
              background: doneToday ? color : 'transparent',
            }}
            aria-pressed={doneToday}
            aria-label={doneToday ? `Undo ${habit.name} for today` : `Log ${habit.name} for today`}
          >
            <Flame size={16} className={doneToday ? 'text-white' : ''} style={doneToday ? {} : { color }} />
          </button>
          <div>
            <p className="text-sm font-medium text-ink-primary">{habit.name}</p>
            <p className="text-xs text-ink-secondary">
              {streak} day streak · {thisWeek}/{habit.target_per_week} this week
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-28">
            <ProgressBar
              value={thisWeek}
              max={habit.target_per_week}
              state={thisWeek >= habit.target_per_week ? 'good' : 'accent'}
            />
          </div>
          <button
            onClick={onDelete}
            className="btn btn-ghost !p-1.5"
            aria-label={`Delete ${habit.name}`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Sequential single-hue heatmap: opacity carries magnitude (done / not). */}
      <div className="mt-4 overflow-x-auto">
        <div className="flex gap-[3px]" role="img" aria-label={`${habit.name} activity over the last 17 weeks`}>
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {week.map((date) => {
                const isFuture = date > today
                const hit = logged.has(date)
                return (
                  <span
                    key={date}
                    title={`${date}${hit ? ' — done' : ''}`}
                    className="h-[11px] w-[11px] rounded-[3px]"
                    style={{
                      background: hit ? color : 'var(--surface-3)',
                      opacity: isFuture ? 0.35 : 1,
                    }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

function AddHabitModal({
  open,
  onClose,
  usedSlots,
  onSave,
}: {
  open: boolean
  onClose: () => void
  usedSlots: number[]
  onSave: (row: Omit<Habit, 'id'>) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [target, setTarget] = useState('5')

  const submit = async () => {
    if (!name.trim()) return
    // Assign the lowest unused palette slot rather than cycling colours.
    const nextSlot = [1, 2, 3, 4, 5, 6, 7, 8].find((s) => !usedSlots.includes(s)) ?? 1
    await onSave({
      name: name.trim(),
      target_per_week: Number(target) || 5,
      color_slot: nextSlot,
      archived: false,
      created_at: new Date().toISOString(),
    })
    setName('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New habit"
      width="max-w-sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()}>
            Add habit
          </Button>
        </>
      }
    >
      <Field label="Habit">
        <input
          className="input"
          placeholder="Morning walk"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Target per week">
        <Select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({
            value: String(n),
            label: `${n} day${n === 1 ? '' : 's'} a week`,
          }))}
        />
      </Field>
    </Modal>
  )
}
