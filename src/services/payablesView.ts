// Payables filtering and status. Three separate facts about a bill, each derived from the record as of a local day:
// payment status (amounts), review status (an explicit flag) and due status (balance plus due date).
import { normalizeDate } from '../../shared/period'
import type { Bill } from './bookkeepingTypes'
import { describeDue, type DueDescription } from './dueDates'
import { daysLate, isOverdue, openCents, paymentStatus, type PaymentFilter } from './receivablesView'

export type BillPaymentFilter = PaymentFilter
export type ReviewFilter = 'All' | 'Needs Review' | 'Not flagged'
export type DueFilter = 'All' | 'Overdue' | 'Due soon' | 'Current' | '1-30' | '31-60' | '60+'
export const billPaymentFilters: BillPaymentFilter[] = ['All', 'Open', 'Partially Paid', 'Paid']
export const reviewFilters: ReviewFilter[] = ['All', 'Needs Review', 'Not flagged']
export const dueFilters: DueFilter[] = ['All', 'Overdue', 'Due soon', 'Current', '1-30', '31-60', '60+']

export type BillRow = { bill: Bill; clientId: string; clientName: string }
export type BillFilters = { payment: BillPaymentFilter; review: ReviewFilter; due: DueFilter; search: string }
export const emptyBillFilters: BillFilters = { payment: 'All', review: 'All', due: 'All', search: '' }

/** Needs review only matters while money is still owed; a settled bill has nothing left to approve for payment. */
export const needsReview = (bill: Bill) => openCents(bill) > 0 && (bill.needsReview ?? bill.status === 'Needs Review')

/** Due within the next 7 days, including today, and not yet late. */
export function isDueSoon(bill: Bill, today: string) {
  const late = daysLate(bill, today)
  return late !== null && late <= 0 && late >= -7
}

export function matchesDue(bill: Bill, due: DueFilter, today: string) {
  if (due === 'All') return true
  if (due === 'Overdue') return isOverdue(bill, today)
  if (due === 'Due soon') return isDueSoon(bill, today)
  const late = daysLate(bill, today)
  if (late === null) return false
  if (due === 'Current') return late <= 0
  if (due === '1-30') return late >= 1 && late <= 30
  if (due === '31-60') return late >= 31 && late <= 60
  return late > 60
}

/** Every word typed must appear in the vendor, bill number, client, dates, statuses or amount (with or without formatting). */
export function searchBills(rows: BillRow[], query: string): BillRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return rows
  return rows.filter(({ bill, clientName }) => {
    const amounts = [bill.amount, bill.amount - bill.amountPaid].flatMap((value) => [String(value), value.toFixed(2), value.toLocaleString('en-US', { minimumFractionDigits: 2 })])
    const haystack = [bill.vendor, bill.number, clientName, bill.billDate, bill.dueDate, paymentStatus(bill), needsReview(bill) ? 'needs review' : '', ...amounts].join(' ').toLowerCase()
    return words.every((word) => haystack.includes(word.replace(/^\$/, '')))
  })
}

const passes = (bill: Bill, filters: BillFilters, today: string) =>
  (filters.payment === 'All' || paymentStatus(bill) === filters.payment) &&
  (filters.review === 'All' || (filters.review === 'Needs Review') === needsReview(bill)) &&
  matchesDue(bill, filters.due, today)

export function filterBills(rows: BillRow[], filters: BillFilters, today: string): BillRow[] {
  return searchBills(rows, filters.search).filter(({ bill }) => passes(bill, filters, today))
}

/** Counts for each option with the search and the other two filter groups applied, so every number matches the table. */
export function billFilterCounts(rows: BillRow[], filters: BillFilters, today: string) {
  const searched = searchBills(rows, filters.search)
  const count = (override: Partial<BillFilters>) => searched.filter(({ bill }) => passes(bill, { ...filters, ...override }, today)).length
  return {
    payment: Object.fromEntries(billPaymentFilters.map((option) => [option, count({ payment: option })])) as Record<BillPaymentFilter, number>,
    review: Object.fromEntries(reviewFilters.map((option) => [option, count({ review: option })])) as Record<ReviewFilter, number>,
    due: Object.fromEntries(dueFilters.map((option) => [option, count({ due: option })])) as Record<DueFilter, number>,
  }
}

export const hasActiveBillFilters = (filters: BillFilters) =>
  filters.payment !== 'All' || filters.review !== 'All' || filters.due !== 'All' || filters.search.trim() !== ''

/** Relative due wording for an open bill. Paid, missing and invalid dates give undefined rather than an invented label. */
export function billDue(bill: Bill, today: string): DueDescription | undefined {
  if (openCents(bill) <= 0) return undefined
  const due = normalizeDate(bill.dueDate)
  return due ? describeDue(due, today) : undefined
}
