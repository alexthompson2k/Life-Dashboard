import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  BookOpen,
  CalendarCheck,
  CloudSun,
  Dumbbell,
  LayoutDashboard,
  Menu,
  Monitor,
  Moon,
  Newspaper,
  Repeat,
  Search,
  Settings as SettingsIcon,
  Sun,
  Target,
  Wallet,
  X,
} from 'lucide-react'
import { useTheme } from '../lib/theme'
import { useSettings } from '../lib/settings'
import { isCloudMode } from '../lib/supabase'
import { timeOfDayGreeting } from '../lib/format'
import { CommandPalette } from './CommandPalette'

export const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/financials', label: 'Financials', icon: Wallet },
  { to: '/tasks', label: 'Tasks & Calendar', icon: CalendarCheck },
  { to: '/fitness', label: 'Fitness', icon: Dumbbell },
  { to: '/habits', label: 'Habits', icon: Repeat },
  { to: '/goals', label: 'Goals', icon: Target },
  { to: '/weather', label: 'Weather', icon: CloudSun },
  { to: '/news', label: 'News', icon: Newspaper },
  { to: '/journal', label: 'Journal', icon: BookOpen },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

function ThemeToggle() {
  const { pref, cycle } = useTheme()
  const Icon = pref === 'light' ? Sun : pref === 'dark' ? Moon : Monitor
  return (
    <button
      onClick={cycle}
      className="btn btn-ghost !px-2 !py-2"
      title={`Theme: ${pref}. Click to change.`}
      aria-label={`Theme: ${pref}. Click to change.`}
    >
      <Icon size={16} />
    </button>
  )
}

export function Layout() {
  const { settings } = useSettings()
  const location = useLocation()
  const [navOpen, setNavOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => setNavOpen(false), [location.pathname])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  const name = settings.display_name?.trim()

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-surface-1 transition-transform lg:static lg:translate-x-0 ${
          navOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid h-8 w-8 place-items-center rounded-xl text-sm font-bold text-white"
              style={{ background: 'var(--accent)' }}
            >
              L
            </span>
            <span className="text-sm font-semibold">Life Dashboard</span>
          </div>
          <button
            className="btn btn-ghost !p-1.5 lg:hidden"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
          >
            <X size={16} />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-surface-3 text-ink-primary'
                    : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'
                }`
              }
            >
              <Icon size={16} className="shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-line px-4 py-3">
          <p className="text-[11px] leading-relaxed text-ink-muted">
            {isCloudMode ? 'Synced with Supabase' : 'Local demo data — no cloud keys set'}
          </p>
        </div>
      </aside>

      {navOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden
        />
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-surface-1/85 px-4 py-3 backdrop-blur sm:px-6">
          <button
            className="btn btn-ghost !p-2 lg:hidden"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={16} />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink-primary">
              {timeOfDayGreeting()}
              {name ? `, ${name}` : ''}
            </p>
            <p className="truncate text-xs text-ink-secondary">{today}</p>
          </div>

          <button
            onClick={() => setPaletteOpen(true)}
            className="btn !px-2.5 text-ink-secondary sm:!px-3"
            aria-label="Open command palette"
          >
            <Search size={15} />
            <span className="hidden sm:inline">Search</span>
            <kbd className="ml-1 hidden rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted sm:inline">
              ⌘K
            </kbd>
          </button>

          <ThemeToggle />
        </header>

        <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
