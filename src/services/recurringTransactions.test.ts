import { describe, expect, it } from 'vitest'
import { historyFromTransactions, recurringFromHistory, type RecurringHistoryEntry } from './recurringTransactions'
import type { Transaction } from './bookkeepingTypes'

const entry = (overrides: Partial<RecurringHistoryEntry>): RecurringHistoryEntry => ({
  id: 'e1',
  clientId: 'abc-plumbing',
  source: 'demo',
  date: '2026-06-01',
  payee: 'Adobe',
  description: 'Subscription',
  amountCents: 5_999,
  ...overrides,
})

describe('recurring detection', () => {
  it('detects monthly recurring patterns and predicts a next date', () => {
    const patterns = recurringFromHistory([
      entry({ id: 'a', date: '2026-06-26' }),
      entry({ id: 'b', date: '2026-07-26' }),
      entry({ id: 'c', date: '2026-08-26' }),
    ], '2026-10-15')
    expect(patterns[0]).toMatchObject({
      vendor: 'Adobe',
      frequency: 'Monthly',
      expectedNextDate: '2026-09-25',
      missing: true,
    })
  })

  it('does not emit patterns without enough evidence', () => {
    expect(recurringFromHistory([entry({ id: 'a' }), entry({ id: 'b', date: '2026-07-01' })], '2026-10-15')).toEqual([])
  })

  it('builds history rows from transactions', () => {
    const transactions: Transaction[] = [
      { id: 'txn-1', clientId: 'abc-plumbing', date: '2026-08-26', payee: 'Adobe', description: 'Subscription', amount: '$59.99', category: 'Software', status: 'Matched' },
    ]
    expect(historyFromTransactions('abc-plumbing', 'demo', transactions)[0]).toMatchObject({
      id: 'txn-1',
      amountCents: 5_999,
      payee: 'Adobe',
    })
  })

  it('keeps demo and QuickBooks histories separated', () => {
    const patterns = recurringFromHistory([
      entry({ id: 'a', source: 'demo' }),
      entry({ id: 'b', source: 'demo', date: '2026-07-01' }),
      entry({ id: 'c', source: 'demo', date: '2026-08-01' }),
      entry({ id: 'd', source: 'quickbooks', clientId: 'quickbooks-sandbox' }),
      entry({ id: 'e', source: 'quickbooks', clientId: 'quickbooks-sandbox', date: '2026-07-01' }),
      entry({ id: 'f', source: 'quickbooks', clientId: 'quickbooks-sandbox', date: '2026-08-01' }),
    ], '2026-10-15')
    expect(new Set(patterns.map((pattern) => `${pattern.source}:${pattern.clientId}`))).toEqual(new Set(['demo:abc-plumbing', 'quickbooks:quickbooks-sandbox']))
  })
})
