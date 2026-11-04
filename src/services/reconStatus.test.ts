import { describe, expect, it } from 'vitest'
import { filterHistory, formatLongDate, formatMonthKey, historyMonths, lastCompleted, periodStatus, recordStatus, summarizePeriod, type StatusRecord } from './reconStatus'
import { formatCents } from '../../shared/reconciliation'

const rec = (patch: Partial<StatusRecord> & { id: string }): StatusRecord => ({
  clientId: 'abc', clientName: 'ABC Plumbing', accountId: 'checking', accountName: 'Chase Business Checking', accountKind: 'bank',
  periodStart: '2026-07-01', periodEnd: '2026-07-31', status: 'completed', completeness: { complete: true, reasons: [] }, endingCents: 123456, ...patch,
})
const august = { year: 2026, month: 8 }
const july = { year: 2026, month: 7 }

describe('date and balance formatting', () => {
  it('formats ISO dates readably and leaves invalid ones alone', () => {
    expect(formatLongDate('2026-07-31')).toBe('July 31, 2026')
    expect(formatLongDate('2026-02-05')).toBe('February 5, 2026')
    expect(formatLongDate('2026-02-31')).toBe('2026-02-31')
    expect(formatLongDate('garbage')).toBe('garbage')
    expect(formatLongDate(undefined)).toBe('—')
    expect(formatMonthKey('2026-08')).toBe('August 2026')
  })

  it('keeps balances in integer cents', () => {
    expect(formatCents(123456)).toBe('$1,234.56')
    expect(formatCents(-5)).toBe('-$0.05')
  })
})

describe('selected-period reconciliation status', () => {
  const records = [
    rec({ id: 'a', periodEnd: '2026-07-31' }),
    rec({ id: 'b', accountId: 'card', accountName: 'Card', periodEnd: '2026-08-31', periodStart: '2026-08-01', status: 'draft' }),
    rec({ id: 'c', accountId: 'savings', accountName: 'Savings', periodEnd: '2026-08-31', periodStart: '2026-08-01', status: 'draft', completeness: { complete: false, reasons: ['Register could not be loaded'] } }),
  ]

  it('is Completed only from a stored completed record in that month', () => {
    expect(periodStatus(records, 'checking', july).status).toBe('Completed')
    expect(periodStatus(records, 'checking', july).record?.id).toBe('a')
  })

  it('is Not started with no record, even if another month is completed', () => {
    expect(periodStatus(records, 'checking', august).status).toBe('Not started')
    expect(periodStatus(records, 'unknown', august).status).toBe('Not started')
  })

  it('is In progress for a saved draft and Blocked when the books could not be checked', () => {
    expect(periodStatus(records, 'card', august).status).toBe('In progress')
    const blocked = periodStatus(records, 'savings', august)
    expect(blocked.status).toBe('Blocked')
    expect(blocked.reason).toBe('Register could not be loaded')
  })

  it('does not count another account or client record', () => {
    expect(periodStatus(records, 'card', july).status).toBe('Not started')
    expect(recordStatus(rec({ id: 'x', status: 'draft' }))).toBe('In progress')
  })

  it('reports the last completed reconciliation and summarizes counts', () => {
    expect(lastCompleted(records, 'checking')?.periodEnd).toBe('2026-07-31')
    expect(lastCompleted(records, 'card')).toBeUndefined()
    expect(summarizePeriod(records, ['checking', 'card', 'savings', 'other'], august)).toEqual({ 'Not started': 2, 'In progress': 1, Completed: 0, Blocked: 1 })
  })
})

describe('history search and filters', () => {
  const records = [
    rec({ id: '1' }),
    rec({ id: '2', clientId: 'green', clientName: 'Green Leaf Landscaping', accountId: 'visa', accountName: 'Green Leaf Business Visa', accountKind: 'credit_card', periodStart: '2026-08-01', periodEnd: '2026-08-31', status: 'draft' }),
    rec({ id: '3', periodStart: '2026-06-01', periodEnd: '2026-06-30' }),
  ]

  it('filters by client, account, period and status', () => {
    expect(filterHistory(records, { clientId: 'green' }).map((item) => item.id)).toEqual(['2'])
    expect(filterHistory(records, { accountId: 'checking' }).map((item) => item.id)).toEqual(['1', '3'])
    expect(filterHistory(records, { period: '2026-06' }).map((item) => item.id)).toEqual(['3'])
    expect(filterHistory(records, { status: 'Completed' }).map((item) => item.id)).toEqual(['1', '3'])
    expect(filterHistory(records, { status: 'In progress' }).map((item) => item.id)).toEqual(['2'])
  })

  it('searches names and readable dates, combined with filters', () => {
    expect(filterHistory(records, { search: 'visa' }).map((item) => item.id)).toEqual(['2'])
    expect(filterHistory(records, { search: 'july 31' }).map((item) => item.id)).toEqual(['1'])
    expect(filterHistory(records, { search: 'chase', status: 'Completed', period: '2026-06' }).map((item) => item.id)).toEqual(['3'])
    expect(filterHistory(records, { search: 'nothing' })).toEqual([])
  })

  it('keeps older records when no filter is set and lists months newest first', () => {
    expect(filterHistory(records, {})).toHaveLength(3)
    expect(historyMonths(records)).toEqual(['2026-08', '2026-07', '2026-06'])
  })
})
