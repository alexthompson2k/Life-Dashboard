import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Changing this resets the boundary — pass the route so navigation recovers. */
  resetKey?: string
  /** Shown instead of the default panel, e.g. a compact one inside a card. */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
  error: Error | null
}

/**
 * Without this, one thrown render takes the entire dashboard to a blank page —
 * including the navigation, so there is no way back. Wrapping the routed outlet
 * keeps the shell alive and confines the damage to the page that broke.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error in a dashboard page:', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    // Navigating away from the broken page should clear the error.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)

    return (
      <div className="card mx-auto max-w-lg p-6 text-center">
        <div className="mb-3 flex justify-center" style={{ color: 'var(--status-critical)' }}>
          <AlertTriangle size={22} />
        </div>
        <h2 className="text-sm font-semibold text-ink-primary">This page hit an error</h2>
        <p className="mt-1 text-xs text-ink-secondary">
          The rest of the dashboard is fine — use the navigation to move on, or try again.
        </p>

        <pre className="mt-4 max-h-32 overflow-auto rounded-xl bg-surface-2 p-3 text-left text-[11px] leading-relaxed text-ink-secondary">
          {error.message}
        </pre>

        <div className="mt-4 flex justify-center gap-2">
          <button className="btn" onClick={this.reset}>
            <RefreshCw size={15} /> Try again
          </button>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    )
  }
}
