import { apiUrl } from './api'
import { supabase } from './supabase'

/**
 * Browser side of the daily brief.
 *
 * The notification has to arrive when the app is closed, so the server sends
 * it — which means this only works in cloud mode. There is no server-side copy
 * of local-mode data to build a brief from.
 */

export type PushSupport =
  | 'ready'
  | 'unsupported'
  | 'needs-install'
  | 'needs-cloud'
  | 'server-disabled'

export interface PushConfig {
  enabled: boolean
  public_key: string | null
}

/** iOS only allows Web Push once the PWA is installed to the home screen. */
export function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari's non-standard flag.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

export async function fetchPushConfig(): Promise<PushConfig> {
  const res = await fetch(apiUrl('/api/push/config'))
  if (!res.ok) throw new Error('Could not reach the notification service.')
  return (await res.json()) as PushConfig
}

export function localSupport(): Exclude<PushSupport, 'server-disabled' | 'needs-cloud'> | 'ready' {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported'
  }
  if (isIOS() && !isStandalone()) return 'needs-install'
  return 'ready'
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
  const token = data.session?.access_token
  if (!token) throw new Error('You need to be signed in to enable the daily brief.')
  return { Authorization: `Bearer ${token}` }
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

export async function subscribe(publicKey: string): Promise<void> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked for this site. Allow them in your browser settings first.'
        : 'Notification permission was dismissed.',
    )
  }

  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }))

  const res = await fetch(apiUrl('/api/push/subscribe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? 'Could not register for notifications.')
  }
}

export async function unsubscribe(): Promise<void> {
  const subscription = await currentSubscription()
  if (!subscription) return

  await fetch(apiUrl('/api/push/unsubscribe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => {
    /* Losing the server record is not worth blocking the local unsubscribe. */
  })

  await subscription.unsubscribe()
}

export async function sendTestBrief(): Promise<string> {
  const res = await fetch(apiUrl('/api/push/test'), {
    method: 'POST',
    headers: await authHeader(),
  })
  const body = (await res.json().catch(() => ({}))) as {
    error?: string
    preview?: { title: string; body: string }
  }
  if (!res.ok) throw new Error(body.error ?? 'Could not send a test notification.')
  return body.preview ? `${body.preview.title} — ${body.preview.body}` : 'Sent.'
}
