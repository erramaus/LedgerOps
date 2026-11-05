import { describe, expect, it } from 'vitest'
import type { Transaction } from './bookkeepingTypes'
import {
  categorizationStatus,
  clientIdsIn,
  describeDateRange,
  filterTransactions,
  inDateRange,
  matchesReason,
  monthRange,
  needsAttention,
  nextActionable,
  reviewReasons,
  transactionIsoDate,
} from './transactionReview'

const make = (id: string, patch: Partial<Transaction> = {}): Transaction => ({
  id, date: 'Aug 10, 2026', payee: 'Vendor', description: 'Thing', amount: '$10.00', category: 'Materials', status: 'Categorized', ...patch,
})

describe('categorization status vs. other review reasons', () => {
  it('keeps a categorized transaction categorized while still needing a receipt', () => {
    const ups = make('a', { status: 'Needs Receipt', category: 'Shipping' })
    expect(categorizationStatus(ups)).toBe('Categorized')
    expect(matchesReason(ups, 'Missing receipt')).toBe(true)
    expect(matchesReason(ups, 'Missing category')).toBe(false)
    expect(needsAttention(ups)).toBe(true)
    expect(reviewReasons(ups)).toEqual(['Missing receipt'])
  })

  it('reports both reasons when a transaction has no category and no receipt', () => {
    const grainger = make('b', { status: 'Needs Receipt', category: 'Uncategorized' })
    expect(categorizationStatus(grainger)).toBe('Needs review')
    expect(reviewReasons(grainger)).toEqual(['Missing category', 'Missing receipt'])
  })

  it('does not need attention when categorized or matched without other reasons', () => {
    expect(needsAttention(make('c'))).toBe(false)
    expect(categorizationStatus(make('d', { status: 'Matched' }))).toBe('Matched')
  })

  it('flags only amounts at or above the conservative limit when there is no client history', () => {
    expect(matchesReason(make('e', { amount: '$1,250.00' }), 'Large transaction')).toBe(false)
    expect(matchesReason(make('e', { amount: '$6,250.00' }), 'Large transaction')).toBe(true)
    expect(matchesReason(make('e', { amount: '$1,250.00' }), 'Large transaction', new Set(['e']))).toBe(true)
  })
})

describe('transaction dates', () => {
  it('parses display and ISO dates and rejects anything else', () => {
    expect(transactionIsoDate('Aug 05, 2026')).toBe('2026-08-05')
    expect(transactionIsoDate('2026-08-29')).toBe('2026-08-29')
    expect(transactionIsoDate('Feb 31, 2026')).toBeNull()
    expect(transactionIsoDate('Today')).toBeNull()
    expect(transactionIsoDate(undefined)).toBeNull()
  })

  it('builds a month range including leap-year February', () => {
    expect(monthRange({ year: 2026, month: 8 })).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(monthRange({ year: 2028, month: 2 })).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })

  it('does not exclude anything without a date filter, even undated or old records', () => {
    expect(inDateRange(make('old', { date: 'Jan 02, 2020' }))).toBe(true)
    expect(inDateRange(make('odd', { date: 'unknown' }), {})).toBe(true)
  })

  it('filters by selected month and by custom range, inclusive of both ends', () => {
    const rows = [make('jul', { date: 'Jul 30, 2026' }), make('first', { date: 'Aug 01, 2026' }), make('last', { date: 'Aug 31, 2026' }), make('sep', { date: 'Sep 01, 2026' })]
    expect(filterTransactions(rows, { range: monthRange({ year: 2026, month: 8 }) }).map((row) => row.id)).toEqual(['first', 'last'])
    expect(filterTransactions(rows, { range: { from: '2026-07-31', to: '2026-08-01' } }).map((row) => row.id)).toEqual(['first'])
    expect(filterTransactions(rows, { range: { from: '2026-08-31' } }).map((row) => row.id)).toEqual(['last', 'sep'])
  })

  it('describes the active range', () => {
    expect(describeDateRange()).toBe('All dates')
    expect(describeDateRange(monthRange({ year: 2026, month: 8 }))).toBe('Aug 1, 2026 – Aug 31, 2026')
    expect(describeDateRange({ from: '2026-08-05' })).toBe('From Aug 5, 2026')
    expect(describeDateRange({ to: '2026-08-05' })).toBe('Up to Aug 5, 2026')
  })
})

describe('combined filters, counts and client scoping', () => {
  const rows = [
    make('1', { clientId: 'c1', payee: 'Amazon', category: 'Uncategorized', status: 'Needs Review' }),
    make('2', { clientId: 'c1', payee: 'Shell', status: 'Needs Receipt' }),
    make('3', { clientId: 'c2', payee: 'Amazon', status: 'Matched' }),
  ]

  it('combines search, status and reason filters', () => {
    expect(filterTransactions(rows, { search: 'amazon' }).map((row) => row.id)).toEqual(['1', '3'])
    expect(filterTransactions(rows, { search: 'amazon', categorization: 'Needs review' }).map((row) => row.id)).toEqual(['1'])
    expect(filterTransactions(rows, { reason: 'Missing receipt' }).map((row) => row.id)).toEqual(['2'])
    expect(filterTransactions(rows, { search: 'amazon', reason: 'Missing receipt' })).toEqual([])
  })

  it('counts under the selected client only', () => {
    const one = filterTransactions(rows, { clientId: 'c1' })
    expect(one.map((row) => row.id)).toEqual(['1', '2'])
    expect(one.filter(needsAttention)).toHaveLength(2)
    expect(filterTransactions(rows, { clientId: 'c2' }).filter(needsAttention)).toHaveLength(0)
  })

  it('reports the distinct clients shown so the Client column appears only for several', () => {
    expect(clientIdsIn(rows)).toEqual(['c1', 'c2'])
    expect(clientIdsIn(filterTransactions(rows, { clientId: 'c1' }))).toEqual(['c1'])
  })
})

describe('review navigation', () => {
  const ordered = ['a', 'b', 'c', 'd'].map((id) => make(id))
  const queueOf = (...ids: string[]) => ordered.filter((row) => ids.includes(row.id))

  it('moves to the next queued item', () => {
    expect(nextActionable(ordered, queueOf('a', 'c', 'd'), 'a')?.id).toBe('c')
  })

  it('skips an item that just left the queue', () => {
    expect(nextActionable(ordered, queueOf('c', 'd'), 'b')?.id).toBe('c')
  })

  it('wraps around but never returns the current item', () => {
    expect(nextActionable(ordered, queueOf('a', 'd'), 'd')?.id).toBe('a')
    expect(nextActionable(ordered, queueOf('d'), 'd')).toBeUndefined()
    expect(nextActionable(ordered, [], 'a')).toBeUndefined()
  })
})
