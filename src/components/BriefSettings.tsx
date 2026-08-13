import { useCallback, useEffect, useState } from 'react'
import { Bell, BellOff, Send } from 'lucide-react'
import { useSettings } from '../lib/settings'
import { isCloudMode } from '../lib/supabase'
import {
  currentSubscription,
  fetchPushConfig,
  isStandalone,
  localSupport,
  sendTestBrief,
  subscribe,
  unsubscribe,
} from '../lib/push'
import { Button, Callout, Card, Field, useToast } from './ui'

/**
 * Notification setup. Every unavailable path says *why* it is unavailable and
 * what to do about it — "notifications aren't working" with no explanation is
 * the most annoying possible outcome here.
 */
export function BriefSettings() {
  const { settings, save } = useSettings()
  const toast = useToast()

  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [serverEnabled, setServerEnabled] = useState<boolean | null>(null)
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)

  const support = typeof window === 'undefined' ? 'unsupported' : localSupport()

  const refresh = useCallback(async () => {
    setSubscribed((await currentSubscription()) !== null)
  }, [])

  useEffect(() => {
    if (!isCloudMode) {
      setServerEnabled(false)
      return
    }
    fetchPushConfig()
      .then((config) => {
        setServerEnabled(config.enabled)
        setPublicKey(config.public_key)
      })
      .catch(() => setServerEnabled(false))
    void refresh()
  }, [refresh])

  const enable = async () => {
    if (!publicKey) return
    setBusy(true)
    try {
      await subscribe(publicKey)
      await save({
        brief_enabled: true,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
      })
      await refresh()
      toast.push('Daily brief on')
    } catch (err) {
      toast.push((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    try {
      await unsubscribe()
      await save({ brief_enabled: false })
      await refresh()
      toast.push('Daily brief off')
    } catch (err) {
      toast.push((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true)
    try {
      toast.push(await sendTestBrief())
    } catch (err) {
      toast.push((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="Daily brief"
      subtitle="One notification each morning: what's due, what's on, and anything off track"
    >
      <div className="space-y-3">
        {!isCloudMode ? (
          <Callout intent="info">
            The brief is sent by the server while the app is closed, so it needs cloud mode.
            Add your Supabase keys and it becomes available here.
          </Callout>
        ) : support === 'needs-install' ? (
          <Callout intent="info">
            On iPhone and iPad, notifications only work once the dashboard is installed to
            the home screen. Open the share menu and choose <em>Add to Home Screen</em>,
            then come back to this page.
          </Callout>
        ) : support === 'unsupported' ? (
          <Callout intent="warning">
            This browser does not support web push notifications.
          </Callout>
        ) : serverEnabled === false ? (
          <Callout intent="warning">
            The server has no VAPID keys, so it cannot send notifications yet. Generate a
            pair with <code className="font-mono">npx web-push generate-vapid-keys</code>{' '}
            and add them to <code className="font-mono">server/.env</code>.
          </Callout>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {subscribed && settings.brief_enabled ? (
                <Button onClick={() => void disable()} disabled={busy}>
                  <BellOff size={15} /> Turn off
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => void enable()}
                  disabled={busy || !publicKey}
                >
                  <Bell size={15} /> Turn on
                </Button>
              )}

              {subscribed && (
                <Button onClick={() => void test()} disabled={busy}>
                  <Send size={15} /> Send one now
                </Button>
              )}
            </div>

            <Field
              label="Time"
              hint={`Sent in your local timezone (${settings.timezone}).`}
            >
              <input
                type="time"
                className="input max-w-[10rem]"
                value={settings.brief_time}
                onChange={(e) => void save({ brief_time: e.target.value })}
              />
            </Field>

            {!isStandalone() && (
              <p className="text-xs text-ink-muted">
                Installing the dashboard to your home screen makes notifications more
                reliable, and opens it without browser chrome.
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
