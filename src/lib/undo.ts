import { useCallback } from 'react'
import { useToast } from '../components/ui'
import { insertRow } from './store'
import type { TableName, Tables } from './types'

/**
 * Delete with an undo affordance.
 *
 * Every delete used to be immediate and final, with its button sat beside
 * ordinary controls — one mis-tap on a phone and a transaction was gone.
 * Rather than putting a confirm dialog in front of routine actions (which
 * trains people to dismiss it), the delete goes through and offers a way back.
 *
 * Rows are restored with their original ids so references from other tables
 * still line up afterwards.
 */
export function useUndoableDelete() {
  const toast = useToast()

  /**
   * `restore` is a callback rather than just a row because some deletes cascade:
   * removing a workout takes its sets with it, so putting the session back has
   * to put the sets back too.
   */
  const run = useCallback(
    async (label: string, remove: () => Promise<void>, restore: () => Promise<void>) => {
      await remove()
      toast.pushAction(`${label} deleted`, {
        label: 'Undo',
        onClick: async () => {
          try {
            await restore()
          } catch {
            toast.push('Could not restore that item', 'error')
          }
        },
      })
    },
    [toast],
  )

  /** The common case: one row, one table. */
  const removeRow = useCallback(
    <K extends TableName>(
      table: K,
      row: Tables[K],
      remove: (id: string) => Promise<void>,
      label = 'Item',
    ) => {
      const snapshot = { ...row }
      return run(
        label,
        () => remove((row as { id: string }).id),
        () => insertRow(table, snapshot as never).then(() => undefined),
      )
    },
    [run],
  )

  return { run, removeRow }
}
