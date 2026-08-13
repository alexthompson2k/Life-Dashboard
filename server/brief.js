/**
 * Composes the daily brief.
 *
 * Deliberately pure: it takes a snapshot and returns text. No database, no
 * clock, no network — so the wording and the priority rules can be tested
 * without standing up a push pipeline.
 *
 * The brief is sent by the server, because a notification has to arrive when
 * the app is closed. That means it only works in cloud mode; there is no
 * server-side copy of local-mode data to read.
 */

/**
 * @typedef {Object} BriefInput
 * @property {Date}   now
 * @property {string} [displayName]
 * @property {'metric'|'imperial'} [unitSystem]
 * @property {Array<{title: string, due_date: string|null, completed: boolean}>} tasks
 * @property {Array<{title: string, start_at: string}>} events
 * @property {{ tempC: number, maxC: number, minC: number, rainChance: number, label: string }|null} weather
 * @property {Array<{category: string, limit: number, spent: number}>} budgets
 * @property {Array<{id: string, name: string}>} habits
 * @property {string[]} habitsDoneToday
 * @property {string|null} lastWeighIn
 */

/** Local-time YYYY-MM-DD, matching the app's `toISODate`. */
export function isoDate(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function greeting(now, name) {
  const hour = now.getHours()
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  return name ? `${part}, ${name}` : part
}

function formatTemp(celsius, unitSystem) {
  const value = unitSystem === 'imperial' ? (celsius * 9) / 5 + 32 : celsius
  return `${Math.round(value)}°`
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function daysBetween(fromISO, toISO) {
  const [ay, am, ad] = fromISO.split('-').map(Number)
  const [by, bm, bd] = toISO.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/**
 * @param {BriefInput} input
 * @returns {{ title: string, body: string, lines: string[], empty: boolean }}
 */
export function composeBrief(input) {
  const {
    now,
    displayName,
    unitSystem = 'imperial',
    tasks = [],
    events = [],
    weather = null,
    budgets = [],
    habits = [],
    habitsDoneToday = [],
    lastWeighIn = null,
  } = input

  const today = isoDate(now)
  const lines = []

  /* --- tasks: the thing most likely to actually need action --- */
  const open = tasks.filter((t) => !t.completed)
  const overdue = open.filter((t) => t.due_date && t.due_date < today)
  const dueToday = open.filter((t) => t.due_date === today)

  if (overdue.length && dueToday.length) {
    lines.push(
      `${dueToday.length} task${dueToday.length === 1 ? '' : 's'} due, ${overdue.length} overdue`,
    )
  } else if (overdue.length) {
    lines.push(`${overdue.length} overdue task${overdue.length === 1 ? '' : 's'}`)
  } else if (dueToday.length) {
    const label =
      dueToday.length === 1
        ? `1 task due: ${dueToday[0].title}`
        : `${dueToday.length} tasks due`
    lines.push(label)
  }

  /* --- first event still ahead --- */
  const nextEvent = events
    .filter((e) => new Date(e.start_at).getTime() >= now.getTime())
    .sort((a, b) => a.start_at.localeCompare(b.start_at))[0]

  if (nextEvent) {
    lines.push(`${formatTime(nextEvent.start_at)} ${nextEvent.title}`)
  }

  /* --- weather, phrased as something to do about it --- */
  if (weather) {
    const range = `${formatTemp(weather.maxC, unitSystem)}/${formatTemp(weather.minC, unitSystem)}`
    if (weather.rainChance >= 60) {
      lines.push(`${weather.label}, ${weather.rainChance}% rain — take a jacket`)
    } else {
      lines.push(`${weather.label} ${range}`)
    }
  }

  /* --- money: only when a budget actually needs attention --- */
  const strained = budgets
    .filter((b) => b.limit > 0 && b.spent / b.limit >= 0.8)
    .sort((a, b) => b.spent / b.limit - a.spent / a.limit)

  if (strained.length) {
    const worst = strained[0]
    const pct = Math.round((worst.spent / worst.limit) * 100)
    lines.push(
      pct > 100
        ? `${worst.category} is ${pct - 100}% over budget`
        : `${worst.category} budget at ${pct}%`,
    )
  }

  /* --- habits not yet ticked --- */
  const doneSet = new Set(habitsDoneToday)
  const remaining = habits.filter((h) => !doneSet.has(h.id))
  if (habits.length && remaining.length) {
    lines.push(
      remaining.length === habits.length
        ? `${remaining.length} habit${remaining.length === 1 ? '' : 's'} to check off`
        : `${remaining.length} habit${remaining.length === 1 ? '' : 's'} left`,
    )
  }

  /* --- a gentle nudge, not a nag --- */
  if (!lastWeighIn) {
    lines.push('No weigh-ins logged yet')
  } else if (daysBetween(lastWeighIn, today) >= 3) {
    lines.push(`No weigh-in for ${daysBetween(lastWeighIn, today)} days`)
  }

  const empty = lines.length === 0
  const body = empty ? 'Nothing needs you today. Enjoy it.' : lines.slice(0, 4).join(' · ')

  return { title: greeting(now, displayName), body, lines, empty }
}
