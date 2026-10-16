import { describe, expect, it } from 'vitest'
import { summarizeOpenItems } from './openItems'

const item = (dueDate: string, amount: number, amountPaid = 0) => ({ dueDate, amount, amountPaid })

describe('summarizeOpenItems', () => {
  const today = '2026-10-15'

  it('buckets each open balance by days past due, using only what is still owed', () => {
    const summary = summarizeOpenItems([
      item('September 21, 2026', 1650), // 24 days late
      item('2026-09-04', 3150, 1200), // 41 days late, 1,950 open
      item('2026-08-01', 500), // 75 days late
      item('2026-10-20', 800), // not due yet, within a week
      item('2026-12-01', 200), // not due yet
    ], today)
    expect(summary).toMatchObject({ days1to30Cents: 165_000, days31to60Cents: 195_000, over60Cents: 50_000, currentCents: 100_000, dueWithin7DaysCents: 80_000 })
    expect(summary.totalCents).toBe(165_000 + 195_000 + 50_000 + 100_000)
  })

  it('the buckets always add up to the total when every date is readable', () => {
    const summary = summarizeOpenItems([item('2026-09-30', 12.34), item('2026-10-15', 0.01), item('2026-10-16', 99.99), item('2026-01-01', 1)], today)
    expect(summary.currentCents + summary.days1to30Cents + summary.days31to60Cents + summary.over60Cents).toBe(summary.totalCents)
    expect(summary.unreadable).toBe(0)
  })

  it('paid-off items are not open and unreadable dates are reported, never guessed into a bucket', () => {
    const summary = summarizeOpenItems([item('2026-09-01', 100, 100), item('Unknown date', 250), item('2026-09-01', 40)], today)
    expect(summary.totalCents).toBe(29_000)
    expect(summary.unreadable).toBe(1)
    expect(summary.days31to60Cents).toBe(4_000)
    expect(summary.currentCents + summary.days1to30Cents + summary.days31to60Cents + summary.over60Cents).toBe(4_000)
    expect(summary.paidCents).toBe(10_000)
  })

  it('works in whole cents, so floating-point amounts do not drift', () => {
    expect(summarizeOpenItems([item('2026-09-01', 0.1), item('2026-09-01', 0.2)], today).totalCents).toBe(30)
  })
})
