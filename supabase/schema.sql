-- Life Dashboard — Postgres schema for Supabase.
--
-- Run this once in the Supabase SQL editor (or `supabase db push`).
--
-- Every table is scoped to the signed-in user by row-level security. The
-- policies below are deliberately strict: a row is visible only to the user
-- whose id is on it, and `user_id` defaults to auth.uid() so the client never
-- has to be trusted to set it correctly.

-- ---------------------------------------------------------------------------
-- Helper: applied to every table so `updated_at`-style columns stay honest.
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  institution text,
  type text not null default 'checking'
    check (type in ('checking','savings','credit','investment','loan','cash','other')),
  balance numeric(14,2) not null default 0,
  currency text not null default 'USD',
  plaid_account_id text,
  plaid_item_id text,
  is_manual boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (user_id, plaid_account_id)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  account_id uuid references public.accounts on delete set null,
  date date not null,
  name text not null,
  merchant text,
  -- Positive is money in, negative is money out.
  amount numeric(14,2) not null,
  category text not null default 'Other',
  pending boolean not null default false,
  plaid_transaction_id text,
  notes text,
  unique (user_id, plaid_transaction_id)
);

create index if not exists transactions_user_date_idx
  on public.transactions (user_id, date desc);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  category text not null,
  monthly_limit numeric(12,2) not null default 0,
  unique (user_id, category)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  notes text,
  due_date date,
  due_time text,
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  completed boolean not null default false,
  completed_at timestamptz,
  list text not null default 'Inbox',
  recurrence text not null default 'none'
    check (recurrence in ('none','daily','weekdays','weekly','monthly')),
  created_at timestamptz not null default now()
);

create index if not exists tasks_user_due_idx on public.tasks (user_id, due_date);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz,
  all_day boolean not null default false,
  location text,
  color_slot smallint not null default 1 check (color_slot between 1 and 8)
);

create index if not exists events_user_start_idx on public.events (user_id, start_at);

create table if not exists public.weights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  -- Stored in kilograms; the UI converts for display.
  weight_kg numeric(6,2) not null,
  body_fat_pct numeric(4,1),
  note text,
  unique (user_id, date)
);

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  name text not null,
  duration_min integer,
  notes text
);

create index if not exists workouts_user_date_idx on public.workouts (user_id, date desc);

create table if not exists public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  workout_id uuid not null references public.workouts on delete cascade,
  exercise text not null,
  set_index integer not null default 1,
  reps integer not null,
  weight_kg numeric(6,2) not null default 0
);

create index if not exists workout_sets_workout_idx on public.workout_sets (workout_id);

create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  target_per_week smallint not null default 5 check (target_per_week between 1 and 7),
  color_slot smallint not null default 1 check (color_slot between 1 and 8),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  habit_id uuid not null references public.habits on delete cascade,
  date date not null,
  unique (habit_id, date)
);

create table if not exists public.journal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  mood smallint not null default 3 check (mood between 1 and 5),
  energy smallint not null default 3 check (energy between 1 and 5),
  entry text not null default '',
  gratitude text,
  unique (user_id, date)
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  category text not null default 'Personal',
  metric text not null default '',
  start_value numeric(14,2) not null default 0,
  current_value numeric(14,2) not null default 0,
  target_value numeric(14,2) not null default 0,
  unit text not null default 'count',
  due_date date
);

-- Each recorded update to a goal, so progress can be projected forward.
create table if not exists public.goal_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  goal_id uuid not null references public.goals on delete cascade,
  date date not null,
  value numeric(14,2) not null,
  unique (goal_id, date)
);

create index if not exists goal_progress_goal_idx on public.goal_progress (goal_id, date);

create table if not exists public.settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references auth.users on delete cascade,
  display_name text not null default '',
  unit_system text not null default 'imperial' check (unit_system in ('metric','imperial')),
  currency text not null default 'USD',
  location_name text not null default 'San Francisco, CA',
  latitude double precision not null default 37.7749,
  longitude double precision not null default -122.4194,
  news_topics text[] not null default array['Top stories','Technology','Business','Science'],
  week_starts_on smallint not null default 1 check (week_starts_on in (0,1)),
  -- Daily brief. `timezone` is an IANA name so the server can fire at the
  -- user's local hour rather than UTC.
  brief_enabled boolean not null default false,
  brief_time text not null default '07:00',
  timezone text not null default 'UTC',
  -- Subscribed ICS calendar feeds: [{ "label": "Work", "url": "https://..." }]
  calendar_feeds jsonb not null default '[]'::jsonb
);

-- Re-running this file against an existing database picks up the brief columns.
alter table public.settings add column if not exists brief_enabled boolean not null default false;
alter table public.settings add column if not exists brief_time text not null default '07:00';
alter table public.settings add column if not exists timezone text not null default 'UTC';
alter table public.settings add column if not exists calendar_feeds jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- Plaid item storage.
--
-- Access tokens are bank credentials. This table has RLS enabled with NO
-- policies, which means the anon/authenticated client can never read it —
-- only the service role (your API server) can touch it.
-- ---------------------------------------------------------------------------

create table if not exists public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  item_id text not null unique,
  access_token text not null,
  institution_name text,
  -- Plaid's incremental sync cursor. Persisting it means the next sync fetches
  -- only what changed rather than re-downloading the whole history.
  sync_cursor text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.plaid_items add column if not exists sync_cursor text;
alter table public.plaid_items add column if not exists last_synced_at timestamptz;

alter table public.plaid_items enable row level security;
-- Intentionally no policies: service-role access only.

-- ---------------------------------------------------------------------------
-- Push subscriptions for the daily brief.
--
-- Written and read only by the server (service role) when sending. Same
-- pattern as plaid_items: RLS on, no policies, so the browser client cannot
-- enumerate or tamper with delivery endpoints.
-- ---------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
-- Intentionally no policies: service-role access only.

-- ---------------------------------------------------------------------------
-- Row-level security for the user-facing tables
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  user_tables text[] := array[
    'accounts','transactions','budgets','tasks','events','weights',
    'workouts','workout_sets','habits','habit_logs','journal','goals',
    'goal_progress','settings'
  ];
begin
  foreach t in array user_tables loop
    execute format('alter table public.%I enable row level security;', t);

    -- Drop first so the script is safe to re-run.
    execute format('drop policy if exists "%s_select_own" on public.%I;', t, t);
    execute format('drop policy if exists "%s_insert_own" on public.%I;', t, t);
    execute format('drop policy if exists "%s_update_own" on public.%I;', t, t);
    execute format('drop policy if exists "%s_delete_own" on public.%I;', t, t);

    execute format(
      'create policy "%s_select_own" on public.%I for select using (auth.uid() = user_id);',
      t, t);
    execute format(
      'create policy "%s_insert_own" on public.%I for insert with check (auth.uid() = user_id);',
      t, t);
    execute format(
      'create policy "%s_update_own" on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id);',
      t, t);
    execute format(
      'create policy "%s_delete_own" on public.%I for delete using (auth.uid() = user_id);',
      t, t);
  end loop;
end $$;
