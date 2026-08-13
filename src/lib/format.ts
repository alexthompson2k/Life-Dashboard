import type { UnitSystem } from './types'

export function currency(value: number, code = 'USD', opts: { compact?: boolean } = {}) {
  const abs = Math.abs(value)
  if (opts.compact && abs >= 1000) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value)
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: code,
    minimumFractionDigits: abs < 100 ? 2 : 0,
    maximumFractionDigits: abs < 100 ? 2 : 0,
  }).format(value)
}

export function number(value: number, digits = 0) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

export function percent(value: number, digits = 0) {
  return `${value >= 0 ? '' : ''}${value.toFixed(digits)}%`
}

export function signed(value: number, format: (n: number) => string) {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${format(Math.abs(value))}`
}

/* ---------- weight ---------- */

const LB_PER_KG = 2.2046226218

export function kgToDisplay(kg: number, units: UnitSystem) {
  return units === 'imperial' ? kg * LB_PER_KG : kg
}

export function displayToKg(value: number, units: UnitSystem) {
  return units === 'imperial' ? value / LB_PER_KG : value
}

export function weightUnit(units: UnitSystem) {
  return units === 'imperial' ? 'lb' : 'kg'
}

export function formatWeight(kg: number, units: UnitSystem, digits = 1) {
  return `${kgToDisplay(kg, units).toFixed(digits)} ${weightUnit(units)}`
}

/* ---------- temperature ---------- */

export function cToDisplay(c: number, units: UnitSystem) {
  return units === 'imperial' ? (c * 9) / 5 + 32 : c
}

export function tempUnit(units: UnitSystem) {
  return units === 'imperial' ? '°F' : '°C'
}

export function formatTemp(c: number, units: UnitSystem) {
  return `${Math.round(cToDisplay(c, units))}°`
}

/* ---------- distance / speed ---------- */

export function kmhToDisplay(kmh: number, units: UnitSystem) {
  return units === 'imperial' ? kmh * 0.621371 : kmh
}

export function speedUnit(units: UnitSystem) {
  return units === 'imperial' ? 'mph' : 'km/h'
}

/* ---------- dates ---------- */

/** Local-time YYYY-MM-DD. Avoids the UTC shift you get from toISOString(). */
export function toISODate(d: Date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fromISODate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function relativeDay(iso: string) {
  const today = toISODate()
  if (iso === today) return 'Today'
  const t = fromISODate(today)
  const target = fromISODate(iso)
  const diff = Math.round((target.getTime() - t.getTime()) / 86_400_000)
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff > 1 && diff < 7) return target.toLocaleDateString('en-US', { weekday: 'long' })
  return target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function monthKey(iso: string) {
  return iso.slice(0, 7)
}

/**
 * "Aug ’26". The apostrophe matters: a bare "Aug 26" reads as a day of the
 * month, which is exactly the wrong thing on a monthly axis.
 */
export function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number)
  const month = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' })
  return `${month} ’${String(y).slice(2)}`
}

/** Long form for card subtitles, where there is room to be unambiguous. */
export function monthLabelLong(key: string) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

export function timeOfDayGreeting(d = new Date()) {
  const h = d.getHours()
  if (h < 5) return 'Still up'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/** Rolling mean over the previous `window` points, inclusive of the current one. */
export function movingAverage(values: number[], window: number) {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1)
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
}
