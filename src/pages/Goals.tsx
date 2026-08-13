import { useMemo, useState } from 'react'
import { Plus, Target, Trash2 } from 'lucide-react'
import { useTable } from '../lib/store'
import { useSettings } from '../lib/settings'
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
import { currency, fromISODate, number as fmtNumber, toISODate } from '../lib/format'
import { useUndoableDelete } from '../lib/undo'
import { projectGoal, type Projection } from '../lib/insights'
import type { Goal } from '../lib/types'

/**
 * Progress is measured from the starting value, not from zero, so a goal that
 * counts *down* (pay off a loan) reads the same way as one that counts up.
 */
function progressOf(goal: Goal) {
  const span = goal.target_value - goal.start_value
  if (span === 0) return goal.current_value >= goal.target_value ? 100 : 0
  const done = ((goal.current_value - goal.start_value) / span) * 100
  return Math.max(0, Math.min(100, done))
}

function daysLeft(goal: Goal) {
  if (!goal.due_date) return null
  const diff = fromISODate(goal.due_date).getTime() - fromISODate(toISODate()).getTime()
  return Math.round(diff / 86_400_000)
}

export default function Goals() {
  const goals = useTable('goals')
  const progress = useTable('goal_progress')
  const { settings } = useSettings()
  const toast = useToast()
  const { removeRow } = useUndoableDelete()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Goal | null>(null)

  const format = (goal: Goal, value: number) =>
    goal.unit === 'USD'
      ? currency(value, settings.currency)
      : `${fmtNumber(value, 1)} ${goal.unit}`

  const completed = goals.rows.filter((g) => progressOf(g) >= 100)
  const onTrack = goals.rows.filter((g) => {
    const left = daysLeft(g)
    return progressOf(g) < 100 && (left === null || left > 0)
  })

  const byCategory = goals.rows.reduce<Record<string, Goal[]>>((acc, g) => {
    ;(acc[g.category] ??= []).push(g)
    return acc
  }, {})

  /*
   * Projections come from the recorded history, not from the single current
   * value — a goal needs a trend before a completion date means anything.
   */
  const projections = useMemo(() => {
    const map = new Map<string, Projection>()
    for (const goal of goals.rows) {
      const history = progress.rows
        .filter((p) => p.goal_id === goal.id)
        .map((p) => ({ date: p.date, value: p.value }))
      map.set(goal.id, projectGoal(goal, history))
    }
    return map
  }, [goals.rows, progress.rows])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Goals</h1>
          <p className="text-xs text-ink-secondary">
            {goals.rows.length} tracked · {completed.length} complete
          </p>
        </div>
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus size={15} /> New goal
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Active" value={onTrack.length} />
        <Stat label="Completed" value={completed.length} intent="good" />
        <Stat
          label="Average progress"
          value={`${
            goals.rows.length
              ? (
                  goals.rows.reduce((s, g) => s + progressOf(g), 0) / goals.rows.length
                ).toFixed(0)
              : 0
          }%`}
        />
      </div>

      {goals.rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Target size={20} />}
            title="No goals yet"
            description="Track the handful of things you actually want to move this year."
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                Add a goal
              </Button>
            }
          />
        </Card>
      ) : (
        Object.entries(byCategory).map(([category, list]) => (
          <Card key={category} title={category} subtitle={`${list.length} goals`}>
            <div className="space-y-5">
              {list.map((goal) => {
                const pct = progressOf(goal)
                const left = daysLeft(goal)
                const done = pct >= 100
                return (
                  <div key={goal.id} className="group">
                    <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-ink-primary">{goal.title}</p>
                        <p className="text-xs text-ink-secondary">
                          {goal.metric} · {format(goal, goal.current_value)} of{' '}
                          {format(goal, goal.target_value)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className="tnum text-xs font-medium"
                          style={{
                            color: done ? 'var(--status-good)' : 'var(--text-secondary)',
                          }}
                        >
                          {pct.toFixed(0)}%
                        </span>
                        <button
                          onClick={() => setEditing(goal)}
                          className="btn btn-ghost !px-2 !py-1 text-xs"
                        >
                          Update
                        </button>
                        <button
                          onClick={() =>
                            void removeRow('goals', goal, goals.remove, 'Goal')
                          }
                          className="btn btn-ghost !p-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
                          aria-label={`Delete ${goal.title}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    <ProgressBar value={pct} state={done ? 'good' : 'accent'} />

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                      <span className="text-ink-muted">
                        {done
                          ? 'Done — nice work.'
                          : left === null
                            ? 'No deadline set'
                            : left > 0
                              ? `${left} days left`
                              : `${Math.abs(left)} days past the deadline`}
                      </span>
                      {!done && <ProjectionNote projection={projections.get(goal.id)} />}
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        ))
      )}

      <GoalModal
        open={adding}
        onClose={() => setAdding(false)}
        onSave={async (row) => {
          await goals.insert(row)
          toast.push('Goal added')
        }}
      />

      <UpdateProgressModal
        goal={editing}
        onClose={() => setEditing(null)}
        onSave={async (id, value) => {
          await goals.update(id, { current_value: value })
          // Record the point too, so the projection has a trend to fit.
          const today = toISODate()
          const existing = progress.rows.find((p) => p.goal_id === id && p.date === today)
          if (existing) await progress.update(existing.id, { value })
          else await progress.insert({ goal_id: id, date: today, value })
          toast.push('Progress updated')
        }}
      />
    </div>
  )
}

/** Only says something when the projection is actually meaningful. */
function ProjectionNote({ projection }: { projection: Projection | undefined }) {
  if (!projection) return null

  if (projection.status === 'insufficient-data') {
    return <span className="text-ink-muted">Not enough history to project yet</span>
  }

  if (projection.status === 'wrong-direction') {
    return (
      <span style={{ color: 'var(--status-warning)' }}>Moving away from this target</span>
    )
  }

  if (projection.status === 'stalled') {
    return <span className="text-ink-muted">No movement to project from</span>
  }

  if (projection.status === 'slow' && !projection.etaDate) {
    return <span className="text-ink-muted">More than ten years away at this rate</span>
  }

  if (!projection.etaDate) return null

  const eta = fromISODate(projection.etaDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <span
      style={{
        color:
          projection.status === 'on-track' ? 'var(--status-good)' : 'var(--status-warning)',
      }}
      // A low r² means the line is a poor fit, so the date is a guess.
      title={`Fit quality r² = ${projection.confidence.toFixed(2)}`}
    >
      {projection.status === 'on-track' ? 'On track for' : 'Projected'} {eta}
      {projection.confidence < 0.5 && ' (noisy trend)'}
    </span>
  )
}

function GoalModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean
  onClose: () => void
  onSave: (row: Omit<Goal, 'id'>) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('Personal')
  const [metric, setMetric] = useState('')
  const [start, setStart] = useState('')
  const [target, setTarget] = useState('')
  const [unit, setUnit] = useState('USD')
  const [due, setDue] = useState('')

  const submit = async () => {
    const startValue = Number(start)
    const targetValue = Number(target)
    if (!title.trim() || Number.isNaN(startValue) || Number.isNaN(targetValue)) return
    await onSave({
      title: title.trim(),
      category,
      metric: metric.trim() || title.trim(),
      start_value: startValue,
      current_value: startValue,
      target_value: targetValue,
      unit,
      due_date: due || null,
    })
    setTitle('')
    setMetric('')
    setStart('')
    setTarget('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New goal"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Goal">
        <input
          className="input"
          placeholder="Emergency fund to $30k"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={['Money', 'Fitness', 'Career', 'Personal', 'Health'].map((c) => ({
              value: c,
              label: c,
            }))}
          />
        </Field>
        <Field label="Unit">
          <Select
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            options={['USD', 'kg', 'lb', 'books', 'hours', 'days', 'count'].map((u) => ({
              value: u,
              label: u,
            }))}
          />
        </Field>
      </div>
      <Field label="What you are measuring" hint="Shown under the goal title">
        <input
          className="input"
          placeholder="Savings balance"
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Starting value">
          <input
            className="input tnum"
            type="number"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field label="Target">
          <input
            className="input tnum"
            type="number"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </Field>
        <Field label="Deadline">
          <input
            className="input"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  )
}

function UpdateProgressModal({
  goal,
  onClose,
  onSave,
}: {
  goal: Goal | null
  onClose: () => void
  onSave: (id: string, value: number) => Promise<void>
}) {
  const [value, setValue] = useState('')

  return (
    <Modal
      open={goal !== null}
      onClose={onClose}
      title={goal ? `Update “${goal.title}”` : ''}
      width="max-w-sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              if (!goal) return
              const next = Number(value)
              if (Number.isNaN(next)) return
              await onSave(goal.id, next)
              setValue('')
              onClose()
            }}
          >
            Save
          </Button>
        </>
      }
    >
      {goal && (
        <Field
          label={`Current value (${goal.unit})`}
          hint={`Currently ${goal.current_value}, target ${goal.target_value}`}
        >
          <input
            className="input tnum"
            type="number"
            step="any"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={String(goal.current_value)}
          />
        </Field>
      )}
    </Modal>
  )
}
