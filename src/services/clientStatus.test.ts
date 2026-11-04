import { describe, expect, it } from 'vitest'
import { attentionStatus, monthEndStatus, nextTaskFor, periodNotice } from './clientStatus'
import type { WorkTask } from './workQueue'

const task = (overrides: Partial<WorkTask>): WorkTask => ({
  id: 't', clientId: 'a', client: 'A', type: 'Transactions', kind: 'uncategorized', issue: 'Uncategorized transaction', description: 'd',
  priority: 'High', status: 'Open', suspected: false, count: 1, destination: 'Transactions', action: 'Categorize', ...overrides,
})

describe('statuses are separate and never contradict', () => {
  it('a client can be 100% month-end complete and still have open bookkeeping work', () => {
    expect(monthEndStatus(100)).toEqual({ label: 'Month-end: complete', tone: 'success' })
    expect(attentionStatus(4)).toEqual({ label: '4 open bookkeeping items', tone: 'warning' })
  })
  it('words counts correctly', () => {
    expect(attentionStatus(1).label).toBe('1 open bookkeeping item')
    expect(attentionStatus(0)).toEqual({ label: 'No open bookkeeping items', tone: 'success' })
    expect(monthEndStatus(60).label).toBe('Month-end: 60% complete')
    expect(monthEndStatus(0).label).toBe('Month-end: 0% complete')
  })
  it('reports unavailable data as unavailable, never as zero or complete', () => {
    expect(monthEndStatus(null).label).toBe('Month-end: not available')
    expect(attentionStatus(null).label).toBe('Bookkeeping: not available')
  })
})

describe('periodNotice', () => {
  it('labels the selected period and marks earlier months historical', () => {
    expect(periodNotice({ year: 2026, month: 8 }, 'August 2026', '2026-10-15')).toEqual({ label: 'August 2026', historical: true, figuresMatch: true })
    expect(periodNotice({ year: 2026, month: 10 }, 'August 2026', '2026-10-15')).toMatchObject({ historical: false, figuresMatch: false })
  })
  it('does not substitute the current month when the figures belong to another period', () => {
    const notice = periodNotice({ year: 2026, month: 7 }, 'August 2026', '2026-10-15')
    expect(notice.label).toBe('July 2026')
    expect(notice.figuresMatch).toBe(false)
  })
  it('is calculated from the date given', () => {
    expect(periodNotice({ year: 2026, month: 8 }, null, '2026-08-20').historical).toBe(false)
    expect(periodNotice({ year: 2026, month: 8 }, null, '2026-09-01').historical).toBe(true)
  })
})

describe('nextTaskFor', () => {
  it('picks the first (most urgent) task of that client only', () => {
    const tasks = [task({ id: '1', clientId: 'b', issue: 'Other client' }), task({ id: '2', issue: 'Overdue bill', dueDate: '2026-10-10' }), task({ id: '3', issue: 'Later' })]
    expect(nextTaskFor(tasks, 'a', '2026-10-15')).toEqual({ text: 'Overdue bill', due: 'Overdue by 5 days' })
  })
  it('returns null when the client has nothing outstanding', () => {
    expect(nextTaskFor([task({})], 'zzz', '2026-10-15')).toBeNull()
  })
})
