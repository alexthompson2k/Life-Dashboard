import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cToDisplay,
  currency,
  displayToKg,
  formatWeight,
  fromISODate,
  kgToDisplay,
  kmhToDisplay,
  monthKey,
  monthLabel,
  monthLabelLong,
  movingAverage,
  relativeDay,
  signed,
  timeOfDayGreeting,
  toISODate,
} from './format'

afterEach(() => {
  vi.useRealTimers()
})

describe('toISODate', () => {
  it('uses local time, not UTC', () => {
    // The bug this guards: toISOString() on a late-evening local date rolls
    // forward a day in any timezone behind UTC, silently filing entries under
    // tomorrow.
    const lateEvening = new Date(2026, 7, 12, 23, 30)
    expect(toISODate(lateEvening)).toBe('2026-08-12')
  })

  it('zero-pads month and day', () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('round-trips through fromISODate', () => {
    const iso = '2026-03-09'
    expect(toISODate(fromISODate(iso))).toBe(iso)
  })

  it('parses as a local date rather than a UTC instant', () => {
    const parsed = fromISODate('2026-08-12')
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(7)
    expect(parsed.getDate()).toBe(12)
  })
})

describe('relativeDay', () => {
  it('names today, tomorrow and yesterday', () => {
    vi.useFakeTimers().setSystemTime(new Date(2026, 7, 12, 9, 0))
    expect(relativeDay('2026-08-12')).toBe('Today')
    expect(relativeDay('2026-08-13')).toBe('Tomorrow')
    expect(relativeDay('2026-08-11')).toBe('Yesterday')
  })

  it('uses the weekday name within the coming week', () => {
    vi.useFakeTimers().setSystemTime(new Date(2026, 7, 12, 9, 0)) // Wednesday
    expect(relativeDay('2026-08-15')).toBe('Saturday')
  })

  it('falls back to a date beyond a week out', () => {
    vi.useFakeTimers().setSystemTime(new Date(2026, 7, 12, 9, 0))
    expect(relativeDay('2026-09-20')).toBe('Sep 20')
  })

  it('is unaffected by the time of day', () => {
    vi.useFakeTimers().setSystemTime(new Date(2026, 7, 12, 23, 59))
    expect(relativeDay('2026-08-12')).toBe('Today')
  })
})

describe('month labels', () => {
  it('marks the year so a short label cannot read as a day of the month', () => {
    expect(monthLabel('2026-08')).toBe('Aug ’26')
  })

  it('spells the month out in long form', () => {
    expect(monthLabelLong('2026-08')).toBe('August 2026')
  })

  it('extracts a month key from an ISO date', () => {
    expect(monthKey('2026-08-12')).toBe('2026-08')
  })
})

describe('unit conversion', () => {
  it('round-trips kilograms through pounds without drift', () => {
    expect(displayToKg(kgToDisplay(80, 'imperial'), 'imperial')).toBeCloseTo(80, 10)
  })

  it('leaves metric values untouched', () => {
    expect(kgToDisplay(80, 'metric')).toBe(80)
    expect(displayToKg(80, 'metric')).toBe(80)
  })

  it('converts a known weight correctly', () => {
    expect(kgToDisplay(100, 'imperial')).toBeCloseTo(220.462, 3)
  })

  it('formats weight with the matching unit', () => {
    expect(formatWeight(80, 'metric')).toBe('80.0 kg')
    expect(formatWeight(80, 'imperial')).toBe('176.4 lb')
  })

  it('converts temperature at known reference points', () => {
    expect(cToDisplay(0, 'imperial')).toBe(32)
    expect(cToDisplay(100, 'imperial')).toBe(212)
    expect(cToDisplay(21, 'metric')).toBe(21)
  })

  it('converts wind speed to miles per hour', () => {
    expect(kmhToDisplay(100, 'imperial')).toBeCloseTo(62.137, 3)
  })
})

describe('currency', () => {
  it('shows cents for small amounts and drops them for large ones', () => {
    expect(currency(12.5)).toBe('$12.50')
    expect(currency(1234.56)).toBe('$1,235')
  })

  it('compacts large amounts on request', () => {
    expect(currency(167101, 'USD', { compact: true })).toBe('$167.1K')
  })

  it('respects the currency code', () => {
    expect(currency(10, 'EUR')).toContain('10')
  })
})

describe('signed', () => {
  it('uses a true minus sign for negatives and omits a sign at zero', () => {
    expect(signed(5, (n) => String(n))).toBe('+5')
    expect(signed(-5, (n) => String(n))).toBe('−5')
    expect(signed(0, (n) => String(n))).toBe('0')
  })
})

describe('movingAverage', () => {
  it('averages over the trailing window, inclusive of the current point', () => {
    expect(movingAverage([1, 2, 3, 4], 2)).toEqual([1, 1.5, 2.5, 3.5])
  })

  it('uses a shorter window before enough points exist', () => {
    expect(movingAverage([10, 20], 5)).toEqual([10, 15])
  })

  it('handles an empty series', () => {
    expect(movingAverage([], 3)).toEqual([])
  })
})

describe('timeOfDayGreeting', () => {
  it('changes with the hour', () => {
    expect(timeOfDayGreeting(new Date(2026, 7, 12, 8))).toBe('Good morning')
    expect(timeOfDayGreeting(new Date(2026, 7, 12, 14))).toBe('Good afternoon')
    expect(timeOfDayGreeting(new Date(2026, 7, 12, 20))).toBe('Good evening')
    expect(timeOfDayGreeting(new Date(2026, 7, 12, 2))).toBe('Still up')
  })
})
