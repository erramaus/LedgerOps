import { describe, expect, it } from 'vitest'
import { billDue, billFilterCounts, emptyBillFilters, filterBills, hasActiveBillFilters, isDueSoon, needsReview, searchBills, type BillRow } from './payablesView'
import { buildReviewTasks, type ClientRecords } from './workQueue'
import { billsWithPayments } from './demoPaymentService'
import { summarizeOpenItems } from './openItems'
import type { Bill } from './bookkeepingTypes'

const TODAY = '2026-10-15'
const bill = (over: Partial<Bill>): Bill => ({ id: 'b', vendor: 'Vendor', number: 'B-1', billDate: 'August 01, 2026', dueDate: 'October 20, 2026', amount: 100, amountPaid: 0, category: 'Materials', status: 'Open', ...over })
const row = (b: Bill, clientName = 'ABC Plumbing'): BillRow => ({ bill: b, clientId: clientName, clientName })

const bills = {
  overdue: bill({ id: 'o', vendor: 'State Farm', number: 'SF-1', dueDate: 'September 15, 2026', amount: 286 }),
  partialLate: bill({ id: 'pl', vendor: 'Late Partial', number: 'LP-1', dueDate: 'September 01, 2026', amount: 500, amountPaid: 200, status: 'Partially Paid' }),
  reviewLate: bill({ id: 'rl', vendor: 'Review Late', number: 'RL-1', dueDate: 'October 01, 2026', amount: 1284, status: 'Needs Review' }),
  soon: bill({ id: 's', vendor: 'Soon Co', number: 'S-1', dueDate: 'October 20, 2026', amount: 860 }),
  later: bill({ id: 'l', vendor: 'Later Co', number: 'L-1', dueDate: 'November 30, 2026', amount: 126.44 }),
  paid: bill({ id: 'p', vendor: 'UPS', number: 'U-1', dueDate: 'August 25, 2026', amount: 210, amountPaid: 210, status: 'Paid' }),
  noDate: bill({ id: 'n', vendor: 'No Date', number: 'N-1', dueDate: '', amount: 40 }),
}
const rows = Object.values(bills).map((b) => row(b))

describe('bill due and review status are separate from payment status', () => {
  it('judges overdue by the remaining balance and the due date, not the stored status', () => {
    const ids = (due: Parameters<typeof filterBills>[1]['due']) => filterBills(rows, { ...emptyBillFilters, due }, TODAY).map((r) => r.bill.id).sort()
    expect(ids('Overdue')).toEqual(['o', 'pl', 'rl'])
    expect(ids('Due soon')).toEqual(['s'])
    expect(ids('Current')).toEqual(['l', 's'])
    expect(ids('1-30')).toEqual(['o', 'rl'])
    expect(ids('31-60')).toEqual(['pl'])
  })
  it('lets a bill be partially paid and overdue, or needing review and overdue', () => {
    const partial = filterBills(rows, { ...emptyBillFilters, payment: 'Partially Paid', due: 'Overdue' }, TODAY)
    expect(partial.map((r) => r.bill.id)).toEqual(['pl'])
    const review = filterBills(rows, { ...emptyBillFilters, review: 'Needs Review', due: 'Overdue' }, TODAY)
    expect(review.map((r) => r.bill.id)).toEqual(['rl'])
  })
  it('never calls a paid bill overdue, due soon or in need of review', () => {
    expect(filterBills(rows, { ...emptyBillFilters, due: 'Overdue' }, TODAY).some((r) => r.bill.id === 'p')).toBe(false)
    expect(isDueSoon(bills.paid, TODAY)).toBe(false)
    expect(needsReview({ ...bills.reviewLate, amountPaid: 1284 })).toBe(false)
    expect(billDue(bills.paid, TODAY)).toBeUndefined()
  })
  it('treats the review flag as separate from partial payment', () => {
    const flagged = bill({ status: 'Partially Paid', needsReview: true, amountPaid: 10 })
    expect(needsReview(flagged)).toBe(true)
    expect(needsReview(bills.soon)).toBe(false)
  })
  it('does not invent a due label or bucket for a missing or invalid date', () => {
    expect(billDue(bills.noDate, TODAY)).toBeUndefined()
    expect(filterBills(rows, { ...emptyBillFilters, due: 'Overdue' }, TODAY).some((r) => r.bill.id === 'n')).toBe(false)
    expect(filterBills(rows, { ...emptyBillFilters, due: 'Current' }, TODAY).some((r) => r.bill.id === 'n')).toBe(false)
  })
  it('gives relative labels from the date it is given', () => {
    expect(billDue(bills.overdue, TODAY)?.label).toBe('Overdue by 30 days')
    expect(billDue(bills.soon, TODAY)?.label).toBe('Due in 5 days')
    expect(billDue(bills.soon, '2026-10-19')?.label).toBe('Due tomorrow')
  })
})

