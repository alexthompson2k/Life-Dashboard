# Life Dashboard

A personal dashboard for daily use: money, tasks, calendar, weather, news, gym
progress, habits, goals and a journal — one page you open in the morning and
glance at through the day.

It runs in two modes:

- **Local mode (default).** No accounts, no keys, no setup. Data lives in your
  browser, seeded with a realistic sample dataset so every screen is populated
  from the first load. Good for trying it out.
- **Cloud mode.** Add Supabase keys and the same app runs on Postgres with
  per-user row-level security, so your data syncs across devices. Add Plaid
  keys on the server and bank accounts and transactions sync automatically.

The app never blocks on the cloud pieces: if Supabase, Plaid or the news
service is unavailable, the affected panel explains itself and the rest of the
dashboard carries on.

---

## Quick start

```bash
npm install
npm start          # web on :5173, API server on :8787
```

Open http://localhost:5173. That is the whole setup for local mode.

`npm start` runs two processes:

| Command          | What it does                                          |
| ---------------- | ----------------------------------------------------- |
| `npm run dev`    | Vite dev server for the app                           |
| `npm run server` | API server: Plaid endpoints + RSS news proxy          |

Other scripts: `npm run build` (typecheck + production build),
`npm run typecheck`, `npm test`, `npm run preview`.

### Tests

`npm test` runs the unit suite (Vitest) over the pure logic — net worth and
liability signs, budget thresholds, the category "Other" fold, weight trend and
rate of change, Epley 1RM, habit streaks, local-date handling, the local
storage backend, daily-brief composition, and the server's auth middleware.
These are the places where being silently wrong is expensive, so they are the
ones covered.

---

## What's in it

**Overview** — the daily glance. Net worth, what's due today, weight trend,
workouts this week, today's tasks and schedule, budget warnings, weather,
habit check-offs and headlines.

**Financials** — four tabs:

- _Overview_: net worth trend, income vs. spending, spending by category,
  budget health, savings rate and cash runway.
- _Transactions_: searchable and filterable by month and category, with manual
  entry.
- _Budgets_: per-category monthly limits with over-budget warnings.
- _Accounts_: assets and liabilities, manual accounts, and Plaid bank linking.

**Tasks & Calendar** — list view grouped by day (overdue first) and a month
calendar showing tasks and events together. Priorities, lists, notes, and
recurring tasks that roll forward when you complete them.

**Fitness** — weigh-ins with a 7-day trend line (the number worth reading, not
the daily noise), rate of change per week, workout logging with sets/reps/load,
per-exercise strength curves with estimated 1RM, weekly training volume, and
personal bests.

**Habits** — daily check-off, current streaks, weekly targets and a 17-week
activity heatmap per habit.

**Goals** — progress measured from a starting value, so countdown goals (paying
off a loan) read the same way as count-up goals.

