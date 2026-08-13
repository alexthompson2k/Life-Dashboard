import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  Clock,
  CloudOff,
  Flame,
  MapPin,
  Newspaper,
  Scale,
  Wallet,
} from 'lucide-react'
import { useTable } from '../lib/store'
import { useSettings } from '../lib/settings'
import { Card, EmptyState, ProgressBar, Skeleton, Stat } from '../components/ui'
import { Sparkline, slotColor, usePalette } from '../components/charts'
import {
  budgetStatuses,
  currentMonthKey,
  inMonth,
  monthlySummaries,
  netWorth,
} from '../lib/finance'
import { habitStreak, weightRateOfChange, weightSeries } from '../lib/fitness'
import { fetchNews, timeAgo, type NewsItem } from '../lib/news'
import { dayAdvice, describeWeather, fetchForecast, type Forecast } from '../lib/weather'
import {
  currency,
  formatTemp,
  formatWeight,
  kgToDisplay,
  relativeDay,
  toISODate,
  weightUnit,
} from '../lib/format'

export default function Overview() {
  const { settings } = useSettings()
  const tasks = useTable('tasks')
  const events = useTable('events')
  const accounts = useTable('accounts')
  const transactions = useTable('transactions')
  const budgets = useTable('budgets')
  const weights = useTable('weights')
  const workouts = useTable('workouts')
  const habits = useTable('habits')
  const habitLogs = useTable('habit_logs')

  const today = toISODate()
  const units = settings.unit_system
  const code = settings.currency

  /* ---- weather ---- */
  const [forecast, setForecast] = useState<Forecast | null>(null)
  const [weatherFailed, setWeatherFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetchForecast(settings.latitude, settings.longitude)
      .then((f) => !cancelled && setForecast(f))
      .catch(() => !cancelled && setWeatherFailed(true))
    return () => {
      cancelled = true
    }
  }, [settings.latitude, settings.longitude])

  /* ---- news ---- */
  const [news, setNews] = useState<NewsItem[] | null>(null)
  useEffect(() => {
    fetchNews(settings.news_topics, 5)
      .then((r) => setNews(r.items.slice(0, 5)))
      .catch(() => setNews([]))
  }, [settings.news_topics])

  /* ---- money ---- */
  const summaries = useMemo(
    () => monthlySummaries(transactions.rows, 6),
    [transactions.rows],
  )
  const currentMonth = summaries[summaries.length - 1]
  const monthTxns = useMemo(
    () => inMonth(transactions.rows, currentMonthKey()),
    [transactions.rows],
  )
  const overBudget = budgetStatuses(budgets.rows, monthTxns).filter(
    (b) => b.state !== 'good',
  )
  const worth = netWorth(accounts.rows)

  /* ---- tasks & events ---- */
  const openTasks = tasks.rows.filter((t) => !t.completed)
  // The list shows overdue alongside today's — that is what you act on — but
  // the headline count means "due today" literally, matching the Tasks page.
  const actionable = openTasks
    .filter((t) => t.due_date && t.due_date <= today)
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
  const dueTodayCount = openTasks.filter((t) => t.due_date === today).length
  const overdueCount = openTasks.filter((t) => t.due_date && t.due_date < today).length

  const upcoming = useMemo(
    () =>
      events.rows
        .filter((e) => new Date(e.start_at).getTime() >= Date.now() - 3600_000)
        .sort((a, b) => a.start_at.localeCompare(b.start_at))
        .slice(0, 5),
    [events.rows],
  )

  /* ---- fitness ---- */
  const series = useMemo(() => weightSeries(weights.rows), [weights.rows])
  const latestWeight = series[series.length - 1]
  const rate = weightRateOfChange(series)
  const last7Workouts = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 7)
    const iso = toISODate(cutoff)
    return workouts.rows.filter((w) => w.date >= iso)
  }, [workouts.rows])

  /* ---- habits ---- */
  const activeHabits = habits.rows.filter((h) => !h.archived)
  const habitsDoneToday = new Set(
    habitLogs.rows.filter((l) => l.date === today).map((l) => l.habit_id),
  )

  const weatherToday = forecast?.daily[0]

  return (
    <div className="space-y-5">
      {/* Headline numbers, one per domain. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Net worth"
          value={currency(worth, code, { compact: true })}
          hint={
            currentMonth
              ? `${currentMonth.savingsRate.toFixed(0)}% savings rate, month to date`
              : undefined
          }
          icon={<Wallet size={15} />}
          intent={worth >= 0 ? 'good' : 'bad'}
        />
        <Stat
          label="Due today"
          value={dueTodayCount}
          hint={overdueCount > 0 ? `${overdueCount} overdue` : 'Nothing overdue'}
          intent={overdueCount > 0 ? 'bad' : 'good'}
          icon={<Check size={15} />}
        />
        <Stat
          label="Weight trend"
          value={latestWeight ? formatWeight(latestWeight.trend_kg, units) : '—'}
          hint={
            latestWeight
              ? `${rate >= 0 ? '+' : '−'}${Math.abs(kgToDisplay(rate, units)).toFixed(2)} ${weightUnit(units)}/week`
              : 'No weigh-ins yet'
          }
          intent={rate <= 0 ? 'good' : 'neutral'}
          icon={<Scale size={15} />}
        />
        <Stat
          label="Workouts this week"
          value={last7Workouts.length}
          hint={last7Workouts.length >= 3 ? 'On pace' : 'Room for one more'}
          intent={last7Workouts.length >= 3 ? 'good' : 'neutral'}
          icon={<Flame size={15} />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Today column */}
        <div className="space-y-4 lg:col-span-2">
          <Card
            title="Today"
            subtitle={`${actionable.length} tasks to clear · ${upcoming.length} upcoming events`}
            action={
              <Link to="/tasks" className="btn btn-ghost !px-2 !py-1 text-xs">
                Open <ArrowRight size={13} />
              </Link>
            }
          >
            {actionable.length === 0 && upcoming.length === 0 ? (
              <EmptyState
                icon={<Check size={20} />}
                title="Your day is clear"
                description="Nothing due and nothing scheduled."
              />
            ) : (
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <p className="label">Tasks</p>
                  {actionable.length === 0 ? (
                    <p className="text-xs text-ink-muted">Nothing due today.</p>
                  ) : (
                    <ul className="space-y-2">
                      {actionable.slice(0, 6).map((task) => (
                        <li key={task.id} className="flex items-start gap-2">
                          <button
                            onClick={() =>
                              void tasks.update(task.id, {
                                completed: true,
                                completed_at: new Date().toISOString(),
                              })
                            }
                            className="mt-0.5 h-[15px] w-[15px] shrink-0 rounded border border-line transition-colors hover:border-[var(--status-good)]"
                            aria-label={`Complete ${task.title}`}
                          />
                          <span className="min-w-0 flex-1 text-sm text-ink-primary">
                            {task.title}
                            {task.due_date && task.due_date < today && (
                              <span
                                className="ml-2 text-[11px]"
                                style={{ color: 'var(--status-critical)' }}
                              >
                                overdue
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="label">Schedule</p>
                  {upcoming.length === 0 ? (
                    <p className="text-xs text-ink-muted">Nothing scheduled.</p>
                  ) : (
                    <ul className="space-y-2">
                      {upcoming.map((e) => (
                        <li key={e.id} className="flex items-start gap-2 text-sm">
                          <span className="tnum w-14 shrink-0 text-xs text-ink-secondary">
                            {new Date(e.start_at).toLocaleTimeString('en-US', {
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-ink-primary">{e.title}</p>
                            <p className="text-[11px] text-ink-muted">
                              {relativeDay(e.start_at.slice(0, 10))}
                              {e.location && ` · ${e.location}`}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </Card>

          <Card
            title="Money this month"
            subtitle={
              currentMonth
                ? `${currency(currentMonth.spend, code)} spent of ${currency(currentMonth.income, code)} earned`
                : 'No transactions yet'
            }
            action={
              <Link to="/financials" className="btn btn-ghost !px-2 !py-1 text-xs">
                Open <ArrowRight size={13} />
              </Link>
            }
          >
            {summaries.length === 0 ? (
              <EmptyState title="No transactions yet" />
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs text-ink-secondary">Net worth, last 6 months</p>
                    <p className="tnum text-lg font-semibold text-ink-primary">
                      {currency(worth, code)}
                    </p>
                  </div>
                  <Sparkline
                    values={summaries.map((s) => s.net)}
                    slot={1}
                    width={140}
                    height={36}
                  />
                </div>

                {overBudget.length > 0 ? (
                  <div className="space-y-2.5 border-t border-line pt-3">
                    <p className="label !mb-0">Budgets needing attention</p>
                    {overBudget.slice(0, 3).map((b) => (
                      <div key={b.category}>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="text-ink-primary">{b.category}</span>
                          <span className="tnum text-ink-secondary">
                            {currency(b.spent, code)} / {currency(b.limit, code)}
                          </span>
                        </div>
                        <ProgressBar value={b.spent} max={b.limit} state={b.state} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="border-t border-line pt-3 text-xs text-ink-secondary">
                    Every budget is on track this month.
                  </p>
                )}
              </div>
            )}
          </Card>

          <Card
            title="Headlines"
            subtitle={settings.news_topics.join(' · ')}
            action={
              <Link to="/news" className="btn btn-ghost !px-2 !py-1 text-xs">
                Open <ArrowRight size={13} />
              </Link>
            }
          >
            {news === null ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-9" />
                ))}
              </div>
            ) : news.length === 0 ? (
              <EmptyState
                icon={<Newspaper size={18} />}
                title="No headlines loaded"
                description="Start the API server with `npm run server` to pull feeds."
              />
            ) : (
              <ul className="divide-y divide-line">
                {news.map((item) => (
                  <li key={item.id} className="py-2 first:pt-0 last:pb-0">
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group block"
                    >
                      <p className="text-sm leading-snug text-ink-primary group-hover:underline">
                        {item.title}
                      </p>
                      <p className="mt-0.5 text-[11px] text-ink-muted">
                        {item.source} · {timeAgo(item.published_at)}
                      </p>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <Card
            title="Weather"
            subtitle={settings.location_name}
            action={
              <Link to="/weather" className="btn btn-ghost !px-2 !py-1 text-xs">
                Open <ArrowRight size={13} />
              </Link>
            }
          >
            {weatherFailed ? (
              <EmptyState
                icon={<CloudOff size={18} />}
                title="Forecast unavailable"
                description="Could not reach the weather service. It will retry on the next load."
              />
            ) : !forecast || !weatherToday ? (
              <Skeleton className="h-24" />
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <span className="text-4xl" aria-hidden>
                    {
                      describeWeather(
                        forecast.current.weather_code,
                        forecast.current.is_day,
                      ).icon
                    }
                  </span>
                  <div>
                    <p className="tnum text-2xl font-semibold text-ink-primary">
                      {formatTemp(forecast.current.temperature_c, units)}
                    </p>
                    <p className="text-xs text-ink-secondary">
                      {
                        describeWeather(
                          forecast.current.weather_code,
                          forecast.current.is_day,
                        ).label
                      }
                    </p>
                  </div>
                  <div className="ml-auto text-right">
                    <p className="tnum text-xs text-ink-secondary">
                      H {formatTemp(weatherToday.max_c, units)}
                    </p>
                    <p className="tnum text-xs text-ink-muted">
                      L {formatTemp(weatherToday.min_c, units)}
                    </p>
                  </div>
                </div>
                <p className="mt-3 flex items-start gap-1.5 border-t border-line pt-3 text-xs text-ink-secondary">
                  <MapPin size={12} className="mt-0.5 shrink-0" />
                  {dayAdvice(weatherToday, forecast.current)}
                </p>
              </>
            )}
          </Card>

          <Card
            title="Habits"
            subtitle={`${activeHabits.filter((h) => habitsDoneToday.has(h.id)).length} of ${activeHabits.length} done`}
            action={
              <Link to="/habits" className="btn btn-ghost !px-2 !py-1 text-xs">
                Open <ArrowRight size={13} />
              </Link>
            }
          >
            {activeHabits.length === 0 ? (
              <EmptyState title="No habits tracked" />
            ) : (
              <ul className="space-y-2">
                {activeHabits.slice(0, 6).map((habit) => (
                  <HabitRow
                    key={habit.id}
                    name={habit.name}
                    slot={habit.color_slot}
                    streak={habitStreak(habitLogs.rows, habit.id)}
                    done={habitsDoneToday.has(habit.id)}
                    onToggle={async () => {
                      const existing = habitLogs.rows.find(
                        (l) => l.habit_id === habit.id && l.date === today,
                      )
                      if (existing) await habitLogs.remove(existing.id)
                      else await habitLogs.insert({ habit_id: habit.id, date: today })
                    }}
                  />
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="This week"
            action={
              <Link to="/fitness" className="btn btn-ghost !px-2 !py-1 text-xs">
                Open <ArrowRight size={13} />
              </Link>
            }
          >
            <ul className="space-y-2.5 text-sm">
              <li className="flex items-center justify-between">
                <span className="text-ink-secondary">Workouts</span>
                <span className="tnum font-medium text-ink-primary">
                  {last7Workouts.length}
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-ink-secondary">Tasks completed</span>
                <span className="tnum font-medium text-ink-primary">
                  {
                    tasks.rows.filter(
                      (t) =>
                        t.completed &&
                        t.completed_at &&
                        t.completed_at.slice(0, 10) >= weekAgo(),
                    ).length
                  }
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-ink-secondary">Habit check-ins</span>
                <span className="tnum font-medium text-ink-primary">
                  {habitLogs.rows.filter((l) => l.date >= weekAgo()).length}
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-ink-secondary">Spent</span>
                <span className="tnum font-medium text-ink-primary">
                  {currency(
                    transactions.rows
                      .filter(
                        (t) =>
                          t.date >= weekAgo() && t.amount < 0 && t.category !== 'Transfer',
                      )
                      .reduce((s, t) => s + Math.abs(t.amount), 0),
                    code,
                  )}
                </span>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}

function weekAgo() {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return toISODate(d)
}

function HabitRow({
  name,
  slot,
  streak,
  done,
  onToggle,
}: {
  name: string
  slot: number
  streak: number
  done: boolean
  onToggle: () => Promise<void>
}) {
  const palette = usePalette()
  const color = slotColor(palette, slot)

  return (
    <li>
      <button
        onClick={() => void onToggle()}
        className="flex w-full items-center gap-2.5 rounded-lg py-1 text-left transition-colors hover:bg-surface-2"
        aria-pressed={done}
      >
        <span
          className="grid h-5 w-5 shrink-0 place-items-center rounded-md border-2"
          style={{ borderColor: color, background: done ? color : 'transparent' }}
        >
          {done && <Check size={11} className="text-white" />}
        </span>
        <span
          className={`flex-1 truncate text-sm ${done ? 'text-ink-muted' : 'text-ink-primary'}`}
        >
          {name}
        </span>
        {streak > 0 && (
          <span className="flex items-center gap-0.5 text-[11px] text-ink-muted">
            <Clock size={10} />
            {streak}d
          </span>
        )}
      </button>
    </li>
  )
}
