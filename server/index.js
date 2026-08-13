/**
 * API server for the Life Dashboard.
 *
 * It exists for two things the browser cannot do safely or at all:
 *   1. Plaid — the client secret must never reach the browser, and the
 *      token exchange has to happen server-side.
 *   2. News — RSS hosts do not send CORS headers, so feeds are fetched here
 *      and handed back as JSON.
 *
 * Everything else (Supabase reads/writes, weather) goes direct from the app.
 * The server starts and serves what it can even when Plaid is unconfigured;
 * the endpoints that need keys return a clear 501 instead of crashing.
 */

import express from 'express'
import cors from 'cors'
import 'dotenv/config'
import { XMLParser } from 'fast-xml-parser'
import { requireUser } from './auth.js'
import { supabaseConfigured } from './supabase.js'
import {
  createLinkToken,
  exchangePublicToken,
  linkedItems,
  plaidConfigured,
  plaidEnv,
  removeItem,
  syncUser,
} from './plaid.js'
import { fetchCalendar, withinWindow } from './calendar.js'
import { BlockedUrlError } from './urlguard.js'
import {
  pushConfigured,
  removeSubscription,
  saveSubscription,
  sendBriefTo,
  startBriefScheduler,
  vapidPublicKey,
} from './push.js'

const app = express()
app.use(cors())
app.use(express.json())

const PORT = process.env.PORT || 8787

/* ------------------------------------------------------------------ */
/* Plaid                                                               */
/* ------------------------------------------------------------------ */

function plaidUnavailable(res) {
  return res.status(501).json({
    error:
      'Plaid is not configured on the server. Add PLAID_CLIENT_ID and PLAID_SECRET to server/.env, then restart it.',
  })
}

/** Every Plaid route is user-scoped, so all of them sit behind requireUser. */
app.post('/api/plaid/link-token', requireUser, async (req, res) => {
  if (!plaidConfigured) return plaidUnavailable(res)
  try {
    res.json({ link_token: await createLinkToken(req.userId) })
  } catch (err) {
    console.error('link-token failed:', err?.response?.data ?? err.message)
    res.status(502).json({ error: 'Could not create a Plaid link token.' })
  }
})

app.post('/api/plaid/exchange', requireUser, async (req, res) => {
  if (!plaidConfigured) return plaidUnavailable(res)
  const { public_token: publicToken, institution_name: institutionName } = req.body ?? {}
  if (!publicToken) return res.status(400).json({ error: 'public_token is required.' })

  try {
    const result = await exchangePublicToken(
      req.userId,
      publicToken,
      institutionName ?? null,
    )
    res.json(result)
  } catch (err) {
    console.error('exchange failed:', err?.response?.data ?? err.message)
    res.status(502).json({ error: 'Could not link that account.' })
  }
})

app.post('/api/plaid/sync', requireUser, async (req, res) => {
  if (!plaidConfigured) return plaidUnavailable(res)
  try {
    res.json(await syncUser(req.userId))
  } catch (err) {
    console.error('sync failed:', err?.response?.data ?? err.message)
    res.status(502).json({ error: 'Could not sync from Plaid.' })
  }
})

app.get('/api/plaid/items', requireUser, async (req, res) => {
  if (!plaidConfigured) return plaidUnavailable(res)
  try {
    res.json({ items: await linkedItems(req.userId) })
  } catch (err) {
    console.error('items failed:', err.message)
    res.status(502).json({ error: 'Could not list linked banks.' })
  }
})

app.delete('/api/plaid/items/:itemId', requireUser, async (req, res) => {
  if (!plaidConfigured) return plaidUnavailable(res)
  try {
    await removeItem(req.userId, req.params.itemId)
    res.json({ ok: true })
  } catch (err) {
    console.error('unlink failed:', err.message)
    res.status(502).json({ error: 'Could not unlink that bank.' })
  }
})

/* ------------------------------------------------------------------ */
/* Calendar (ICS subscriptions)                                        */
/* ------------------------------------------------------------------ */

app.get('/api/calendar', requireUser, async (req, res) => {
  const url = String(req.query.url ?? '')
  const label = String(req.query.label ?? 'Calendar')
  if (!url) return res.status(400).json({ error: 'A calendar URL is required.' })

  const from = new Date()
  from.setDate(from.getDate() - 7)
  const to = new Date()
  to.setDate(to.getDate() + 60)

  try {
    const events = await fetchCalendar(url, { label, force: req.query.force === '1' })
    res.json({
      events: withinWindow(events, { from, to }),
      fetched_at: new Date().toISOString(),
    })
  } catch (err) {
    if (err instanceof BlockedUrlError) {
      // A refused URL is the caller's mistake, not a server fault.
      return res.status(400).json({ error: err.message })
    }
    console.error('calendar fetch failed:', err.message)
    res.status(502).json({ error: `Could not read that calendar. ${err.message}` })
  }
})

/* ------------------------------------------------------------------ */
/* News                                                                */
/* ------------------------------------------------------------------ */

