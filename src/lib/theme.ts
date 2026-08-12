import { useCallback, useEffect, useState } from 'react'

export type ThemePref = 'light' | 'dark' | 'system'

const KEY = 'ld.theme'

function resolve(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function apply(pref: ThemePref) {
  document.documentElement.setAttribute('data-theme', resolve(pref))
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(
    () => (localStorage.getItem(KEY) as ThemePref | null) ?? 'system',
  )

  useEffect(() => {
    apply(pref)
    localStorage.setItem(KEY, pref)
    if (pref !== 'system') return
    // Follow the OS while "system" is selected.
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  const cycle = useCallback(() => {
    setPref((p) => (p === 'light' ? 'dark' : p === 'dark' ? 'system' : 'light'))
  }, [])

  return { pref, setPref, cycle, resolved: resolve(pref) }
}
