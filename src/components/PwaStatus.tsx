import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Download, RefreshCw, WifiOff, X } from 'lucide-react'

/**
 * The three bits of PWA state worth surfacing:
 *   - a new build is waiting (ask before swapping it in),
 *   - the device is offline (say so, because cloud writes will fail),
 *   - the app is installable (offer it once, then stop asking).
 */
export function PwaStatus() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  const offline = useOffline()
  const install = useInstallPrompt()

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[65] flex flex-col items-center gap-2 p-3 sm:items-end sm:p-4">
      {offline && (
        <Banner icon={<WifiOff size={15} />} tone="warning">
          You are offline. Showing the last data loaded — changes will not save until you
          reconnect.
        </Banner>
      )}

      {needRefresh && (
        <Banner
          icon={<RefreshCw size={15} />}
          tone="accent"
          action={{
            label: 'Reload',
            onClick: () => void updateServiceWorker(true),
          }}
          onDismiss={() => setNeedRefresh(false)}
        >
          A new version is ready.
        </Banner>
      )}

      {install.available && (
        <Banner
          icon={<Download size={15} />}
          tone="accent"
          action={{ label: 'Install', onClick: () => void install.prompt() }}
          onDismiss={install.dismiss}
        >
          Add the dashboard to your home screen.
        </Banner>
      )}
    </div>
  )
}

function Banner({
  icon,
  children,
  tone,
  action,
  onDismiss,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  tone: 'accent' | 'warning'
  action?: { label: string; onClick: () => void }
  onDismiss?: () => void
}) {
  const color = tone === 'warning' ? 'var(--status-warning)' : 'var(--accent)'
  return (
    <div
      className="card pointer-events-auto flex w-full max-w-sm items-center gap-2.5 px-4 py-3 text-xs text-ink-secondary shadow-lg"
      style={{ borderLeft: `3px solid ${color}` }}
      role="status"
    >
      <span style={{ color }} className="shrink-0">
        {icon}
      </span>
      <span className="min-w-0 flex-1 leading-relaxed">{children}</span>
      {action && (
        <button onClick={action.onClick} className="btn btn-primary !px-2.5 !py-1 !text-xs">
          {action.label}
        </button>
      )}
      {onDismiss && (
        <button onClick={onDismiss} className="btn btn-ghost !p-1" aria-label="Dismiss">
          <X size={14} />
        </button>
      )}
    </div>
  )
}

function useOffline() {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine)

  useEffect(() => {
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  return offline
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const INSTALL_DISMISSED_KEY = 'ld.install.dismissed'

function useInstallPrompt() {
  const [event, setEvent] = useState<InstallPromptEvent | null>(null)

  useEffect(() => {
    if (localStorage.getItem(INSTALL_DISMISSED_KEY)) return
    const onPrompt = (e: Event) => {
      // Chrome fires this instead of showing its own bar once we preventDefault.
      e.preventDefault()
      setEvent(e as InstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  return {
    available: event !== null,
    prompt: async () => {
      if (!event) return
      await event.prompt()
      await event.userChoice
      setEvent(null)
    },
    dismiss: () => {
      localStorage.setItem(INSTALL_DISMISSED_KEY, '1')
      setEvent(null)
    },
  }
}