**Weather** — current conditions, 24-hour temperature and rain-chance charts, a
7-day forecast, and a one-line practical read on the day. Uses
[Open-Meteo](https://open-meteo.com) — no API key needed.

**News** — headlines from RSS feeds you choose by topic, fetched through the
API server.

**Calendar subscriptions** — add a read-only ICS feed (Google, Apple, Outlook
all expose a secret iCal URL) in Settings and its events appear alongside your
own. Fetched server-side, because calendar hosts send no CORS headers and a
user-supplied URL needs checking before anything fetches it.

**CSV import** — for accounts Plaid cannot reach. Columns are auto-detected,
dates and sign conventions are configurable, and a preview shows exactly what
will be written. Re-importing an overlapping statement skips what you already
have.

**Journal** — a one-minute daily entry with mood and energy, plus a trend chart.

Throughout: light/dark themes, a ⌘K command palette (type `add call the
dentist` to capture a task from anywhere), keyboard-accessible dialogs, and a
table view on every chart.

---

## On your phone

The dashboard is an installable PWA. Open it on your phone and use **Add to
Home Screen** (or the install prompt on Android/desktop). Installed, it opens
without browser chrome, keeps working offline, and can send you a morning
brief.

**Offline.** The app shell and your last-loaded data are cached, so it still
opens with no signal. Local mode works completely offline. In cloud mode reads
fall back to cache and a banner tells you what you are looking at; writes are
never cached, so they fail honestly rather than appearing to save.

### Daily brief

One notification each morning: tasks due and overdue, your next event, the
weather (phrased as something to do about it), any budget past 80%, habits not
yet ticked, and a nudge if you have not weighed in for a few days. It stays
quiet on a day with nothing to report.

Because the notification must arrive while the app is closed, the server
composes and sends it — so **the brief needs cloud mode**. To set it up:

1. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to `server/.env`.
2. Generate a VAPID key pair and add it to the same file:

   ```bash
   npx web-push generate-vapid-keys
   ```

   ```
   VAPID_PUBLIC_KEY=...
   VAPID_PRIVATE_KEY=...
   VAPID_SUBJECT=mailto:you@example.com
   ```

3. Restart the server, then go to **Settings → Daily brief**, turn it on and
   pick a time. **Send one now** checks the whole path without waiting for
   morning.

The server checks every 15 minutes and sends to whoever's chosen time has just
come round in their own timezone.

On iPhone and iPad, web push only works once the app is installed to the home
screen — the settings panel says so rather than silently failing.

---

## Cloud mode (Supabase)

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run [`supabase/schema.sql`](supabase/schema.sql).
   It creates every table, indexes them, and enables row-level security with
   policies that scope each row to `auth.uid()`.
3. Copy your keys into `.env.local`:

   ```bash
   cp .env.example .env.local
   ```

   ```
   VITE_SUPABASE_URL=https://xxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```

4. Restart `npm run dev`. The app now shows a sign-in screen; create an account
   and you are running on your own Postgres database.

The anon key is meant to be public — row-level security is what protects the
data. Never put a service-role key in a `VITE_`-prefixed variable; anything
with that prefix is compiled into the browser bundle.

### Migrating your local data

**Settings → Export backup** writes a JSON file of every table, and works in
both modes. To move local data into a fresh cloud account, export before you
add the keys, then import once signed in.

Import *adds* rows rather than replacing them, so importing the same file twice
duplicates it. Row ids are preserved, which keeps relationships (workout → sets,
habit → logs) intact.

---

## Bank sync (Plaid)

1. Sign up at [dashboard.plaid.com](https://dashboard.plaid.com) and get your
   `client_id` and sandbox secret.
2. Configure the server:

   ```bash
   cp server/.env.example server/.env
   ```

   ```
   PLAID_CLIENT_ID=...
   PLAID_SECRET=...
   PLAID_ENV=sandbox
   ```

3. Restart `npm run server`, then go to **Financials → Accounts → Link a bank**.
   In sandbox, use any institution with the credentials `user_good` /
   `pass_good`.

Check the server is configured with `curl localhost:8787/api/health`.

### Plaid endpoints

| Endpoint                 | Purpose                                        |
| ------------------------ | ---------------------------------------------- |
| `POST /api/plaid/link-token` | Mints a Link token for the browser         |
| `POST /api/plaid/exchange`   | Swaps the public token for an access token |
| `GET  /api/plaid/accounts`   | Current balances for linked items          |
| `POST /api/plaid/sync`       | Incremental transaction sync               |

Access tokens are stored in `plaid_items` — RLS enabled with no policies, so
only the service role can read them — along with the incremental sync cursor,
so a restart does not force a re-link and each sync fetches only what changed.

Sync is idempotent: accounts upsert on `plaid_account_id` and transactions on
`plaid_transaction_id`, both unique per user. Running it twice changes nothing.
Transactions Plaid later removes (pending charges that never settled) are
deleted to match.

Every Plaid route requires a signed-in user; the server derives the account
from the Supabase JWT and never from the request body.

Sign conventions the server normalizes to: **amount > 0 is money in, < 0 is
money out** (Plaid uses the opposite), and liability balances are stored as a
positive "amount owed", which net worth subtracts.

---

## Architecture

```
src/
  lib/          data layer, domain logic, API clients
    store.ts      one interface over Supabase and localStorage
    finance.ts    net worth, budgets, cash flow, categories
    fitness.ts    weight trend, 1RM estimates, volume, streaks
    weather.ts    Open-Meteo client + WMO code mapping
  components/
    charts.tsx    chart primitives and the colour palette
    ui.tsx        cards, stats, modals, toasts, form fields
  pages/        one file per section
server/         holds all secrets
  index.js      routes: Plaid, news, push
  auth.js       Supabase JWT verification for user-scoped endpoints
  brief.js      pure daily-brief composition (unit tested)
  push.js       subscriptions, delivery, and the 15-minute scheduler
supabase/       schema.sql — tables, indexes, RLS policies
```

**Why an API server at all?** Two things the browser cannot do: hold a Plaid
secret, and fetch RSS feeds (no CORS headers). Everything else — Supabase reads
and writes, weather — goes direct from the app.

**The data layer.** `useTable('tasks')` returns rows plus `insert`/`update`/
`remove`, and works identically against either backend. Pages never branch on
which one is live.

**Charts.** Categorical colours are assigned by fixed slot, never by rank, so
filtering a chart never repaints the remaining series. The palette is validated
for colourblind separation in both light and dark mode. There are no dual-axis
charts anywhere — two measures with different units get two charts. Every chart
has a table view (the icon in its header), which is also the accessibility
fallback for the lighter palette slots.

---

## Deploying

The frontend is a static build (`npm run build` → `dist/`) and can go on any
static host. The API server is a small Express app that needs a Node runtime.

If the two end up on different origins, point the frontend at the server:

```
VITE_API_BASE_URL=https://your-api-host.example.com
```

Otherwise leave it blank — in development Vite proxies `/api` for you.

---

## Notes and limits

- The net worth history is **reconstructed** by walking today's balances back
  through your transactions. It is exact only for accounts whose activity is
  fully captured; treat it as a trend, not an audit.
- Weight and lift loads are stored in kilograms and converted for display, so
  switching units in Settings never rewrites your data.
- Estimated 1RM uses the Epley formula — a training metric, not a real max.
- The local-mode sample data is deterministic, so charts stay stable across
  reloads. **Settings → Reset to sample data** restores it.
