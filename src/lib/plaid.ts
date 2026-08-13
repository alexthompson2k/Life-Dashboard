import { apiJson } from './api'

/**
 * Browser side of the Plaid link flow.
 *
 * The browser only ever handles the public token — the access token is
 * exchanged and stored server-side, and every call is authenticated so the
 * server derives the account from the session rather than the request.
 */

export interface LinkedItem {
  item_id: string
  institution_name: string | null
  last_synced_at: string | null
}

export interface SyncResult {
  items: number
  accounts: number
  added: number
  modified: number
  removed: number
}

interface PlaidHandler {
  open: () => void
  exit: () => void
  destroy: () => void
}

interface PlaidLinkMetadata {
  institution?: { name?: string } | null
}

interface PlaidFactory {
  create: (config: {
    token: string
    onSuccess: (publicToken: string, metadata: PlaidLinkMetadata) => void | Promise<void>
    onExit: (error: unknown) => void
  }) => PlaidHandler
}

function plaidScript(): PlaidFactory {
  const factory = (window as unknown as { Plaid?: PlaidFactory }).Plaid
  if (!factory) {
    throw new Error(
      'The Plaid Link script has not loaded. Check your connection and reload the page.',
    )
  }
  return factory
}

export async function listItems(): Promise<LinkedItem[]> {
  const { items } = await apiJson<{ items: LinkedItem[] }>('/api/plaid/items')
  return items
}

export function syncNow(): Promise<SyncResult> {
  return apiJson<SyncResult>('/api/plaid/sync', { method: 'POST' })
}

export function unlink(itemId: string): Promise<{ ok: boolean }> {
  return apiJson(`/api/plaid/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' })
}

/**
 * Opens Plaid Link and resolves once the exchange and first sync have finished,
 * so the caller can refresh straight into populated accounts.
 */
export async function linkBank(): Promise<SyncResult | null> {
  const { link_token: linkToken } = await apiJson<{ link_token: string }>(
    '/api/plaid/link-token',
    { method: 'POST' },
  )

  const factory = plaidScript()

  return new Promise<SyncResult | null>((resolve, reject) => {
    const handler = factory.create({
      token: linkToken,
      onSuccess: async (publicToken, metadata) => {
        try {
          const result = await apiJson<SyncResult>('/api/plaid/exchange', {
            method: 'POST',
            body: {
              public_token: publicToken,
              institution_name: metadata?.institution?.name ?? null,
            },
          })
          resolve(result)
        } catch (err) {
          reject(err)
        } finally {
          handler.destroy()
        }
      },
      onExit: (error) => {
        handler.destroy()
        // Closing the dialog deliberately is not an error worth reporting.
        if (error) reject(new Error('Plaid Link closed before finishing.'))
        else resolve(null)
      },
    })

    handler.open()
  })
}
