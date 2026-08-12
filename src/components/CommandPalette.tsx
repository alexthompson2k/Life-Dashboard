import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft } from 'lucide-react'
import { NAV } from './Layout'
import { useTable } from '../lib/store'
import { toISODate } from '../lib/format'
import { useToast } from './ui'

interface Command {
  id: string
  label: string
  hint?: string
  group: string
  run: () => void | Promise<void>
}

/**
 * ⌘K palette. Navigation plus the handful of captures that are worth doing
 * without first finding the right page — adding a task or logging weight
 * should take one keystroke and a sentence.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const tasks = useTable('tasks')
  const weights = useTable('weights')
  const toast = useToast()

  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const navCommands: Command[] = NAV.map((item) => ({
      id: `nav:${item.to}`,
      label: item.label,
      group: 'Go to',
      run: () => navigate(item.to),
    }))

    const actions: Command[] = []
    const trimmed = query.trim()

    // "add <text>" captures a task without leaving the keyboard.
    const addMatch = /^(?:add|task|todo)\s+(.+)/i.exec(trimmed)
    if (addMatch) {
      const title = addMatch[1]
      actions.push({
        id: 'action:add-task',
        label: `Add task “${title}”`,
        hint: 'Due today',
        group: 'Actions',
        run: async () => {
          await tasks.insert({
            title,
            notes: null,
            due_date: toISODate(),
            due_time: null,
            priority: 'medium',
            completed: false,
            completed_at: null,
            list: 'Inbox',
            recurrence: 'none',
            created_at: new Date().toISOString(),
          })
          toast.push('Task added')
        },
      })
    }

    // "weight 178.4" logs today's weigh-in.
    const weightMatch = /^(?:weight|weigh|wt)\s+([\d.]+)/i.exec(trimmed)
    if (weightMatch) {
      const raw = Number(weightMatch[1])
      if (!Number.isNaN(raw)) {
        actions.push({
          id: 'action:log-weight',
          label: `Log weight ${raw}`,
          hint: 'Uses the unit set in Settings',
          group: 'Actions',
          run: async () => {
            navigate('/fitness')
            toast.push(`Open the weigh-in form to confirm ${raw}`)
          },
        })
      }
    }

    return [...actions, ...navCommands]
  }, [query, navigate, tasks, toast, weights])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter(
      (c) => c.group === 'Actions' || c.label.toLowerCase().includes(q),
    )
  }, [commands, query])

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  if (!open) return null

  const runAt = async (index: number) => {
    const command = filtered[index]
    if (!command) return
    onClose()
    await command.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => (c + 1) % Math.max(1, filtered.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => (c - 1 + filtered.length) % Math.max(1, filtered.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void runAt(cursor)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  let lastGroup = ''

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        className="card relative z-10 w-full max-w-lg overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Jump to a page, or type “add call the dentist”"
          className="w-full border-b border-line bg-transparent px-4 py-3.5 text-sm text-ink-primary outline-none placeholder:text-ink-muted"
          aria-label="Command input"
        />

        <ul className="max-h-80 overflow-y-auto py-2" role="listbox">
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-xs text-ink-muted">No matches</li>
          )}
          {filtered.map((command, i) => {
            const showGroup = command.group !== lastGroup
            lastGroup = command.group
            return (
              <li key={command.id}>
                {showGroup && (
                  <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                    {command.group}
                  </p>
                )}
                <button
                  role="option"
                  aria-selected={i === cursor}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => void runAt(i)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${
                    i === cursor ? 'bg-surface-2 text-ink-primary' : 'text-ink-secondary'
                  }`}
                >
                  <span className="truncate">{command.label}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {command.hint && <span className="text-[11px] text-ink-muted">{command.hint}</span>}
                    {i === cursor && <CornerDownLeft size={13} className="text-ink-muted" />}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
