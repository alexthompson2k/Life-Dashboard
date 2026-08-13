import { describe, expect, it } from 'vitest'
import { parseIcs, parseIcsDate, unfold, withinWindow } from './calendar.js'

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:evt-1@example.com
DTSTART:20260812T090000Z
DTEND:20260812T093000Z
SUMMARY:Team standup
LOCATION:Zoom
END:VEVENT
BEGIN:VEVENT
UID:evt-2@example.com
DTSTART;VALUE=DATE:20260814
SUMMARY:Public holiday
END:VEVENT
BEGIN:VEVENT
UID:evt-3@example.com
DTSTART:20260815T190000Z
SUMMARY:Dinner with Priya\\, and Sam
RRULE:FREQ=WEEKLY;BYDAY=SA
END:VEVENT
END:VCALENDAR`

describe('unfold', () => {
  it('rejoins folded continuation lines', () => {
    // RFC 5545 folds long lines; a continuation starts with a space or tab.
    expect(unfold('SUMMARY:A very long\n  title')).toBe('SUMMARY:A very long title')
  })

  it('normalises CRLF endings', () => {
    expect(unfold('A\r\nB')).toBe('A\nB')
  })
})

describe('parseIcsDate', () => {
  it('reads a UTC timestamp', () => {
    const parsed = parseIcsDate('20260812T090000Z')
    expect(parsed.allDay).toBe(false)
    expect(parsed.date.toISOString()).toBe('2026-08-12T09:00:00.000Z')
  })

  it('reads a date-only value as all day', () => {
    const parsed = parseIcsDate('20260814')
    expect(parsed.allDay).toBe(true)
    expect(parsed.date.getFullYear()).toBe(2026)
    expect(parsed.date.getMonth()).toBe(7)
    expect(parsed.date.getDate()).toBe(14)
  })

  it('reads a floating time as local', () => {
    const parsed = parseIcsDate('20260812T090000')
    expect(parsed.allDay).toBe(false)
    expect(parsed.date.getHours()).toBe(9)
  })

  it('returns null for junk', () => {
    expect(parseIcsDate('')).toBeNull()
    expect(parseIcsDate('nonsense')).toBeNull()
  })
})

describe('parseIcs', () => {
  const events = parseIcs(ICS, { label: 'Work' })

  it('finds every event', () => {
    expect(events).toHaveLength(3)
  })

  it('reads times, titles and locations', () => {
    const standup = events[0]
    expect(standup.title).toBe('Team standup')
    expect(standup.location).toBe('Zoom')
    expect(standup.start_at).toBe('2026-08-12T09:00:00.000Z')
    expect(standup.end_at).toBe('2026-08-12T09:30:00.000Z')
    expect(standup.all_day).toBe(false)
  })

  it('marks date-only events as all day', () => {
    expect(events[1].all_day).toBe(true)
    expect(events[1].title).toBe('Public holiday')
  })

  it('unescapes commas in titles', () => {
    expect(events[2].title).toBe('Dinner with Priya, and Sam')
  })

  it('flags recurring events instead of silently expanding them', () => {
    // A partial RRULE implementation would drop or duplicate occurrences.
    expect(events[2].recurring).toBe(true)
    expect(events[0].recurring).toBe(false)
  })

  it('namespaces ids by source so two feeds cannot collide', () => {
    expect(events[0].id).toBe('ics:Work:evt-1@example.com')
  })

  it('handles an empty calendar', () => {
    expect(parseIcs('BEGIN:VCALENDAR\nEND:VCALENDAR')).toEqual([])
  })

  it('skips an event with no start rather than emitting an invalid date', () => {
    const broken =
      'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:No date\nEND:VEVENT\nEND:VCALENDAR'
    expect(parseIcs(broken)).toEqual([])
  })

  it('gives an untitled event a readable placeholder', () => {
    const untitled =
      'BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20260812T090000Z\nEND:VEVENT\nEND:VCALENDAR'
    expect(parseIcs(untitled)[0].title).toBe('(no title)')
  })
})

describe('withinWindow', () => {
  it('keeps only events inside the range, in order', () => {
    const events = parseIcs(ICS)
    const filtered = withinWindow(events, {
      from: new Date('2026-08-13T00:00:00Z'),
      to: new Date('2026-08-20T00:00:00Z'),
    })
    expect(filtered.map((e) => e.title)).toEqual([
      'Public holiday',
      'Dinner with Priya, and Sam',
    ])
  })
})
