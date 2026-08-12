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

const app = express()
app.use(cors())
app.use(express.json())

const PORT = process.env.PORT || 8787

/* ------------------------------------------------------------------ */
/* Plaid                                                               */
/* ------------------------------------------------------------------ */

const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID
const PLAID_SECRET = process.env.PLAID_SECRET
const PLAID_ENV = process.env.PLAID_ENV || 'sandbox'
const PLAID_PRODUCTS = (process.env.PLAID_PRODUCTS || 'transactions').split(',')
const PLAID_COUNTRY_CODES = (process.env.PLAID_COUNTRY_CODES || 'US').split(',')

const plaidConfigured = Boolean(PLAID_CLIENT_ID && PLAID_SECRET)

let plaidClient = null

async function getPlaidClient() {
  if (!plaidConfigured) return null
  if (plaidClient) return plaidClient

  // Imported lazily so the server runs without the SDK installed.
  const { Configuration, PlaidApi, PlaidEnvironments } = await import('plaid')
  plaidClient = new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[PLAID_ENV],
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': PLAID_CLIENT_ID,
          'PLAID-SECRET': PLAID_SECRET,
        },
      },
    }),
  )
  return plaidClient
}

function plaidUnavailable(res) {
  return res.status(501).json({
    error:
      'Plaid is not configured on the server. Add PLAID_CLIENT_ID and PLAID_SECRET to server/.env, then restart it.',
  })
}

/**
 * Access tokens are long-lived bank credentials. This reference keeps them in
 * memory, which means they are lost on restart — fine for local single-user
 * use. For anything longer-lived, persist them in a server-side table that the
 * browser cannot read (Supabase with RLS denying all client access).
 */
const plaidItems = new Map()

app.post('/api/plaid/link-token', async (req, res) => {
  const client = await getPlaidClient()
  if (!client) return plaidUnavailable(res)

  try {
    const response = await client.linkTokenCreate({
      user: { client_user_id: req.body?.user_id || 'life-dashboard-user' },
      client_name: 'Life Dashboard',
      products: PLAID_PRODUCTS,
      country_codes: PLAID_COUNTRY_CODES,
      language: 'en',
    })
    res.json({ link_token: response.data.link_token })
  } catch (err) {
    console.error('link-token failed:', err?.response?.data ?? err.message)
    res.status(502).json({ error: 'Could not create a Plaid link token.' })
  }
})

app.post('/api/plaid/exchange', async (req, res) => {
  const client = await getPlaidClient()
  if (!client) return plaidUnavailable(res)

  const { public_token: publicToken } = req.body ?? {}
  if (!publicToken) return res.status(400).json({ error: 'public_token is required.' })

  try {
    const exchange = await client.itemPublicTokenExchange({ public_token: publicToken })
    const accessToken = exchange.data.access_token
    const itemId = exchange.data.item_id
    plaidItems.set(itemId, accessToken)

    const accounts = await client.accountsGet({ access_token: accessToken })
    res.json({
      item_id: itemId,
      accounts: accounts.data.accounts.map(normalizeAccount(itemId)),
    })
  } catch (err) {
    console.error('exchange failed:', err?.response?.data ?? err.message)
    res.status(502).json({ error: 'Could not exchange the Plaid public token.' })
  }
})

app.get('/api/plaid/accounts', async (_req, res) => {
  const client = await getPlaidClient()
  if (!client) return plaidUnavailable(res)

  try {
    const all = []
    for (const [itemId, accessToken] of plaidItems) {
      const response = await client.accountsGet({ access_token: accessToken })
      all.push(...response.data.accounts.map(normalizeAccount(itemId)))
    }
    res.json({ accounts: all })
  } catch (err) {
    console.error('accounts failed:', err?.response?.data ?? err.message)
    res.status(502).json({ error: 'Could not read accounts from Plaid.' })
  }
})

app.post('/api/plaid/sync', async (_req, res) => {
  const client = await getPlaidClient()
  if (!client) return plaidUnavailable(res)

  try {
    const accounts = []
    const transactions = []

    for (const [itemId, accessToken] of plaidItems) {
      let cursor = undefined
      let hasMore = true

      while (hasMore) {
        const response = await client.transactionsSync({
          access_token: accessToken,
          cursor,
        })
        const data = response.data
        transactions.push(...data.added.map(normalizeTransaction))
        cursor = data.next_cursor
        hasMore = data.has_more
      }

      const accountsResponse = await client.accountsGet({ access_token: accessToken })
      accounts.push(...accountsResponse.data.accounts.map(normalizeAccount(itemId)))
    }

    res.json({ accounts, transactions })
  } catch (err) {
    console.error('sync failed:', err?.response?.data ?? err.message)
    res.status(502).json({ error: 'Could not sync transactions from Plaid.' })
  }
})

const PLAID_TYPE_MAP = {
  depository: { checking: 'checking', savings: 'savings', cd: 'savings', 'money market': 'savings' },
  credit: { 'credit card': 'credit' },
  loan: {},
  investment: {},
}

function normalizeAccount(itemId) {
  return (account) => {
    const subtypeMap = PLAID_TYPE_MAP[account.type] ?? {}
    const type =
      subtypeMap[account.subtype] ??
      (account.type === 'credit'
        ? 'credit'
        : account.type === 'loan'
          ? 'loan'
          : account.type === 'investment'
            ? 'investment'
            : account.type === 'depository'
              ? 'checking'
              : 'other')

    return {
      plaid_account_id: account.account_id,
      plaid_item_id: itemId,
      name: account.name,
      institution: account.official_name ?? null,
      type,
      // Liabilities are stored as a positive "amount owed".
      balance:
        type === 'credit' || type === 'loan'
          ? Math.abs(account.balances.current ?? 0)
          : (account.balances.current ?? 0),
      currency: account.balances.iso_currency_code ?? 'USD',
      is_manual: false,
      updated_at: new Date().toISOString(),
    }
  }
}

/** Plaid signs outflows positive; this app signs them negative. */
function normalizeTransaction(txn) {
  return {
    plaid_transaction_id: txn.transaction_id,
    plaid_account_id: txn.account_id,
    date: txn.date,
    name: txn.name,
    merchant: txn.merchant_name ?? null,
    amount: -txn.amount,
    category: txn.personal_finance_category?.primary
      ? titleCase(txn.personal_finance_category.primary)
      : (txn.category?.[0] ?? 'Other'),
    pending: Boolean(txn.pending),
    notes: null,
  }
}

function titleCase(value) {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

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

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    plaid_configured: plaidConfigured,
    plaid_env: plaidConfigured ? PLAID_ENV : null,
    linked_items: plaidItems.size,
    news_topics: Object.keys(FEEDS),
  })
})

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`)
  console.log(
    plaidConfigured
      ? `Plaid: configured (${PLAID_ENV})`
      : 'Plaid: not configured — bank linking is disabled until you add keys to server/.env',
  )
})
