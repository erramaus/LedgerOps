import { describe, expect, it } from 'vitest'
import { describeDue } from './dueDates'

describe('describeDue', () => {
  const today = '2026-10-15'

  it.each([
    ['2026-10-10', 'Overdue by 5 days', 'overdue'],
    ['2026-10-14', 'Overdue by 1 day', 'overdue'],
    ['2026-10-15', 'Due today', 'soon'],
    ['2026-10-16', 'Due tomorrow', 'soon'],
    ['2026-10-20', 'Due in 5 days', 'soon'],
    ['2026-11-30', 'Due in 46 days', 'later'],
  ])('%s is described as "%s"', (due, label, tone) => {
    expect(describeDue(due, today)).toMatchObject({ label, tone })
  })

  it('is calculated from the date given, not a fixed one', () => {
    expect(describeDue('2030-01-02', '2030-01-01')?.label).toBe('Due tomorrow')
    expect(describeDue('2030-01-02', '2030-01-10')?.label).toBe('Overdue by 8 days')
  })

  it('handles month, year and leap-day boundaries', () => {
    expect(describeDue('2027-01-01', '2026-12-31')?.label).toBe('Due tomorrow')
    expect(describeDue('2028-03-01', '2028-02-28')?.label).toBe('Due in 2 days')
  })

  it('returns nothing for missing or invalid dates rather than guessing', () => {
    expect(describeDue('', today)).toBeUndefined()
    expect(describeDue('2026-02-31', today)).toBeUndefined()
    expect(describeDue('Oct 10', today)).toBeUndefined()
    expect(describeDue(today, 'not-a-date')).toBeUndefined()
  })
})
