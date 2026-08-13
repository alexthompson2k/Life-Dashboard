import webpush from 'web-push'
import cron from 'node-cron'
import { composeBrief, isoDate } from './brief.js'
import { serviceClient, supabaseConfigured } from './supabase.js'

/**
 * Daily brief delivery.
 *
 * A notification has to arrive when the app is closed, so the server composes
 * and sends it. That makes cloud mode a hard requirement: there is no
 * server-side copy of local-mode data to read.
 */

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:dashboard@example.com'

export const pushConfigured = Boolean(VAPID_PUBLIC && VAPID_PRIVATE && supabaseConfigured)

if (pushConfigured) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
}

export function vapidPublicKey() {
  return VAPID_PUBLIC ?? null
}

/* ------------------------------------------------------------------ */
/* Subscriptions                                                       */
/* ------------------------------------------------------------------ */

export async function saveSubscription(userId, subscription) {
  const db = serviceClient()
  if (!db) throw new Error('Supabase is not configured.')

  const { error } = await db.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys?.p256dh,
      auth: subscription.keys?.auth,
    },
    { onConflict: 'endpoint' },
  )
  if (error) throw new Error(error.message)
}

export async function removeSubscription(userId, endpoint) {
  const db = serviceClient()
  if (!db) throw new Error('Supabase is not configured.')
  const { error } = await db
    .from('push_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('endpoint', endpoint)
  if (error) throw new Error(error.message)
}

/* ------------------------------------------------------------------ */
/* Gathering a user's day                                              */
/* ------------------------------------------------------------------ */

/**
 * Reads just enough of one user's data to compose their brief. Every query
 * filters on user_id explicitly — the service-role key bypasses RLS, so that
 * filter is the only thing scoping these reads.
 */
export async function gatherBriefInput(userId, now = new Date()) {
  const db = serviceClient()
  if (!db) throw new Error('Supabase is not configured.')

  const today = isoDate(now)
  const monthStart = `${today.slice(0, 7)}-01`
  const dayEnd = new Date(now)
  dayEnd.setHours(23, 59, 59, 999)

  const [settings, tasks, events, budgets, transactions, habits, habitLogs, weights] =
    await Promise.all([
      db.from('settings').select('*').eq('user_id', userId).maybeSingle(),
      db
        .from('tasks')
        .select('title,due_date,completed')
        .eq('user_id', userId)
        .eq('completed', false),
      db
        .from('events')
        .select('title,start_at')
        .eq('user_id', userId)
        .gte('start_at', now.toISOString())
        .lte('start_at', dayEnd.toISOString()),
      db.from('budgets').select('category,monthly_limit').eq('user_id', userId),
      db
        .from('transactions')
        .select('category,amount')
        .eq('user_id', userId)
        .gte('date', monthStart)
        .lt('amount', 0),
      db.from('habits').select('id,name').eq('user_id', userId).eq('archived', false),
      db.from('habit_logs').select('habit_id').eq('user_id', userId).eq('date', today),
      db
        .from('weights')
        .select('date')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(1),
    ])

  const spendByCategory = new Map()
  for (const row of transactions.data ?? []) {
    spendByCategory.set(
      row.category,
      (spendByCategory.get(row.category) ?? 0) + Math.abs(Number(row.amount)),
    )
  }

  const config = settings.data ?? {}

  return {
    input: {
      now,
      displayName: config.display_name ?? '',
      unitSystem: config.unit_system ?? 'imperial',
      tasks: tasks.data ?? [],
      events: events.data ?? [],
      weather: await fetchWeather(config.latitude, config.longitude),
      budgets: (budgets.data ?? []).map((b) => ({
        category: b.category,
        limit: Number(b.monthly_limit),
        spent: spendByCategory.get(b.category) ?? 0,
      })),
      habits: habits.data ?? [],
      habitsDoneToday: (habitLogs.data ?? []).map((l) => l.habit_id),
      lastWeighIn: weights.data?.[0]?.date ?? null,
    },
    settings: config,
  }
}

const WMO_LABELS = {
  0: 'Clear',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Fog',
  51: 'Drizzle',
  53: 'Drizzle',
  55: 'Drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  71: 'Snow',
  73: 'Snow',
  75: 'Heavy snow',
  80: 'Showers',
  81: 'Showers',
  82: 'Heavy showers',
  95: 'Thunderstorms',
  96: 'Thunderstorms',
  99: 'Thunderstorms',
}

async function fetchWeather(latitude, longitude) {
  if (latitude == null || longitude == null) return null
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast')
    url.searchParams.set('latitude', String(latitude))
    url.searchParams.set('longitude', String(longitude))
    url.searchParams.set('current', 'temperature_2m,weather_code')
    url.searchParams.set(
      'daily',
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    )
    url.searchParams.set('timezone', 'auto')
    url.searchParams.set('forecast_days', '1')

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const json = await res.json()

    return {
      tempC: json.current.temperature_2m,
      maxC: json.daily.temperature_2m_max[0],
      minC: json.daily.temperature_2m_min[0],
      rainChance: json.daily.precipitation_probability_max?.[0] ?? 0,
      label: WMO_LABELS[json.daily.weather_code[0]] ?? 'Mixed',
    }
  } catch {
    // The brief is still worth sending without weather.
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

export async function sendBriefTo(userId, now = new Date()) {
  const db = serviceClient()
  if (!db) throw new Error('Supabase is not configured.')

  const { data: subs, error } = await db
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
  if (!subs?.length) return { sent: 0, brief: null }

  const { input } = await gatherBriefInput(userId, now)
  const brief = composeBrief(input)

  const payload = JSON.stringify({
    title: brief.title,
    body: brief.body,
    url: '/',
    tag: 'daily-brief',
  })

  let sent = 0
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload,
      )
      sent++
    } catch (err) {
      // 404/410 mean the browser dropped the subscription — clean it up so it
      // is not retried every morning forever.
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      } else {
        console.warn('push failed:', err.statusCode, err.body ?? err.message)
      }
    }
  }

  return { sent, brief }
}

/* ------------------------------------------------------------------ */
/* Scheduling                                                          */
/* ------------------------------------------------------------------ */

/**
 * Runs every quarter hour and sends to whoever's chosen brief time has just
 * come round in their own timezone. Checking often and filtering is far
 * simpler than maintaining one cron job per user.
 */
export function startBriefScheduler() {
  if (!pushConfigured) {
    console.log('Daily brief: disabled (needs VAPID keys and Supabase)')
    return
  }

  cron.schedule('*/15 * * * *', async () => {
    const db = serviceClient()
    if (!db) return

    const { data: users, error } = await db
      .from('settings')
      .select('user_id,brief_enabled,brief_time,timezone')
      .eq('brief_enabled', true)
    if (error || !users?.length) return

    for (const user of users) {
      try {
        const zone = user.timezone || 'UTC'
        const localNow = new Date(new Date().toLocaleString('en-US', { timeZone: zone }))
        const [hour, minute] = (user.brief_time || '07:00').split(':').map(Number)

        // Fire when the scheduled minute falls inside this 15-minute tick.
        const scheduled = hour * 60 + minute
        const current = localNow.getHours() * 60 + localNow.getMinutes()
        if (current < scheduled || current >= scheduled + 15) continue

        await sendBriefTo(user.user_id, localNow)
      } catch (err) {
        console.warn(`Daily brief failed for ${user.user_id}:`, err.message)
      }
    }
  })

  console.log('Daily brief: scheduler running (checks every 15 minutes)')
}
