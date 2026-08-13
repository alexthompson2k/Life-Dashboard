import { useMemo, useState } from 'react'
import { Dumbbell, Plus, Scale, Trash2, TrendingDown, Trophy } from 'lucide-react'
import { insertRow, useTable } from '../lib/store'
import { useSettings } from '../lib/settings'
import {
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  SegmentedControl,
  Select,
  Stat,
  useToast,
} from '../components/ui'
import { CategoryBars, TimeSeriesChart } from '../components/charts'
import {
  COMMON_EXERCISES,
  exerciseProgress,
  habitStreak,
  weeklyVolume,
  weightRateOfChange,
  weightSeries,
} from '../lib/fitness'
import {
  displayToKg,
  formatWeight,
  kgToDisplay,
  number as fmtNumber,
  toISODate,
  weightUnit,
} from '../lib/format'
import { useUndoableDelete } from '../lib/undo'
import type { WorkoutSet } from '../lib/types'

type Tab = 'weight' | 'strength' | 'sessions'

export default function Fitness() {
  const { settings } = useSettings()
  const weights = useTable('weights')
  const workouts = useTable('workouts')
  const sets = useTable('workout_sets')

  const { removeRow } = useUndoableDelete()
  const [tab, setTab] = useState<Tab>('weight')
  const [loggingWeight, setLoggingWeight] = useState(false)
  const [loggingWorkout, setLoggingWorkout] = useState(false)

  const units = settings.unit_system
  const unit = weightUnit(units)

  const series = useMemo(() => weightSeries(weights.rows), [weights.rows])
  const latest = series[series.length - 1]
  const ratePerWeek = weightRateOfChange(series)

  const progress = useMemo(
    () => exerciseProgress(workouts.rows, sets.rows),
    [workouts.rows, sets.rows],
  )
  const volume = useMemo(
    () => weeklyVolume(workouts.rows, sets.rows),
    [workouts.rows, sets.rows],
  )

  const last30 = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    const iso = toISODate(cutoff)
    return workouts.rows.filter((w) => w.date >= iso)
  }, [workouts.rows])

  // Reuse the habit streak helper by treating workout dates as logs.
  const gymStreak = useMemo(
    () =>
      habitStreak(
        workouts.rows.map((w) => ({ id: w.id, habit_id: 'gym', date: w.date })),
        'gym',
      ),
    [workouts.rows],
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Fitness</h1>
          <p className="text-xs text-ink-secondary">
            {workouts.rows.length} sessions · {weights.rows.length} weigh-ins
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'weight', label: 'Weight' },
              { value: 'strength', label: 'Strength' },
              { value: 'sessions', label: 'Sessions' },
            ]}
          />
          <Button onClick={() => setLoggingWeight(true)}>
            <Scale size={15} /> Weigh in
          </Button>
          <Button variant="primary" onClick={() => setLoggingWorkout(true)}>
            <Plus size={15} /> Log workout
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Current weight"
          value={latest ? formatWeight(latest.trend_kg, units) : '—'}
          hint="7-day trend, not today's raw number"
          icon={<Scale size={15} />}
        />
        <Stat
          label="Weekly change"
          value={
            latest
              ? `${ratePerWeek >= 0 ? '+' : '−'}${Math.abs(kgToDisplay(ratePerWeek, units)).toFixed(2)} ${unit}`
              : '—'
          }
          intent={ratePerWeek <= 0 ? 'good' : 'bad'}
          hint="Averaged over the last 4 weeks"
          icon={<TrendingDown size={15} />}
        />
        <Stat
          label="Sessions (30 days)"
          value={last30.length}
          hint={`${(last30.length / 4.3).toFixed(1)} per week`}
          icon={<Dumbbell size={15} />}
        />
        <Stat
          label="Current streak"
          value={`${gymStreak} day${gymStreak === 1 ? '' : 's'}`}
          intent={gymStreak > 0 ? 'good' : 'neutral'}
          icon={<Trophy size={15} />}
        />
      </div>

      {tab === 'weight' && (
        <div className="grid gap-4">
          <TimeSeriesChart
            title="Body weight"
            subtitle="Daily weigh-ins are mostly water; read the trend line"
            data={series.map((p) => ({
              date: p.date,
              raw: Number(kgToDisplay(p.weight_kg, units).toFixed(1)),
              trend: Number(kgToDisplay(p.trend_kg, units).toFixed(2)),
            }))}
            xKey="date"
            xFormat={(v) =>
              new Date(v + 'T00:00:00').toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })
            }
            yFormat={(v) => `${v.toFixed(0)} ${unit}`}
            yDomain={['dataMin - 1', 'dataMax + 1']}
            height={300}
            series={[
              { key: 'raw', label: 'Daily weigh-in', slot: 3, kind: 'line', dashed: true },
              { key: 'trend', label: '7-day trend', slot: 1, kind: 'line' },
            ]}
          />

          <Card title="Recent weigh-ins">
            {weights.rows.length === 0 ? (
              <EmptyState
                icon={<Scale size={20} />}
                title="No weigh-ins yet"
                description="Log one to start the trend line."
              />
            ) : (
              <ul className="divide-y divide-line">
                {[...weights.rows]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .slice(0, 12)
                  .map((w) => (
                    <li
                      key={w.id}
                      className="group flex items-center justify-between py-2 first:pt-0 last:pb-0"
                    >
                      <span className="text-xs text-ink-secondary">
                        {new Date(w.date + 'T00:00:00').toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="tnum text-sm text-ink-primary">
                          {formatWeight(w.weight_kg, units)}
                        </span>
                        <button
                          onClick={() =>
                            void removeRow('weights', w, weights.remove, 'Weigh-in')
                          }
                          className="btn btn-ghost !p-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
                          aria-label="Delete weigh-in"
                        >
                          <Trash2 size={13} />
                        </button>
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === 'strength' && (
        <StrengthTab progress={progress} units={units} volume={volume} />
      )}

      {tab === 'sessions' && (
        <SessionsTab workouts={workouts} sets={sets.rows} units={units} />
      )}

      <LogWeightModal
        open={loggingWeight}
        onClose={() => setLoggingWeight(false)}
        onSave={async (kg, date, bodyFat) => {
          const existing = weights.rows.find((w) => w.date === date)
          if (existing) {
            await weights.update(existing.id, { weight_kg: kg, body_fat_pct: bodyFat })
          } else {
            await weights.insert({ date, weight_kg: kg, body_fat_pct: bodyFat, note: null })
          }
        }}
      />

      <LogWorkoutModal
        open={loggingWorkout}
        onClose={() => setLoggingWorkout(false)}
        onSave={async (workout, entries) => {
          const saved = await workouts.insert(workout)
          if (!saved) return
          for (const entry of entries) {
            await sets.insert({ ...entry, workout_id: saved.id })
          }
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function StrengthTab({
  progress,
  units,
  volume,
}: {
  progress: ReturnType<typeof exerciseProgress>
  units: 'metric' | 'imperial'
  volume: ReturnType<typeof weeklyVolume>
}) {
  const [exercise, setExercise] = useState(progress[0]?.exercise ?? '')
  const unit = weightUnit(units)
  const selected = progress.find((p) => p.exercise === exercise) ?? progress[0]

  if (progress.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Dumbbell size={20} />}
          title="No lifts logged yet"
          description="Log a workout with a few sets and your strength curve shows up here."
        />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <TimeSeriesChart
          title={`${selected.exercise} — top set`}
          subtitle={`Best ${fmtNumber(kgToDisplay(selected.best, units), 1)} ${unit} · ${
            selected.changePct >= 0 ? '+' : '−'
          }${Math.abs(selected.changePct).toFixed(0)}% since you started`}
          data={selected.sessions.map((s) => ({
            date: s.date,
            top: Number(kgToDisplay(s.topSet, units).toFixed(1)),
            e1rm: Number(kgToDisplay(s.estimated1RM, units).toFixed(1)),
          }))}
          xKey="date"
          xFormat={(v) =>
            new Date(v + 'T00:00:00').toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })
          }
          yFormat={(v) => `${v.toFixed(0)} ${unit}`}
          yDomain={['dataMin - 5', 'dataMax + 5']}
          height={280}
          series={[
            { key: 'top', label: 'Top set', slot: 1, kind: 'line' },
            { key: 'e1rm', label: 'Estimated 1RM', slot: 2, kind: 'line', dashed: true },
          ]}
          action={
            <div className="w-44">
              <Select
                value={selected.exercise}
                onChange={(e) => setExercise(e.target.value)}
                options={progress.map((p) => ({ value: p.exercise, label: p.exercise }))}
                aria-label="Choose exercise"
              />
            </div>
          }
        />

        <TimeSeriesChart
          title="Weekly training volume"
          subtitle="Sets × reps × load, per week"
          data={volume}
          xKey="week"
          xFormat={(v) =>
            new Date(v + 'T00:00:00').toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })
          }
          yFormat={(v) => `${(v / 1000).toFixed(0)}k`}
          height={280}
          series={[{ key: 'volume', label: 'Volume', slot: 1, kind: 'bar' }]}
        />
      </div>

      <CategoryBars
        title="Personal bests"
        subtitle="Heaviest set recorded for each lift"
        rows={progress.map((p) => ({
          label: p.exercise,
          value: Number(kgToDisplay(p.best, units).toFixed(1)),
          note: `${p.sessions.length}×`,
        }))}
        format={(v) => `${v.toFixed(1)} ${unit}`}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function SessionsTab({
  workouts,
  sets,
  units,
}: {
  workouts: ReturnType<typeof useTable<'workouts'>>
  sets: WorkoutSet[]
  units: 'metric' | 'imperial'
}) {
  const { run } = useUndoableDelete()
  const unit = weightUnit(units)

  const setsByWorkout = useMemo(() => {
    const map = new Map<string, WorkoutSet[]>()
    for (const s of sets) {
      const list = map.get(s.workout_id) ?? []
      list.push(s)
      map.set(s.workout_id, list)
    }
    return map
  }, [sets])

  const sorted = [...workouts.rows]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 20)

  if (sorted.length === 0) {
    return (
      <Card>
        <EmptyState icon={<Dumbbell size={20} />} title="No sessions logged yet" />
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {sorted.map((w) => {
        const workoutSets = setsByWorkout.get(w.id) ?? []
        const byExercise = new Map<string, WorkoutSet[]>()
        for (const s of workoutSets) {
          const list = byExercise.get(s.exercise) ?? []
          list.push(s)
          byExercise.set(s.exercise, list)
        }
        const volume = workoutSets.reduce((sum, s) => sum + s.weight_kg * s.reps, 0)

        return (
          <Card
            key={w.id}
            title={w.name}
            subtitle={`${new Date(w.date + 'T00:00:00').toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
            })}${w.duration_min ? ` · ${w.duration_min} min` : ''} · ${fmtNumber(
              kgToDisplay(volume, units),
            )} ${unit} volume`}
            action={
              <button
                onClick={() => {
                  // Sets cascade with the workout, so undo restores both.
                  const snapshot = { ...w }
                  const sessionSets = (setsByWorkout.get(w.id) ?? []).map((s) => ({ ...s }))
                  void run(
                    'Session',
                    () => workouts.remove(w.id),
                    async () => {
                      await insertRow('workouts', snapshot)
                      for (const set of sessionSets) await insertRow('workout_sets', set)
                    },
                  )
                }}
                className="btn btn-ghost !p-1.5"
                aria-label={`Delete ${w.name}`}
              >
                <Trash2 size={14} />
              </button>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[...byExercise.entries()].map(([exercise, exerciseSets]) => (
                <div
                  key={exercise}
                  className="rounded-xl border border-line bg-surface-2 p-3"
                >
                  <p className="mb-1.5 text-xs font-medium text-ink-primary">{exercise}</p>
                  <ul className="space-y-0.5">
                    {exerciseSets
                      .sort((a, b) => a.set_index - b.set_index)
                      .map((s) => (
                        <li
                          key={s.id}
                          className="tnum flex justify-between text-[11px] text-ink-secondary"
                        >
                          <span>Set {s.set_index}</span>
                          <span>
                            {kgToDisplay(s.weight_kg, units).toFixed(1)} {unit} × {s.reps}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function LogWeightModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean
  onClose: () => void
  onSave: (kg: number, date: string, bodyFat: number | null) => Promise<void>
}) {
  const { settings } = useSettings()
  const toast = useToast()
  const [value, setValue] = useState('')
  const [bodyFat, setBodyFat] = useState('')
  const [date, setDate] = useState(toISODate())

  const submit = async () => {
    const raw = Number(value)
    if (Number.isNaN(raw) || raw <= 0) return
    await onSave(
      displayToKg(raw, settings.unit_system),
      date,
      bodyFat ? Number(bodyFat) : null,
    )
    setValue('')
    setBodyFat('')
    toast.push('Weigh-in saved')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log a weigh-in"
      width="max-w-sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <Field label={`Weight (${weightUnit(settings.unit_system)})`}>
        <input
          className="input tnum"
          type="number"
          step="0.1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Body fat % (optional)">
          <input
            className="input tnum"
            type="number"
            step="0.1"
            value={bodyFat}
            onChange={(e) => setBodyFat(e.target.value)}
          />
        </Field>
        <Field label="Date">
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  )
}

interface DraftSet {
  exercise: string
  reps: string
  weight: string
  sets: string
}

function LogWorkoutModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean
  onClose: () => void
  onSave: (
    workout: {
      date: string
      name: string
      duration_min: number | null
      notes: string | null
    },
    sets: Array<Omit<WorkoutSet, 'id' | 'workout_id'>>,
  ) => Promise<void>
}) {
  const { settings } = useSettings()
  const toast = useToast()
  const unit = weightUnit(settings.unit_system)

  const [name, setName] = useState('')
  const [date, setDate] = useState(toISODate())
  const [duration, setDuration] = useState('')
  const [drafts, setDrafts] = useState<DraftSet[]>([
    { exercise: COMMON_EXERCISES[0], reps: '8', weight: '', sets: '3' },
  ])

  const updateDraft = (index: number, patch: Partial<DraftSet>) =>
    setDrafts((d) => d.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const submit = async () => {
    if (!name.trim()) return

    const expanded: Array<Omit<WorkoutSet, 'id' | 'workout_id'>> = []
    for (const draft of drafts) {
      const weight = Number(draft.weight)
      const reps = Number(draft.reps)
      const count = Number(draft.sets)
      if (Number.isNaN(weight) || Number.isNaN(reps) || reps <= 0 || count <= 0) continue
      for (let i = 0; i < count; i++) {
        expanded.push({
          exercise: draft.exercise,
          set_index: i + 1,
          reps,
          weight_kg: displayToKg(weight, settings.unit_system),
        })
      }
    }

    await onSave(
      {
        date,
        name: name.trim(),
        duration_min: duration ? Number(duration) : null,
        notes: null,
      },
      expanded,
    )

    setName('')
    setDuration('')
    setDrafts([{ exercise: COMMON_EXERCISES[0], reps: '8', weight: '', sets: '3' }])
    toast.push('Workout logged')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log a workout"
      width="max-w-2xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()}>
            Save workout
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Field label="Session name">
          <input
            className="input"
            placeholder="Push day"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Date">
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Duration (min)">
          <input
            className="input tnum"
            type="number"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </Field>
      </div>

      <div>
        <p className="label">Exercises</p>
        <div className="space-y-2">
          {drafts.map((draft, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_4rem_5rem_4rem_2rem] items-center gap-2"
            >
              <Select
                value={draft.exercise}
                onChange={(e) => updateDraft(i, { exercise: e.target.value })}
                options={COMMON_EXERCISES.map((x) => ({ value: x, label: x }))}
                aria-label="Exercise"
              />
              <input
                className="input tnum !px-2"
                type="number"
                min="1"
                value={draft.sets}
                onChange={(e) => updateDraft(i, { sets: e.target.value })}
                aria-label="Number of sets"
                title="Sets"
              />
              <input
                className="input tnum !px-2"
                type="number"
                step="0.5"
                placeholder={unit}
                value={draft.weight}
                onChange={(e) => updateDraft(i, { weight: e.target.value })}
                aria-label={`Weight in ${unit}`}
                title={`Weight (${unit})`}
              />
              <input
                className="input tnum !px-2"
                type="number"
                min="1"
                value={draft.reps}
                onChange={(e) => updateDraft(i, { reps: e.target.value })}
                aria-label="Reps"
                title="Reps"
              />
              <button
                onClick={() => setDrafts((d) => d.filter((_, index) => index !== i))}
                className="btn btn-ghost !p-1.5"
                aria-label="Remove exercise"
                disabled={drafts.length === 1}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-ink-muted">
          Columns: exercise, sets, weight ({unit}), reps.
        </p>
        <Button
          className="mt-2"
          onClick={() =>
            setDrafts((d) => [
              ...d,
              { exercise: COMMON_EXERCISES[0], reps: '8', weight: '', sets: '3' },
            ])
          }
        >
          <Plus size={14} /> Add exercise
        </Button>
      </div>
    </Modal>
  )
}
