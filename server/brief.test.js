import { describe, expect, it } from 'vitest'
import { composeBrief, isoDate } from './brief.js'

const NOW = new Date(2026, 7, 12, 7, 30) // Wed 12 Aug 2026, 07:30 local
const TODAY = '2026-08-12'

function input(over = {}) {
  return {
    now: NOW,
    displayName: 'Alex',
    unitSystem: 'imperial',
    tasks: [],
    events: [],
    weather: null,
    budgets: [],
    habits: [],
    habitsDoneToday: [],
    lastWeighIn: TODAY,
    ...over,
  }
}

const task = (over) => ({ title: 'Something', due_date: TODAY, completed: false, ...over })

describe('isoDate', () => {
  it('formats in local time', () => {
    expect(isoDate(new Date(2026, 7, 12, 23, 45))).toBe('2026-08-12')
  })
})

describe('greeting', () => {
  it('matches the time of day and uses the name', () => {
    expect(composeBrief(input()).title).toBe('Good morning, Alex')
    expect(composeBrief(input({ now: new Date(2026, 7, 12, 15) })).title).toBe(
      'Good afternoon, Alex',
    )
    expect(composeBrief(input({ now: new Date(2026, 7, 12, 21) })).title).toBe(
      'Good evening, Alex',
    )
  })

  it('omits the name when there is not one', () => {
    expect(composeBrief(input({ displayName: '' })).title).toBe('Good morning')
  })
})

describe('tasks', () => {
  it('names the task when exactly one is due', () => {
    const brief = composeBrief(input({ tasks: [task({ title: 'Call the dentist' })] }))
    expect(brief.lines[0]).toBe('1 task due: Call the dentist')
  })

  it('counts rather than lists when several are due', () => {
    const brief = composeBrief(input({ tasks: [task(), task(), task()] }))
    expect(brief.lines[0]).toBe('3 tasks due')
  })

  it('combines due and overdue into one line', () => {
    const brief = composeBrief(
      input({ tasks: [task(), task({ due_date: '2026-08-01' })] }),
    )
    expect(brief.lines[0]).toBe('1 task due, 1 overdue')
  })

  it('reports overdue alone when nothing is due today', () => {
    const brief = composeBrief(input({ tasks: [task({ due_date: '2026-08-01' })] }))
    expect(brief.lines[0]).toBe('1 overdue task')
  })

  it('ignores completed tasks', () => {
    const brief = composeBrief(input({ tasks: [task({ completed: true })] }))
    expect(brief.lines).toHaveLength(0)
  })

  it('ignores tasks due later', () => {
    const brief = composeBrief(input({ tasks: [task({ due_date: '2026-09-01' })] }))
    expect(brief.lines).toHaveLength(0)
  })
})

describe('events', () => {
  it('shows the next event still ahead', () => {
    const brief = composeBrief(
      input({
        events: [
          { title: 'Standup', start_at: new Date(2026, 7, 12, 9, 0).toISOString() },
          { title: 'Lunch', start_at: new Date(2026, 7, 12, 12, 0).toISOString() },
        ],
      }),
    )
    expect(brief.lines[0]).toContain('Standup')
  })

  it('skips events that have already started', () => {
    const brief = composeBrief(
      input({
        events: [{ title: 'Early call', start_at: new Date(2026, 7, 12, 6, 0).toISOString() }],
      }),
    )
    expect(brief.lines).toHaveLength(0)
  })
})

describe('weather', () => {
  const weather = { tempC: 18, maxC: 24, minC: 13, rainChance: 10, label: 'Partly cloudy' }

  it('gives a high/low in the chosen units', () => {
    expect(composeBrief(input({ weather })).lines[0]).toBe('Partly cloudy 75°/55°')
    expect(
      composeBrief(input({ weather, unitSystem: 'metric' })).lines[0],
    ).toBe('Partly cloudy 24°/13°')
  })

  it('turns a high chance of rain into an instruction', () => {
    const brief = composeBrief(input({ weather: { ...weather, rainChance: 80 } }))
    expect(brief.lines[0]).toBe('Partly cloudy, 80% rain — take a jacket')
  })
})

describe('budgets', () => {
  it('stays quiet while budgets are comfortable', () => {
    const brief = composeBrief(input({ budgets: [{ category: 'Dining', limit: 100, spent: 50 }] }))
    expect(brief.lines).toHaveLength(0)
  })

  it('warns from 80% used', () => {
    const brief = composeBrief(input({ budgets: [{ category: 'Dining', limit: 100, spent: 85 }] }))
    expect(brief.lines[0]).toBe('Dining budget at 85%')
  })

  it('reports how far over the limit is', () => {
    const brief = composeBrief(input({ budgets: [{ category: 'Dining', limit: 100, spent: 130 }] }))
    expect(brief.lines[0]).toBe('Dining is 30% over budget')
  })

  it('surfaces only the worst budget', () => {
    const brief = composeBrief(
      input({
        budgets: [
          { category: 'Dining', limit: 100, spent: 85 },
          { category: 'Shopping', limit: 100, spent: 150 },
        ],
      }),
    )
    expect(brief.lines).toHaveLength(1)
    expect(brief.lines[0]).toContain('Shopping')
  })
})

describe('habits', () => {
  const habits = [
    { id: 'h1', name: 'Walk' },
    { id: 'h2', name: 'Read' },
  ]

  it('counts what is left', () => {
    const brief = composeBrief(input({ habits, habitsDoneToday: ['h1'] }))
    expect(brief.lines[0]).toBe('1 habit left')
  })

  it('phrases an untouched day differently', () => {
    const brief = composeBrief(input({ habits, habitsDoneToday: [] }))
    expect(brief.lines[0]).toBe('2 habits to check off')
  })

  it('says nothing once they are all done', () => {
    const brief = composeBrief(input({ habits, habitsDoneToday: ['h1', 'h2'] }))
    expect(brief.lines).toHaveLength(0)
  })
})

describe('weigh-in nudge', () => {
  it('stays quiet for a recent weigh-in', () => {
    expect(composeBrief(input({ lastWeighIn: '2026-08-11' })).lines).toHaveLength(0)
  })

  it('speaks up after three days', () => {
    expect(composeBrief(input({ lastWeighIn: '2026-08-09' })).lines[0]).toBe(
      'No weigh-in for 3 days',
    )
  })

  it('handles never having weighed in', () => {
    expect(composeBrief(input({ lastWeighIn: null })).lines[0]).toBe('No weigh-ins logged yet')
  })
})

describe('body', () => {
  it('caps the notification at four items but keeps the rest in lines', () => {
    const brief = composeBrief(
      input({
        tasks: [task()],
        events: [{ title: 'Standup', start_at: new Date(2026, 7, 12, 9).toISOString() }],
        weather: { tempC: 18, maxC: 24, minC: 13, rainChance: 5, label: 'Clear' },
        budgets: [{ category: 'Dining', limit: 100, spent: 95 }],
        habits: [{ id: 'h1', name: 'Walk' }],
        habitsDoneToday: [],
        lastWeighIn: '2026-08-01',
      }),
    )
    expect(brief.lines.length).toBeGreaterThan(4)
    expect(brief.body.split(' · ')).toHaveLength(4)
  })

  it('says so plainly when there is nothing to report', () => {
    const brief = composeBrief(input())
    expect(brief.empty).toBe(true)
    expect(brief.body).toBe('Nothing needs you today. Enjoy it.')
  })
})
