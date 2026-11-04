import { describe, expect, it } from 'vitest'
import { summarizeOpenItems } from './openItems'
import { agingBucket, filterCounts, filterRows, hasActiveFilters, invoiceDue, isOverdue, paymentStatus, searchRows, emptyReceivableFilters, type ReceivableRow } from './receivablesView'
import type { Invoice } from './bookkeepingTypes'

const today = '2026-10-15'
const inv = (id: string, dueDate: string, amount: number, amountPaid = 0, customer = 'Acme'): Invoice => ({ id, customer, number: `INV-${id}`, invoiceDate: 'August 01, 2026', dueDate, amount, amountPaid, status: 'Open' })
const row = (invoice: Invoice, clientName = 'ABC Plumbing'): ReceivableRow => ({ invoice, clientId: clientName, clientName })

describe('receivables status', () => {
  it('lets an invoice be both partially paid and overdue', () => {
    const partial = inv('1', '2026-09-01', 1000, 400)
    expect(paymentStatus(partial)).toBe('Partially Paid')
    expect(isOverdue(partial, today)).toBe(true)
  })
  it('never calls a fully paid invoice overdue and ignores the stored status field', () => {
    const paid = { ...inv('2', '2026-01-01', 500, 500), status: 'Overdue' as const }
    expect(paymentStatus(paid)).toBe('Paid')
    expect(isOverdue(paid, today)).toBe(false)
    expect(agingBucket(paid, today)).toBeNull()
  })
  it('treats the due date itself as current and the next day as 1-30', () => {
    expect(agingBucket(inv('3', '2026-10-15', 10), today)).toBe('Current')
    expect(agingBucket(inv('4', '2026-10-14', 10), today)).toBe('1-30')
    expect(agingBucket(inv('5', '2026-09-15', 10), today)).toBe('1-30')
    expect(agingBucket(inv('6', '2026-09-14', 10), today)).toBe('31-60')
    expect(agingBucket(inv('7', '2026-08-16', 10), today)).toBe('31-60')
    expect(agingBucket(inv('8', '2026-08-15', 10), today)).toBe('60+')
  })
  it('puts unreadable due dates in no bucket and not overdue', () => {
    const bad = inv('9', 'soon', 10)
    expect(agingBucket(bad, today)).toBeNull()
    expect(isOverdue(bad, today)).toBe(false)
    expect(invoiceDue(bad, today)).toBeUndefined()
  })
})

describe('aging buckets agree with the summary cards', () => {
  const invoices = [inv('a', '2026-10-20', 100.1), inv('b', '2026-10-01', 200.2, 50), inv('c', '2026-09-01', 300.3), inv('d', '2026-07-01', 400.4), inv('e', '2026-01-01', 50, 50), inv('f', 'n/a', 7)]
  it('sums each bucket to the aging cards', () => {
    const summary = summarizeOpenItems(invoices, today)
    const sum = (bucket: string) => invoices.filter((item) => agingBucket(item, today) === bucket).reduce((total, item) => total + Math.round(item.amount * 100) - Math.round(item.amountPaid * 100), 0)
    expect(sum('Current')).toBe(summary.currentCents)
    expect(sum('1-30')).toBe(summary.days1to30Cents)
    expect(sum('31-60')).toBe(summary.days31to60Cents)
    expect(sum('60+')).toBe(summary.over60Cents)
  })
  it('counts the Overdue filter as the sum of the three late buckets', () => {
    const rows = invoices.map((item) => row(item))
    const counts = filterCounts(rows, emptyReceivableFilters, today)
    expect(counts.aging.Overdue).toBe(counts.aging['1-30'] + counts.aging['31-60'] + counts.aging['60+'])
    expect(counts.aging.Overdue).toBe(3)
  })
})

describe('search and filters', () => {
  const rows = [row(inv('1', '2026-09-01', 1980, 0, 'Pinecrest HOA'), 'ABC Plumbing'), row(inv('2', '2026-10-30', 3150, 1200, 'Oak Street'), 'Smith Co'), row(inv('3', '2026-08-01', 500, 500, 'Paid Pat'), 'Smith Co')]
  it('searches customer, number, client and amount', () => {
    expect(searchRows(rows, 'pinecrest')).toHaveLength(1)
    expect(searchRows(rows, 'INV-2')).toHaveLength(1)
    expect(searchRows(rows, 'smith')).toHaveLength(2)
    expect(searchRows(rows, '$1,980.00')).toHaveLength(1)
    expect(searchRows(rows, '1980')).toHaveLength(1)
    expect(searchRows(rows, '1950')).toHaveLength(1)
  })
  it('combines payment status, aging and search', () => {
    expect(filterRows(rows, { payment: 'Open', aging: 'Overdue', search: '' }, today).map((r) => r.invoice.id)).toEqual(['1'])
    expect(filterRows(rows, { payment: 'Partially Paid', aging: 'Current', search: 'oak' }, today).map((r) => r.invoice.id)).toEqual(['2'])
    expect(filterRows(rows, { payment: 'Paid', aging: 'Overdue', search: '' }, today)).toHaveLength(0)
  })
  it('keeps counts consistent with what the table shows', () => {
    const filters = { payment: 'All' as const, aging: 'Overdue' as const, search: 'smith' }
    const counts = filterCounts(rows, filters, today)
    expect(counts.payment.All).toBe(filterRows(rows, filters, today).length)
    expect(counts.payment.Paid).toBe(0)
  })
  it('knows when filters are active', () => {
    expect(hasActiveFilters(emptyReceivableFilters)).toBe(false)
    expect(hasActiveFilters({ ...emptyReceivableFilters, search: ' x ' })).toBe(true)
  })
})

describe('relative due dates', () => {
  it('labels open invoices from the supplied day', () => {
    expect(invoiceDue(inv('1', 'August 27, 2026', 10), today)?.label).toBe('Overdue by 49 days')
    expect(invoiceDue(inv('2', '2026-10-16', 10), today)?.label).toBe('Due tomorrow')
    expect(invoiceDue(inv('3', '2026-10-16', 10), '2026-10-10')?.label).toBe('Due in 6 days')
  })
  it('gives paid invoices no label', () => {
    expect(invoiceDue(inv('4', '2026-01-01', 10, 10), today)).toBeUndefined()
  })
})
