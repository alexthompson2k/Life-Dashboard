/** Shared row shapes. These mirror the Postgres tables in supabase/schema.sql. */

export type ID = string

export type AccountType =
  'checking' | 'savings' | 'credit' | 'investment' | 'loan' | 'cash' | 'other'

/**
 * Balances are stored as the natural balance of the account. Liability
 * accounts (credit, loan) hold a positive number meaning "amount owed"; net
 * worth subtracts them. Keeping the sign out of the stored value means a
 * Plaid-synced card balance can be written through untouched.
 */
export interface Account {
  id: ID
  name: string
  institution: string | null
  type: AccountType
  balance: number
  currency: string
  plaid_account_id: string | null
  plaid_item_id: string | null
  is_manual: boolean
  updated_at: string
}

/** amount > 0 is money in, amount < 0 is money out. */
export interface Transaction {
  id: ID
  account_id: ID | null
  date: string
  name: string
  merchant: string | null
  amount: number
  category: string
  pending: boolean
  plaid_transaction_id: string | null
  notes: string | null
}

export interface Budget {
  id: ID
  category: string
  monthly_limit: number
}

export type Priority = 'low' | 'medium' | 'high'
export type Recurrence = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly'

export interface Task {
  id: ID
  title: string
  notes: string | null
  due_date: string | null
  due_time: string | null
  priority: Priority
  completed: boolean
  completed_at: string | null
  list: string
  recurrence: Recurrence
  created_at: string
}

export interface CalendarEvent {
  id: ID
  title: string
  start_at: string
  end_at: string | null
  all_day: boolean
  location: string | null
  color_slot: number
}

export interface WeightEntry {
  id: ID
  date: string
  weight_kg: number
  body_fat_pct: number | null
  note: string | null
}

export interface Workout {
  id: ID
  date: string
  name: string
  duration_min: number | null
  notes: string | null
}

export interface WorkoutSet {
  id: ID
  workout_id: ID
  exercise: string
  set_index: number
  reps: number
  weight_kg: number
}

export interface Habit {
  id: ID
  name: string
  target_per_week: number
  color_slot: number
  archived: boolean
  created_at: string
}

export interface HabitLog {
  id: ID
  habit_id: ID
  date: string
}

export interface JournalEntry {
  id: ID
  date: string
  mood: number
  energy: number
  entry: string
  gratitude: string | null
}

export interface Goal {
  id: ID
  title: string
  category: string
  metric: string
  start_value: number
  current_value: number
  target_value: number
  unit: string
  due_date: string | null
}

/** One recorded update to a goal, used to project a completion date. */
export interface GoalProgress {
  id: ID
  goal_id: ID
  date: string
  value: number
}

export type UnitSystem = 'metric' | 'imperial'

export interface Settings {
  id: ID
  display_name: string
  unit_system: UnitSystem
  currency: string
  location_name: string
  latitude: number
  longitude: number
  news_topics: string[]
  week_starts_on: 0 | 1
  /** Daily brief. The timezone is an IANA name so the server fires locally. */
  brief_enabled: boolean
  brief_time: string
  timezone: string
  /** Subscribed read-only ICS feeds. */
  calendar_feeds: Array<{ label: string; url: string }>
}

/** Every table the data layer knows about, and the row type it holds. */
export interface Tables {
  accounts: Account
  transactions: Transaction
  budgets: Budget
  tasks: Task
  events: CalendarEvent
  weights: WeightEntry
  workouts: Workout
  workout_sets: WorkoutSet
  habits: Habit
  habit_logs: HabitLog
  journal: JournalEntry
  goals: Goal
  goal_progress: GoalProgress
  settings: Settings
}

export type TableName = keyof Tables
