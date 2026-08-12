import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isCloudMode, supabase } from '../lib/supabase'
import { Button, Callout, Field } from './ui'

/**
 * Cloud mode requires a signed-in user because every table is behind row-level
 * security. Local mode has no accounts at all, so the gate is a pass-through.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!isCloudMode)

  useEffect(() => {
    if (!isCloudMode || !supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!isCloudMode) return <>{children}</>

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center">
        <p className="text-sm text-ink-secondary">Loading…</p>
      </div>
    )
  }

  if (!session) return <SignIn />

  return <>{children}</>
}

function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError(null)
    setStatus(null)

    const { error: authError } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })

    if (authError) {
      setError(authError.message)
    } else if (mode === 'signup') {
      setStatus('Check your inbox to confirm the address, then sign in.')
    }
    setBusy(false)
  }

  return (
    <div className="grid min-h-screen place-items-center bg-surface-0 px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-9 w-9 place-items-center rounded-xl text-sm font-bold text-white"
            style={{ background: 'var(--accent)' }}
          >
            L
          </span>
          <div>
            <h1 className="text-sm font-semibold">Life Dashboard</h1>
            <p className="text-xs text-ink-secondary">
              {mode === 'signin' ? 'Sign in to your dashboard' : 'Create your account'}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <Field label="Email">
            <input
              type="email"
              required
              autoComplete="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              required
              minLength={8}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          {error && <Callout intent="critical">{error}</Callout>}
          {status && <Callout intent="info">{status}</Callout>}

          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </Button>
        </form>

        <button
          onClick={() => {
            setMode((m) => (m === 'signin' ? 'signup' : 'signin'))
            setError(null)
            setStatus(null)
          }}
          className="mt-4 w-full text-center text-xs text-ink-secondary hover:text-ink-primary"
        >
          {mode === 'signin'
            ? 'Need an account? Sign up'
            : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}