const FEEDS = {
  'Top stories': 'https://feeds.bbci.co.uk/news/rss.xml',
  World: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  Business: 'https://feeds.bbci.co.uk/news/business/rss.xml',
  Technology: 'https://feeds.arstechnica.com/arstechnica/index',
  Science: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
  Health: 'https://feeds.bbci.co.uk/news/health/rss.xml',
  Sports: 'https://feeds.bbci.co.uk/sport/rss.xml',
  Entertainment: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml',
  Markets: 'https://feeds.content.dowjones.io/public/rss/RSSMarketsMain',
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

const newsCache = new Map()
const NEWS_TTL_MS = 10 * 60 * 1000

async function loadFeed(topic) {
  const cached = newsCache.get(topic)
  if (cached && Date.now() - cached.at < NEWS_TTL_MS) return cached.items

  const url = FEEDS[topic]
  if (!url) throw new Error(`Unknown topic: ${topic}`)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'LifeDashboard/1.0 (personal use)' },
    })
    if (!response.ok) throw new Error(`Feed responded ${response.status}`)

    const parsed = parser.parse(await response.text())
    const channel = parsed?.rss?.channel ?? parsed?.feed
    const source = channel?.title ?? topic
    const entries = toArray(channel?.item ?? channel?.entry)

    const items = entries.map((entry, i) => ({
      id: `${topic}-${entry.guid?.['#text'] ?? entry.guid ?? entry.id ?? entry.link ?? i}`,
      title: typeof entry.title === 'string' ? entry.title : (entry.title?.['#text'] ?? ''),
      link: typeof entry.link === 'string' ? entry.link : (entry.link?.['@_href'] ?? ''),
      source: typeof source === 'string' ? source : topic,
      topic,
      published_at: normalizeDate(entry.pubDate ?? entry.published ?? entry.updated),
      summary: stripHtml(entry.description ?? entry.summary ?? '') || null,
    }))

    newsCache.set(topic, { at: Date.now(), items })
    return items
  } finally {
    clearTimeout(timeout)
  }
}

function toArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function normalizeDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function stripHtml(value) {
  const text = typeof value === 'string' ? value : (value?.['#text'] ?? '')
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z]+;/gi, ' ')
    .trim()
}

app.get('/api/news', async (req, res) => {
  const topics = String(req.query.topics ?? 'Top stories')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  const limit = Math.min(Number(req.query.limit) || 12, 40)

  const results = await Promise.allSettled(topics.map(loadFeed))
  const items = []
  const failed = []

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      items.push(...result.value.slice(0, limit))
    } else {
      failed.push(topics[i])
      console.warn(`Feed failed for ${topics[i]}:`, result.reason?.message)
    }
  })

  items.sort((a, b) => {
    if (!a.published_at) return 1
    if (!b.published_at) return -1
    return b.published_at.localeCompare(a.published_at)
  })

  res.json({
    items,
    fetched_at: new Date().toISOString(),
    failed_topics: failed,
  })
})

/* ------------------------------------------------------------------ */
/* Daily brief                                                         */
/* ------------------------------------------------------------------ */

/** The VAPID public key is meant to be public — the browser needs it to subscribe. */
app.get('/api/push/config', (_req, res) => {
  res.json({
    enabled: pushConfigured,
    public_key: pushConfigured ? vapidPublicKey() : null,
  })
})

app.post('/api/push/subscribe', requireUser, async (req, res) => {
  if (!pushConfigured) {
    return res.status(501).json({ error: 'Push is not configured on the server.' })
  }
  const { subscription } = req.body ?? {}
  if (!subscription?.endpoint || !subscription?.keys) {
    return res.status(400).json({ error: 'A push subscription is required.' })
  }
  try {
    await saveSubscription(req.userId, subscription)
    res.json({ ok: true })
  } catch (err) {
    console.error('subscribe failed:', err.message)
    res.status(502).json({ error: 'Could not save the subscription.' })
  }
})

app.post('/api/push/unsubscribe', requireUser, async (req, res) => {
  const { endpoint } = req.body ?? {}
  if (!endpoint) return res.status(400).json({ error: 'An endpoint is required.' })
  try {
    await removeSubscription(req.userId, endpoint)
    res.json({ ok: true })
  } catch (err) {
    console.error('unsubscribe failed:', err.message)
    res.status(502).json({ error: 'Could not remove the subscription.' })
  }
})

/** Sends the brief immediately, so the setup can be checked without waiting for morning. */
app.post('/api/push/test', requireUser, async (req, res) => {
  if (!pushConfigured) {
    return res.status(501).json({ error: 'Push is not configured on the server.' })
  }
  try {
    const { sent, brief } = await sendBriefTo(req.userId)
    if (sent === 0) {
      return res
        .status(409)
        .json({ error: 'No push subscriptions registered for this account yet.' })
    }
    res.json({ sent, preview: brief })
  } catch (err) {
    console.error('test brief failed:', err.message)
    res.status(502).json({ error: 'Could not send the brief.' })
  }
})

/* ------------------------------------------------------------------ */

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    plaid_configured: plaidConfigured,
    plaid_env: plaidConfigured ? plaidEnv : null,
    supabase_configured: supabaseConfigured,
    push_configured: pushConfigured,
    news_topics: Object.keys(FEEDS),
  })
})

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`)
  console.log(
    plaidConfigured
      ? `Plaid: configured (${plaidEnv})`
      : 'Plaid: not configured — bank linking is disabled until you add keys to server/.env',
  )
  console.log(
    supabaseConfigured
      ? 'Supabase: service role configured'
      : 'Supabase: not configured — the daily brief needs it',
  )
  startBriefScheduler()
})
