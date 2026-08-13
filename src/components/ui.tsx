import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AlertCircle, Check, Info, X } from 'lucide-react'

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

export function Card({
  title,
  subtitle,
  action,
  children,
  className = '',
  bodyClassName = '',
}: {
  title?: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={`card flex flex-col ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink-primary">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-secondary">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={`flex-1 p-5 ${bodyClassName}`}>{children}</div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Stat tile — the right form when the answer is one number            */
/* ------------------------------------------------------------------ */

export function Stat({
  label,
  value,
  delta,
  deltaLabel,
  intent = 'neutral',
  hint,
  icon,
}: {
  label: string
  value: ReactNode
  delta?: number
  deltaLabel?: string
  intent?: 'neutral' | 'good' | 'bad'
  hint?: string
  icon?: ReactNode
}) {
  const deltaIntent =
    intent !== 'neutral'
      ? intent
      : delta === undefined
        ? 'neutral'
        : delta >= 0
          ? 'good'
          : 'bad'
  const deltaColor =
    deltaIntent === 'good'
      ? 'text-[var(--status-good)]'
      : deltaIntent === 'bad'
        ? 'text-[var(--status-critical)]'
        : 'text-ink-secondary'

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-secondary">
          {label}
        </p>
        {icon && <span className="text-ink-muted">{icon}</span>}
      </div>
      <p className="tnum mt-2 text-2xl font-semibold text-ink-primary">{value}</p>
      {(deltaLabel || delta !== undefined) && (
        <p className={`tnum mt-1 text-xs font-medium ${deltaColor}`}>
          {deltaLabel ?? `${delta! >= 0 ? '+' : '−'}${Math.abs(delta!).toFixed(1)}%`}
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

export function ProgressBar({
  value,
  max = 100,
  state = 'good',
  className = '',
}: {
  value: number
  max?: number
  state?: 'good' | 'warning' | 'critical' | 'accent'
  className?: string
}) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100))
  const color =
    state === 'critical'
      ? 'var(--status-critical)'
      : state === 'warning'
        ? 'var(--status-warning)'
        : state === 'accent'
          ? 'var(--accent)'
          : 'var(--status-good)'

  return (
    <div
      className={`h-2 w-full overflow-hidden rounded-full bg-surface-3 ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Buttons & form fields                                               */
/* ------------------------------------------------------------------ */

export function Button({
  variant = 'default',
  className = '',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
}) {
  const variantClass =
    variant === 'primary'
      ? 'btn-primary'
      : variant === 'ghost'
        ? 'btn-ghost'
        : variant === 'danger'
          ? 'btn-danger'
          : ''
  return (
    <button className={`btn ${variantClass} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
    </label>
  )
}

export function Select({
  options,
  className = '',
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: Array<{ value: string; label: string }>
}) {
  return (
    <select className={`input ${className}`} {...props}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string }>
  size?: 'sm' | 'md'
}) {
  return (
    <div
      role="tablist"
      className="inline-flex items-center gap-1 rounded-xl border border-line bg-surface-2 p-1"
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`rounded-lg font-medium transition-colors ${
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'
            } ${
              active
                ? 'bg-surface-1 text-ink-primary shadow-sm'
                : 'text-ink-secondary hover:text-ink-primary'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  width?: string
}) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.activeElement as HTMLElement | null
    // Focus the first field so the dialog is immediately usable from the keyboard.
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus()
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      previous?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`card relative z-10 w-full ${width} max-h-[90vh] overflow-y-auto rounded-b-none sm:rounded-2xl`}
      >
        <header className="sticky top-0 flex items-center justify-between gap-3 border-b border-line bg-surface-1 px-5 py-4">
          <h2 id={titleId} className="text-sm font-semibold">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="btn btn-ghost !p-1.5"
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </header>
        <div className="space-y-4 p-5">{children}</div>
        {footer && (
          <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-surface-1 px-5 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Empty & error states                                                */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      {icon && <div className="text-ink-muted">{icon}</div>}
      <p className="text-sm font-medium text-ink-primary">{title}</p>
      {description && <p className="max-w-sm text-xs text-ink-secondary">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Callout({
  intent = 'info',
  children,
}: {
  intent?: 'info' | 'warning' | 'critical'
  children: ReactNode
}) {
  const color =
    intent === 'critical'
      ? 'var(--status-critical)'
      : intent === 'warning'
        ? 'var(--status-warning)'
        : 'var(--accent)'
  const Icon = intent === 'info' ? Info : AlertCircle
  return (
    <div
      className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-2 p-3 text-xs text-ink-secondary"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <Icon size={15} style={{ color }} className="mt-px shrink-0" />
      <div className="min-w-0 leading-relaxed">{children}</div>
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-surface-3 ${className}`} />
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

interface ToastAction {
  label: string
  onClick: () => void | Promise<void>
}

interface Toast {
  id: number
  message: string
  intent: 'success' | 'error'
  action?: ToastAction
}

interface ToastApi {
  push: (message: string, intent?: Toast['intent']) => void
  /** A toast carrying an action, e.g. undoing a delete. Stays up longer. */
  pushAction: (message: string, action: ToastAction, intent?: Toast['intent']) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const add = useCallback(
    (
      message: string,
      intent: Toast['intent'],
      action: ToastAction | undefined,
      ms: number,
    ) => {
      const id = Date.now() + Math.random()
      setToasts((t) => [...t, { id, message, intent, action }])
      setTimeout(() => dismiss(id), ms)
      return id
    },
    [dismiss],
  )

  const push = useCallback(
    (message: string, intent: Toast['intent'] = 'success') => {
      add(message, intent, undefined, 4000)
    },
    [add],
  )

  const pushAction = useCallback(
    (message: string, action: ToastAction, intent: Toast['intent'] = 'success') => {
      // Longer window: an undo you cannot reach in time is not an undo.
      const id = add(
        message,
        intent,
        {
          label: action.label,
          onClick: async () => {
            await action.onClick()
            dismiss(id)
          },
        },
        8000,
      )
    },
    [add, dismiss],
  )

  const value = useMemo(() => ({ push, pushAction }), [push, pushAction])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="card pointer-events-auto flex items-center gap-2.5 px-4 py-3 text-sm"
            style={{
              borderLeft: `3px solid ${
                t.intent === 'error' ? 'var(--status-critical)' : 'var(--status-good)'
              }`,
            }}
          >
            {t.intent === 'error' ? (
              <AlertCircle size={15} style={{ color: 'var(--status-critical)' }} />
            ) : (
              <Check size={15} style={{ color: 'var(--status-good)' }} />
            )}
            <span className="flex-1 text-ink-primary">{t.message}</span>
            {t.action && (
              <button
                onClick={() => void t.action!.onClick()}
                className="btn !px-2.5 !py-1 !text-xs font-semibold"
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
