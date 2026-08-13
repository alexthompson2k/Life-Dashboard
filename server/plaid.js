import { serviceClient } from './supabase.js'

/**
 * Plaid integration.
 *
 * Access tokens are bank credentials, so they live in `plaid_items` — a table
 * with RLS enabled and no policies, reachable only by the service role. They
 * used to sit in a module-level Map, which meant every server restart forced a
 * re-link.
 *
 * Sync is cursor-based and idempotent: accounts upsert on `plaid_account_id`
 * and transactions on `plaid_transaction_id`, both of which are unique per user
 * in the schema. Running a sync twice changes nothing.
 */

const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID
const PLAID_SECRET = process.env.PLAID_SECRET
const PLAID_ENV = process.env.PLAID_ENV || 'sandbox'
const PLAID_PRODUCTS = (process.env.PLAID_PRODUCTS || 'transactions').split(',')
const PLAID_COUNTRY_CODES = (process.env.PLAID_COUNTRY_CODES || 'US').split(',')

export const plaidConfigured = Boolean(PLAID_CLIENT_ID && PLAID_SECRET)
export const plaidEnv = PLAID_ENV

let client = null

export async function getPlaidClient() {
  if (!plaidConfigured) return null
  if (client) return client

  // Imported lazily so the server still runs without the SDK installed.
  const { Configuration, PlaidApi, PlaidEnvironments } = await import('plaid')
  client = new PlaidApi(
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
  return client
}

/* ------------------------------------------------------------------ */
/* Normalisation (pure — unit tested)                                  */
/* ------------------------------------------------------------------ */

const DEPOSITORY_SUBTYPES = {
  checking: 'checking',
  savings: 'savings',
  cd: 'savings',
  'money market': 'savings',
  'cash management': 'checking',
}

/** Maps a Plaid account onto the app's own account shape. */
export function normalizeAccount(account, itemId) {
  const type =
    account.type === 'depository'
      ? (DEPOSITORY_SUBTYPES[account.subtype] ?? 'checking')
      : account.type === 'credit'
        ? 'credit'
        : account.type === 'loan'
          ? 'loan'
          : account.type === 'investment'
            ? 'investment'
            : 'other'

  const balance = account.balances?.current ?? 0

  return {
    plaid_account_id: account.account_id,
    plaid_item_id: itemId,
    name: account.name ?? 'Account',
    institution: account.official_name ?? null,
    type,
    // Liabilities are stored as a positive "amount owed"; net worth subtracts
    // them. Plaid reports card balances positive already, but a credited card
    // can go negative, so this is normalised rather than assumed.
    balance: type === 'credit' || type === 'loan' ? Math.abs(balance) : balance,
    currency: account.balances?.iso_currency_code ?? 'USD',
    is_manual: false,
    updated_at: new Date().toISOString(),
  }
}

function titleCase(value) {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Plaid's personal finance categories are coarse; these map the common ones
 * onto the categories the budgets UI already offers so a synced transaction
 * lands in a budget rather than in "Other".
 */
const CATEGORY_MAP = {
  FOOD_AND_DRINK: 'Dining',
  GROCERIES: 'Groceries',
  GENERAL_MERCHANDISE: 'Shopping',
  TRANSPORTATION: 'Transport',
  TRAVEL: 'Travel',
  RENT_AND_UTILITIES: 'Utilities',
  ENTERTAINMENT: 'Entertainment',
  MEDICAL: 'Health',
  PERSONAL_CARE: 'Health',
  INCOME: 'Income',
  TRANSFER_IN: 'Transfer',
  TRANSFER_OUT: 'Transfer',
  LOAN_PAYMENTS: 'Loan Payment',
  BANK_FEES: 'Other',
  HOME_IMPROVEMENT: 'Shopping',
  GENERAL_SERVICES: 'Other',
  GOVERNMENT_AND_NON_PROFIT: 'Other',
}

export function normalizeTransaction(txn) {
  const primary = txn.personal_finance_category?.primary
  const detailed = txn.personal_finance_category?.detailed ?? ''

  // Groceries live under FOOD_AND_DRINK in Plaid's taxonomy, but people budget
  // for them separately from eating out.
  const category = detailed.includes('GROCERIES')
    ? 'Groceries'
    : (CATEGORY_MAP[primary] ?? (primary ? titleCase(primary) : 'Other'))

  return {
    plaid_transaction_id: txn.transaction_id,
    plaid_account_id: txn.account_id,
    date: txn.date,
    name: txn.name ?? txn.merchant_name ?? 'Transaction',
    merchant: txn.merchant_name ?? null,
    // Plaid signs outflows positive; this app signs them negative.
    amount: -txn.amount,
    category,
    pending: Boolean(txn.pending),
    notes: null,
  }
}

/* ------------------------------------------------------------------ */
/* Item storage                                                        */
/* ------------------------------------------------------------------ */

async function itemsFor(userId) {
  const db = serviceClient()
  const { data, error } = await db.from('plaid_items').select('*').eq('user_id', userId)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function createLinkToken(userId) {
  const plaid = await getPlaidClient()
  const response = await plaid.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: 'Life Dashboard',
    products: PLAID_PRODUCTS,
    country_codes: PLAID_COUNTRY_CODES,
    language: 'en',
  })
  return response.data.link_token
}

export async function exchangePublicToken(userId, publicToken, institutionName = null) {
  const plaid = await getPlaidClient()
  const db = serviceClient()

  const exchange = await plaid.itemPublicTokenExchange({ public_token: publicToken })
  const accessToken = exchange.data.access_token
  const itemId = exchange.data.item_id

  const { error } = await db.from('plaid_items').upsert(
    {
      user_id: userId,
      item_id: itemId,
      access_token: accessToken,
      institution_name: institutionName,
      sync_cursor: null,
    },
    { onConflict: 'item_id' },
  )
  if (error) throw new Error(error.message)

  // Pull accounts straight away so the UI has something the moment Link closes.
  return syncUser(userId)
}

export async function removeItem(userId, itemId) {
  const db = serviceClient()
  const { error } = await db
    .from('plaid_items')
    .delete()
    .eq('user_id', userId)
    .eq('item_id', itemId)
  if (error) throw new Error(error.message)
}

/* ------------------------------------------------------------------ */
/* Sync                                                                */
/* ------------------------------------------------------------------ */

/**
 * Pulls accounts and transactions for every linked item and writes them to
 * Postgres. Returns counts rather than rows — the browser re-reads through its
 * own Supabase client, which keeps RLS in the path.
 */
export async function syncUser(userId) {
  const plaid = await getPlaidClient()
  const db = serviceClient()
  if (!plaid || !db) throw new Error('Plaid or Supabase is not configured.')

  const items = await itemsFor(userId)
  if (!items.length) return { items: 0, accounts: 0, added: 0, modified: 0, removed: 0 }

  let accountCount = 0
  let added = 0
  let modified = 0
  let removed = 0

  for (const item of items) {
    /* --- accounts --- */
    const accountsResponse = await plaid.accountsGet({ access_token: item.access_token })
    const accounts = accountsResponse.data.accounts.map((a) =>
      normalizeAccount(a, item.item_id),
    )

    if (accounts.length) {
      const { error } = await db.from('accounts').upsert(
        accounts.map((a) => ({ ...a, user_id: userId })),
        { onConflict: 'user_id,plaid_account_id' },
      )
      if (error) throw new Error(`Saving accounts failed: ${error.message}`)
      accountCount += accounts.length
    }

    // Map Plaid account ids to our row ids so transactions can reference them.
    const { data: savedAccounts } = await db
      .from('accounts')
      .select('id,plaid_account_id')
      .eq('user_id', userId)
      .not('plaid_account_id', 'is', null)
    const accountIdByPlaidId = new Map(
      (savedAccounts ?? []).map((a) => [a.plaid_account_id, a.id]),
    )

    /* --- transactions --- */
    let cursor = item.sync_cursor ?? undefined
    let hasMore = true

    while (hasMore) {
      const response = await plaid.transactionsSync({
        access_token: item.access_token,
        cursor,
        count: 250,
      })
      const data = response.data

      const upserts = [...data.added, ...data.modified].map((txn) => {
        const row = normalizeTransaction(txn)
        return {
          user_id: userId,
          account_id: accountIdByPlaidId.get(row.plaid_account_id) ?? null,
          date: row.date,
          name: row.name,
          merchant: row.merchant,
          amount: row.amount,
          category: row.category,
          pending: row.pending,
          plaid_transaction_id: row.plaid_transaction_id,
          notes: null,
        }
      })

      if (upserts.length) {
        const { error } = await db
          .from('transactions')
          .upsert(upserts, { onConflict: 'user_id,plaid_transaction_id' })
        if (error) throw new Error(`Saving transactions failed: ${error.message}`)
      }

      added += data.added.length
      modified += data.modified.length

      // Plaid removes transactions that were pending and never settled.
      const removedIds = data.removed.map((r) => r.transaction_id)
      if (removedIds.length) {
        const { error } = await db
          .from('transactions')
          .delete()
          .eq('user_id', userId)
          .in('plaid_transaction_id', removedIds)
        if (error) throw new Error(`Removing transactions failed: ${error.message}`)
        removed += removedIds.length
      }

      cursor = data.next_cursor
      hasMore = data.has_more
    }

    // Persist the cursor so the next sync is incremental rather than a full
    // re-download.
    const { error } = await db
      .from('plaid_items')
      .update({ sync_cursor: cursor, last_synced_at: new Date().toISOString() })
      .eq('item_id', item.item_id)
      .eq('user_id', userId)
    if (error) throw new Error(`Saving sync cursor failed: ${error.message}`)
  }

  return { items: items.length, accounts: accountCount, added, modified, removed }
}

export async function linkedItems(userId) {
  const items = await itemsFor(userId)
  return items.map((item) => ({
    item_id: item.item_id,
    institution_name: item.institution_name,
    last_synced_at: item.last_synced_at ?? null,
  }))
}
