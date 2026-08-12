import { useRef, useState } from 'react'
import { Download, LogOut, RotateCcw, Upload } from 'lucide-react'
import { useSettings } from '../lib/settings'
import { isCloudMode, supabase } from '../lib/supabase'
import { clearLocalData, ensureSeeded, exportLocalData, importLocalData } from '../lib/store'
import { Button, Callout, Card, Field, Select, useToast } from '../components/ui'
import { useTheme } from '../lib/theme'
import type { UnitSystem } from '../lib/types'

export default function Settings() {
  const { settings, save } = useSettings()
  const { pref, setPref } = useTheme()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(settings.display_name)

  const download = () => {
    const blob = new Blob([exportLocalData()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `life-dashboard-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.push('Backup downloaded')
  }

  const upload = async (file: File) => {
    try {
      importLocalData(await file.text())
      toast.push('Data imported')
    } catch (err) {
      toast.push(`Import failed: ${(err as Error).message}`, 'error')
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="text-xs text-ink-secondary">
          {isCloudMode ? 'Signed in — data syncs to Supabase' : 'Running on local data'}
        </p>
      </div>

      <Card title="You">
        <div className="space-y-3">
          <Field label="Display name" hint="Used in the greeting at the top of the page">
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void save({ display_name: name })}
              placeholder="Alex"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Units">
              <Select
                value={settings.unit_system}
                onChange={(e) => void save({ unit_system: e.target.value as UnitSystem })}
                options={[
                  { value: 'imperial', label: 'Imperial (lb, °F, mph)' },
                  { value: 'metric', label: 'Metric (kg, °C, km/h)' },
                ]}
              />
            </Field>
            <Field label="Currency">
              <Select
                value={settings.currency}
                onChange={(e) => void save({ currency: e.target.value })}
                options={['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR'].map((c) => ({
                  value: c,
                  label: c,
                }))}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Week starts on">
              <Select
                value={String(settings.week_starts_on)}
                onChange={(e) =>
                  void save({ week_starts_on: Number(e.target.value) as 0 | 1 })
                }
                options={[
                  { value: '1', label: 'Monday' },
                  { value: '0', label: 'Sunday' },
                ]}
              />
            </Field>
            <Field label="Theme">
              <Select
                value={pref}
                onChange={(e) => setPref(e.target.value as typeof pref)}
                options={[
                  { value: 'system', label: 'Match system' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Location" subtitle="Used for the weather panel">
        <p className="text-sm text-ink-primary">{settings.location_name}</p>
        <p className="tnum mt-1 text-xs text-ink-muted">
          {settings.latitude.toFixed(4)}, {settings.longitude.toFixed(4)}
        </p>
        <p className="mt-2 text-xs text-ink-secondary">
          Change it from the Weather page — search a city there and it saves here.
        </p>
      </Card>

      {!isCloudMode && (
        <Card title="Your data" subtitle="Everything lives in this browser until you add cloud keys">
          <div className="space-y-3">
            <Callout intent="info">
              No Supabase keys are set, so the dashboard is running on a local sample dataset. Add{' '}
              <code className="font-mono">VITE_SUPABASE_URL</code> and{' '}
              <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> to{' '}
              <code className="font-mono">.env.local</code> to switch to your own synced data —
              see the README.
            </Callout>

            <div className="flex flex-wrap gap-2">
              <Button onClick={download}>
                <Download size={15} /> Export backup
              </Button>
              <Button onClick={() => fileRef.current?.click()}>
                <Upload size={15} /> Import backup
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void upload(file)
                  e.target.value = ''
                }}
              />
              <Button
                variant="danger"
                onClick={() => {
                  if (!confirm('Reset all local data back to the sample dataset?')) return
                  clearLocalData()
                  ensureSeeded(true)
                  toast.push('Local data reset')
                }}
              >
                <RotateCcw size={15} /> Reset to sample data
              </Button>
            </div>
          </div>
        </Card>
      )}

      {isCloudMode && (
        <Card title="Account">
          <Button
            onClick={async () => {
              await supabase?.auth.signOut()
            }}
          >
            <LogOut size={15} /> Sign out
          </Button>
        </Card>
      )}

      <Card title="Keyboard shortcuts">
        <ul className="space-y-2 text-xs text-ink-secondary">
          <li className="flex items-center justify-between">
            <span>Open the command palette</span>
            <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono">⌘K</kbd>
          </li>
          <li className="flex items-center justify-between">
            <span>Add a task from the palette</span>
            <code className="font-mono text-ink-muted">add call the dentist</code>
          </li>
          <li className="flex items-center justify-between">
            <span>Close a dialog</span>
            <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono">Esc</kbd>
          </li>
        </ul>
      </Card>
    </div>
  )
}
