import { toISODate } from './format'
import type { Tables } from './types'

/**
 * Deterministic sample dataset used when Supabase/Plaid are not configured, so
 * the dashboard is fully explorable before any cloud setup. A fixed seed keeps
 * charts stable between reloads.
 */

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(20260812)
const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)]
const between = (min: number, max: number) => min + rand() * (max - min)
const id = (prefix: string, n: number) => `${prefix}_${n.toString().padStart(4, '0')}`

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function isoDaysAgo(n: number) {
  return toISODate(daysAgo(n))
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

const accounts: Tables['accounts'][] = [
  {
    id: 'acc_checking',
    name: 'Everyday Checking',
    institution: 'Chase',
    type: 'checking',
    balance: 8420.55,
    currency: 'USD',
    plaid_account_id: null,
    plaid_item_id: null,
    is_manual: true,
    updated_at: new Date().toISOString(),
  },
  {
    id: 'acc_savings',
    name: 'Emergency Fund',
    institution: 'Ally',
    type: 'savings',
    balance: 21500,
    currency: 'USD',
    plaid_account_id: null,
    plaid_item_id: null,
    is_manual: true,
    updated_at: new Date().toISOString(),
  },
  {
    id: 'acc_brokerage',
    name: 'Brokerage',
    institution: 'Fidelity',
    type: 'investment',
    balance: 63180.4,
    currency: 'USD',
    plaid_account_id: null,
    plaid_item_id: null,
    is_manual: true,
    updated_at: new Date().toISOString(),
  },
  {
    id: 'acc_401k',
    name: '401(k)',
    institution: 'Fidelity',
    type: 'investment',
    balance: 88240.12,
    currency: 'USD',
    plaid_account_id: null,
    plaid_item_id: null,
    is_manual: true,
    updated_at: new Date().toISOString(),
  },
  {
    id: 'acc_card',
    name: 'Sapphire Card',
    institution: 'Chase',
    type: 'credit',
    balance: 1840.23,
    currency: 'USD',
    plaid_account_id: null,
    plaid_item_id: null,
    is_manual: true,
    updated_at: new Date().toISOString(),
  },
  {
    id: 'acc_student',
    name: 'Student Loan',
    institution: 'Nelnet',
    type: 'loan',
    balance: 12400,
    currency: 'USD',
    plaid_account_id: null,
    plaid_item_id: null,
    is_manual: true,
    updated_at: new Date().toISOString(),
  },
]

/* ------------------------------------------------------------------ */
/* Transactions — ~10 months of plausible spending                     */
/* ------------------------------------------------------------------ */

const MERCHANTS: Record<string, string[]> = {
  Groceries: ['Trader Joe’s', 'Whole Foods', 'Safeway', 'Costco'],
  Dining: ['Blue Bottle', 'Chipotle', 'Thai Basil', 'Pizzeria Delfina', 'Sweetgreen'],
  Transport: ['Uber', 'Shell', 'Metro Transit', 'Lyft'],
  Shopping: ['Amazon', 'Uniqlo', 'Target', 'Apple Store'],
  Entertainment: ['AMC Theatres', 'Steam', 'Ticketmaster'],
  Subscriptions: ['Netflix', 'Spotify', 'iCloud', 'NYT'],
  Health: ['Walgreens', 'One Medical', 'Zocdoc'],
  Fitness: ['Equinox', 'Rogue Fitness'],
  Travel: ['United Airlines', 'Airbnb', 'Marriott'],
  Utilities: ['PG&E', 'Comcast', 'Mint Mobile'],
}

const SPEND_PROFILE: Array<{
  category: string
  perMonth: number
  min: number
  max: number
}> = [
  { category: 'Groceries', perMonth: 9, min: 28, max: 145 },
  { category: 'Dining', perMonth: 12, min: 12, max: 78 },
  { category: 'Transport', perMonth: 7, min: 8, max: 62 },
  { category: 'Shopping', perMonth: 4, min: 20, max: 190 },
  { category: 'Entertainment', perMonth: 3, min: 14, max: 65 },
  { category: 'Health', perMonth: 2, min: 15, max: 120 },
  { category: 'Fitness', perMonth: 1, min: 40, max: 180 },
  { category: 'Travel', perMonth: 0.5, min: 180, max: 720 },
]

function buildTransactions() {
  const rows: Tables['transactions'][] = []
  let n = 0
  const MONTHS = 10

  for (let m = MONTHS - 1; m >= 0; m--) {
    const anchor = new Date()
    anchor.setMonth(anchor.getMonth() - m)
    const year = anchor.getFullYear()
    const month = anchor.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const isCurrentMonth = m === 0
    const lastDay = isCurrentMonth ? new Date().getDate() : daysInMonth
    const dayISO = (day: number) => toISODate(new Date(year, month, Math.min(day, lastDay)))

    // Salary, twice a month.
    for (const day of [1, 15]) {
      if (day > lastDay) continue
      rows.push({
        id: id('txn', n++),
        account_id: 'acc_checking',
        date: dayISO(day),
        name: 'Payroll — Northwind Labs',
        merchant: 'Northwind Labs',
        amount: 3325,
        category: 'Income',
        pending: false,
        plaid_transaction_id: null,
        notes: null,
      })
    }

    // Fixed monthly bills.
    const fixed: Array<[string, string, number, number]> = [
      ['Rent', 'Rent — Larkin St', 2150, 1],
      ['Utilities', 'PG&E', 96, 8],
      ['Utilities', 'Comcast Internet', 70, 8],
      ['Utilities', 'Mint Mobile', 30, 12],
      ['Subscriptions', 'Netflix', 15.49, 6],
      ['Subscriptions', 'Spotify', 11.99, 9],
      ['Subscriptions', 'iCloud+', 2.99, 11],
      ['Fitness', 'Equinox Membership', 185, 3],
      ['Loan Payment', 'Nelnet Student Loan', 310, 20],
    ]
    for (const [category, name, amount, day] of fixed) {
      if (day > lastDay) continue
      rows.push({
        id: id('txn', n++),
        account_id: category === 'Rent' ? 'acc_checking' : 'acc_card',
        date: dayISO(day),
        name,
        merchant: name,
        amount: -amount,
        category,
        pending: false,
        plaid_transaction_id: null,
        notes: null,
      })
    }

    // Transfer to savings.
    if (lastDay >= 16) {
      rows.push({
        id: id('txn', n++),
        account_id: 'acc_checking',
        date: dayISO(16),
        name: 'Transfer to Emergency Fund',
        merchant: 'Ally',
        amount: -900,
        category: 'Transfer',
        pending: false,
        plaid_transaction_id: null,
        notes: null,
      })
    }

    // Variable spending.
    for (const profile of SPEND_PROFILE) {
      const scale = isCurrentMonth ? lastDay / daysInMonth : 1
      const count = Math.round(profile.perMonth * scale * between(0.75, 1.25))
      for (let i = 0; i < count; i++) {
        const day = Math.max(1, Math.min(lastDay, Math.ceil(rand() * lastDay)))
        rows.push({
          id: id('txn', n++),
          account_id: rand() > 0.25 ? 'acc_card' : 'acc_checking',
          date: dayISO(day),
          name: pick(MERCHANTS[profile.category] ?? [profile.category]),
          merchant: pick(MERCHANTS[profile.category] ?? [profile.category]),
          amount: -Number(between(profile.min, profile.max).toFixed(2)),
          category: profile.category,
          pending: isCurrentMonth && day >= lastDay - 1,
          plaid_transaction_id: null,
          notes: null,
        })
      }
    }
  }

  return rows.sort((a, b) => b.date.localeCompare(a.date))
}

/* ------------------------------------------------------------------ */
/* Weight — a slow cut with realistic daily noise                      */
/* ------------------------------------------------------------------ */

function buildWeights() {
  const rows: Tables['weights'][] = []
  const DAYS = 180
  const start = 84.5
  for (let i = DAYS; i >= 0; i--) {
    // Log most days, not every day — like a real person.
    if (rand() > 0.82) continue
    const trend = start - (DAYS - i) * 0.021
    const noise = between(-0.55, 0.55)
    rows.push({
      id: id('wt', DAYS - i),
      date: isoDaysAgo(i),
      weight_kg: Number((trend + noise).toFixed(1)),
      body_fat_pct: Number(between(17.5, 19.8).toFixed(1)),
      note: null,
    })
  }
  return rows
}

/* ------------------------------------------------------------------ */
/* Workouts                                                            */
/* ------------------------------------------------------------------ */

const LIFTS = [
  { exercise: 'Barbell Squat', base: 100, top: 8 },
  { exercise: 'Bench Press', base: 75, top: 8 },
  { exercise: 'Deadlift', base: 130, top: 5 },
  { exercise: 'Overhead Press', base: 47.5, top: 8 },
  { exercise: 'Barbell Row', base: 70, top: 10 },
  { exercise: 'Pull-up', base: 0, top: 8 },
]

const SESSIONS: Array<{ name: string; lifts: string[] }> = [
  { name: 'Push Day', lifts: ['Bench Press', 'Overhead Press'] },
  { name: 'Pull Day', lifts: ['Deadlift', 'Barbell Row', 'Pull-up'] },
  { name: 'Leg Day', lifts: ['Barbell Squat'] },
  { name: 'Upper Body', lifts: ['Bench Press', 'Barbell Row', 'Pull-up'] },
]

function buildWorkouts() {
  const workouts: Tables['workouts'][] = []
  const sets: Tables['workout_sets'][] = []
  let wn = 0
  let sn = 0
  const DAYS = 168

  for (let i = DAYS; i >= 0; i--) {
    const d = daysAgo(i)
    const dow = d.getDay()
    // Mon/Wed/Fri/Sat, with the odd missed session.
    if (![1, 3, 5, 6].includes(dow)) continue
    if (rand() > 0.86) continue

    const session = SESSIONS[wn % SESSIONS.length]
    const workoutId = id('wo', wn++)
    const weeksIn = (DAYS - i) / 7

    workouts.push({
      id: workoutId,
      date: isoDaysAgo(i),
      name: session.name,
      duration_min: Math.round(between(48, 78)),
      notes: null,
    })

    for (const liftName of session.lifts) {
      const lift = LIFTS.find((l) => l.exercise === liftName)!
      // Linear progression with a little week-to-week wobble.
      const working = lift.base + weeksIn * 1.15 + between(-2.5, 2.5)
      for (let s = 0; s < 4; s++) {
        sets.push({
          id: id('set', sn++),
          workout_id: workoutId,
          exercise: lift.exercise,
          set_index: s + 1,
          reps: Math.max(3, lift.top - Math.floor(s / 2) + Math.round(between(-1, 1))),
          weight_kg: Number((Math.round(working / 2.5) * 2.5).toFixed(1)),
        })
      }
    }
  }

  return { workouts, sets }
}

/* ------------------------------------------------------------------ */
/* Habits                                                              */
/* ------------------------------------------------------------------ */

const HABIT_DEFS = [
  { name: 'Morning walk', target_per_week: 5, color_slot: 1, rate: 0.72 },
  { name: 'Read 20 pages', target_per_week: 5, color_slot: 2, rate: 0.63 },
  { name: 'No screens after 10pm', target_per_week: 6, color_slot: 3, rate: 0.55 },
  { name: 'Stretch', target_per_week: 4, color_slot: 4, rate: 0.6 },
  { name: 'Meditate', target_per_week: 5, color_slot: 7, rate: 0.5 },
]

function buildHabits() {
  const habits: Tables['habits'][] = []
  const logs: Tables['habit_logs'][] = []
  let ln = 0

  HABIT_DEFS.forEach((def, i) => {
    const habitId = id('hab', i)
    habits.push({
      id: habitId,
      name: def.name,
      target_per_week: def.target_per_week,
      color_slot: def.color_slot,
      archived: false,
      created_at: daysAgo(120).toISOString(),
    })
    for (let d = 90; d >= 0; d--) {
      // Recent weeks trend a little better than older ones.
      const recency = 1 + (90 - d) / 300
      if (rand() < def.rate * recency) {
        logs.push({ id: id('hl', ln++), habit_id: habitId, date: isoDaysAgo(d) })
      }
    }
  })

  return { habits, logs }
}

/* ------------------------------------------------------------------ */
/* Tasks, events, journal, goals, budgets                              */
/* ------------------------------------------------------------------ */

const TASK_SEED: Array<[string, number | null, string, string]> = [
  ['Renew passport', 9, 'high', 'Admin'],
  ['Book dentist cleaning', 4, 'medium', 'Health'],
  ['Review Q3 investment allocation', 12, 'medium', 'Money'],
  ['Meal prep for the week', 0, 'medium', 'Home'],
  ['Call Mom', 0, 'high', 'Personal'],
  ['Submit expense report', 1, 'high', 'Work'],
  ['Fix the leaking faucet', 6, 'low', 'Home'],
  ['Draft 1:1 notes', 1, 'medium', 'Work'],
  ['Order new running shoes', 14, 'low', 'Fitness'],
  ['Pay credit card bill', 3, 'high', 'Money'],
  ['Back up laptop', -2, 'medium', 'Admin'],
  ['Plan weekend hike', 2, 'low', 'Personal'],
  ['Read chapter 4 of the book club pick', 5, 'low', 'Personal'],
  ['Update résumé', 21, 'low', 'Work'],
]

function buildTasks() {
  const rows: Tables['tasks'][] = []
  TASK_SEED.forEach(([title, offset, priority, list], i) => {
    const done = i % 5 === 3
    rows.push({
      id: id('task', i),
      title,
      notes: null,
      due_date: offset === null ? null : toISODate(daysAgo(-offset)),
      due_time: null,
      priority: priority as Tables['tasks']['priority'],
      completed: done,
      completed_at: done ? daysAgo(1).toISOString() : null,
      list,
      recurrence: 'none',
      created_at: daysAgo(20 - i).toISOString(),
    })
  })

  rows.push({
    id: id('task', 90),
    title: 'Weekly budget review',
    notes: 'Check category overruns and move the surplus to savings.',
    due_date: toISODate(daysAgo(-2)),
    due_time: '19:00',
    priority: 'medium',
    completed: false,
    completed_at: null,
    list: 'Money',
    recurrence: 'weekly',
    created_at: daysAgo(60).toISOString(),
  })

  return rows
}

function buildEvents() {
  const at = (dayOffset: number, hour: number, minute = 0) => {
    const d = daysAgo(-dayOffset)
    d.setHours(hour, minute, 0, 0)
    return d.toISOString()
  }
  const seed: Array<[string, number, number, number, string | null, number]> = [
    ['Team standup', 0, 9, 15, null, 1],
    ['Lunch with Priya', 0, 12, 60, 'Nopa', 5],
    ['Leg day', 1, 7, 75, 'Equinox', 3],
    ['Dentist', 4, 14, 45, 'Market St Dental', 8],
    ['Book club', 5, 19, 90, null, 7],
    ['Flight to Seattle', 9, 6, 180, 'SFO', 2],
    ['Quarterly review', 12, 10, 60, null, 1],
    ['Dinner with the Chens', 2, 19, 120, null, 5],
  ]
  return seed.map(([title, day, hour, mins, location, slot], i) => ({
    id: id('ev', i),
    title,
    start_at: at(day, hour),
    end_at: new Date(new Date(at(day, hour)).getTime() + mins * 60000).toISOString(),
    all_day: false,
    location,
    color_slot: slot,
  }))
}

const JOURNAL_LINES = [
  'Good deep-work block this morning. Shipped the migration before lunch.',
  'Low energy today — slept badly. Kept the workout light and went to bed early.',
  'Long walk after dinner. Felt like the first real spring evening.',
  'Frustrating day of meetings, nothing shipped. Wrote down the three things that actually matter.',
  'Hit a squat PR. Legs are toast but I feel great.',
  'Quiet Sunday. Cooked properly, read for two hours, no screens after 9.',
  'Money check-in: spending is up on dining again. Capping it next month.',
]

function buildJournal() {
  const rows: Tables['journal'][] = []
  for (let i = 45; i >= 0; i--) {
    if (rand() > 0.55) continue
    rows.push({
      id: id('jr', i),
      date: isoDaysAgo(i),
      mood: Math.max(1, Math.min(5, Math.round(between(2.6, 4.7)))),
      energy: Math.max(1, Math.min(5, Math.round(between(2.4, 4.6)))),
      entry: pick(JOURNAL_LINES),
      gratitude: null,
    })
  }
  return rows
}

const goals: Tables['goals'][] = [
  {
    id: 'goal_1',
    title: 'Emergency fund to $30k',
    category: 'Money',
    metric: 'Savings balance',
    start_value: 12000,
    current_value: 21500,
    target_value: 30000,
    unit: 'USD',
    due_date: toISODate(daysAgo(-210)),
  },
  {
    id: 'goal_2',
    title: 'Get to 78 kg',
    category: 'Fitness',
    metric: 'Body weight',
    start_value: 84.5,
    current_value: 80.7,
    target_value: 78,
    unit: 'kg',
    due_date: toISODate(daysAgo(-90)),
  },
  {
    id: 'goal_3',
    title: 'Squat 140 kg',
    category: 'Fitness',
    metric: 'Working set',
    start_value: 100,
    current_value: 127.5,
    target_value: 140,
    unit: 'kg',
    due_date: toISODate(daysAgo(-150)),
  },
  {
    id: 'goal_4',
    title: 'Read 24 books this year',
    category: 'Personal',
    metric: 'Books finished',
    start_value: 0,
    current_value: 14,
    target_value: 24,
    unit: 'books',
    due_date: `${new Date().getFullYear()}-12-31`,
  },
  {
    id: 'goal_5',
    title: 'Pay off the student loan',
    category: 'Money',
    metric: 'Balance remaining',
    start_value: 24000,
    current_value: 12400,
    target_value: 0,
    unit: 'USD',
    due_date: toISODate(daysAgo(-540)),
  },
]

const budgets: Tables['budgets'][] = [
  { id: 'bud_1', category: 'Groceries', monthly_limit: 650 },
  { id: 'bud_2', category: 'Dining', monthly_limit: 400 },
  { id: 'bud_3', category: 'Transport', monthly_limit: 220 },
  { id: 'bud_4', category: 'Shopping', monthly_limit: 300 },
  { id: 'bud_5', category: 'Entertainment', monthly_limit: 150 },
  { id: 'bud_6', category: 'Health', monthly_limit: 200 },
  { id: 'bud_7', category: 'Subscriptions', monthly_limit: 60 },
  { id: 'bud_8', category: 'Fitness', monthly_limit: 200 },
]

const settings: Tables['settings'][] = [
  {
    id: 'settings_local',
    display_name: 'Alex',
    unit_system: 'imperial',
    currency: 'USD',
    location_name: 'San Francisco, CA',
    latitude: 37.7749,
    longitude: -122.4194,
    news_topics: ['Top stories', 'Technology', 'Business', 'Science'],
    week_starts_on: 1,
    brief_enabled: false,
    brief_time: '07:00',
    timezone: 'America/Los_Angeles',
    calendar_feeds: [],
  },
]

/**
 * Progress history behind each goal. Without this, projections have nothing to
 * fit a line to and every goal reads "not enough history yet".
 */
function buildGoalProgress(): Tables['goal_progress'][] {
  const rows: Tables['goal_progress'][] = []
  let n = 0

  const track = (
    goalId: string,
    from: number,
    to: number,
    weeks: number,
    jitter: number,
  ) => {
    for (let w = weeks; w >= 0; w--) {
      const progress = (weeks - w) / weeks
      const value = from + (to - from) * progress + between(-jitter, jitter)
      rows.push({
        id: id('gp', n++),
        goal_id: goalId,
        date: isoDaysAgo(w * 7),
        value: Number(value.toFixed(2)),
      })
    }
  }

  track('goal_1', 12000, 21500, 26, 250)
  track('goal_2', 84.5, 80.7, 26, 0.25)
  track('goal_3', 100, 127.5, 26, 1.5)
  track('goal_4', 0, 14, 26, 0.4)
  track('goal_5', 24000, 12400, 26, 150)

  return rows
}

/* ------------------------------------------------------------------ */

export function buildDemoData(): { [K in keyof Tables]: Tables[K][] } {
  const { workouts, sets } = buildWorkouts()
  const { habits, logs } = buildHabits()
  return {
    accounts,
    transactions: buildTransactions(),
    budgets,
    tasks: buildTasks(),
    events: buildEvents(),
    weights: buildWeights(),
    workouts,
    workout_sets: sets,
    habits,
    habit_logs: logs,
    journal: buildJournal(),
    goals,
    goal_progress: buildGoalProgress(),
    settings,
  }
}