describe('bill search and counts', () => {
  it('searches vendor, number, client, date and amount', () => {
    const named = [row(bills.overdue, 'Green Leaf Landscaping'), row(bills.soon)]
    expect(searchBills(named, 'green leaf')).toHaveLength(1)
    expect(searchBills(named, 'state farm')).toHaveLength(1)
    expect(searchBills(named, 'S-1')).toHaveLength(1)
    expect(searchBills(named, '$860.00')).toHaveLength(1)
    expect(searchBills(named, 'october 20')).toHaveLength(1)
    expect(searchBills(named, 'zzz')).toHaveLength(0)
  })
  it('keeps every filter count equal to what the table would show', () => {
    const filters = { ...emptyBillFilters, due: 'Overdue' as const }
    const counts = billFilterCounts(rows, filters, TODAY)
    expect(counts.payment.All).toBe(3)
    expect(counts.payment['Partially Paid']).toBe(1)
    expect(counts.review['Needs Review']).toBe(1)
    expect(counts.due.All).toBe(rows.length)
    for (const option of ['Open', 'Partially Paid', 'Paid'] as const) expect(counts.payment[option]).toBe(filterBills(rows, { ...filters, payment: option }, TODAY).length)
  })
  it('detects active filters', () => {
    expect(hasActiveBillFilters(emptyBillFilters)).toBe(false)
    expect(hasActiveBillFilters({ ...emptyBillFilters, search: 'x' })).toBe(true)
  })
})

describe('summary figures from bill and payment data', () => {
  it('counts only unpaid balances in the due figures and every payment in Paid So Far', () => {
    const summary = summarizeOpenItems(Object.values(bills), TODAY)
    expect(summary.dueWithin7DaysCents).toBe(86000)
    expect(summary.days1to30Cents).toBe(28600 + 128400)
    expect(summary.days31to60Cents).toBe(30000)
    expect(summary.paidCents).toBe(20000 + 21000)
    expect(summary.unreadable).toBe(1)
  })
  it('keeps the review flag and moves amounts when a payment is recorded', () => {
    const base = [bill({ id: 'x', amount: 100, status: 'Needs Review' })]
    const paid = billsWithPayments(base, [{ id: 'k', clientId: 'abc-plumbing', kind: 'bill', documentId: 'x', version: 1, payments: [{ id: 'p1', amountCents: 4000, status: 'active' }] } as never])
    expect(paid[0].amountPaid).toBe(40)
    expect(needsReview(paid[0])).toBe(true)
  })
})

describe('work queue bills', () => {
  const records = (list: Bill[]): ClientRecords => ({ client: { id: 'c', name: 'C' }, transactions: [], invoices: [], bills: list, accounts: [], reconciliations: [], requests: [], monthEnd: [], today: TODAY })
  const tasks = (list: Bill[]) => buildReviewTasks(records(list)).filter((task) => task.type === 'Payables')
  it('matches the Payables overdue count and ignores stale stored statuses', () => {
    const stale = bill({ id: 'st', status: 'Open', dueDate: 'September 01, 2026' })
    const staleOverdue = bill({ id: 'so', status: 'Overdue', dueDate: 'November 30, 2026' })
    const found = tasks([stale, staleOverdue])
    expect(found.filter((task) => task.kind === 'overdue-bill').map((task) => task.recordId)).toEqual(['st'])
  })
  it('creates one payment task per bill plus a separate review task', () => {
    const found = tasks([bills.partialLate, bills.reviewLate, bills.soon, bills.paid])
    expect(found.map((task) => `${task.recordId}:${task.kind}`).sort()).toEqual(['pl:overdue-bill', 'rl:bill-needs-review', 'rl:overdue-bill', 's:bill-due-soon'])
    expect(found.find((task) => task.recordId === 'pl')?.description).toContain('partially paid')
  })
  it('stops reporting a bill once it is fully paid', () => {
    expect(tasks([{ ...bills.overdue, amountPaid: 286 }])).toEqual([])
  })
})
