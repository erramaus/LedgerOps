// Receivables filtering, status and aging, all derived from each invoice's balance and due date as of a given local day.
// Payment status (how much has been paid) and overdue status (is the balance past due) are separate facts.
import { daysBetween, normalizeDate } from '../../shared/period'
import { describeDue, type DueDescription } from './dueDates'
import type { Invoice } from './bookkeepingTypes'
import type { OpenItemLike } from './openItems'

export type PaymentFilter = 'All' | 'Open' | 'Partially Paid' | 'Paid'
export type AgingFilter = 'All' | 'Overdue' | 'Current' | '1-30' | '31-60' | '60+'
export const paymentFilters: PaymentFilter[] = ['All', 'Open', 'Partially Paid', 'Paid']
export const agingFilters: AgingFilter[] = ['All', 'Overdue', 'Current', '1-30', '31-60', '60+']

export type ReceivableRow = { invoice: Invoice; clientId: string; clientName: string }
export type ReceivableFilters = { payment: PaymentFilter; aging: AgingFilter; search: string }
export const emptyReceivableFilters: ReceivableFilters = { payment: 'All', aging: 'All', search: '' }

const cents = (dollars: number) => Math.round(dollars * 100)
export const openCents = (invoice: OpenItemLike) => cents(invoice.amount) - cents(invoice.amountPaid)

/** Open = nothing paid yet, Partially Paid = some paid and a balance remains, Paid = no balance remains. */
export function paymentStatus(invoice: OpenItemLike): Exclude<PaymentFilter, 'All'> {
  if (openCents(invoice) <= 0) return 'Paid'
  return cents(invoice.amountPaid) > 0 ? 'Partially Paid' : 'Open'
}

/** Days past due, or null when nothing is owed or the due date cannot be read. Zero or negative means not yet late. */
export function daysLate(invoice: OpenItemLike, today: string): number | null {
  if (openCents(invoice) <= 0) return null
  const due = normalizeDate(invoice.dueDate)
  return due ? daysBetween(due, today) : null
}

export const isOverdue = (invoice: OpenItemLike, today: string) => (daysLate(invoice, today) ?? 0) > 0

/** The same bucket boundaries as summarizeOpenItems; paid invoices and unreadable due dates have no bucket. */
export function agingBucket(invoice: OpenItemLike, today: string): Exclude<AgingFilter, 'All' | 'Overdue'> | null {
  const late = daysLate(invoice, today)
  if (late === null) return null
  if (late <= 0) return 'Current'
  if (late <= 30) return '1-30'
  if (late <= 60) return '31-60'
  return '60+'
}

export function matchesAging(invoice: OpenItemLike, aging: AgingFilter, today: string) {
  if (aging === 'All') return true
  if (aging === 'Overdue') return isOverdue(invoice, today)
  return agingBucket(invoice, today) === aging
}

/** Every word typed must appear in the customer, number, client, dates, status or amount (with or without formatting). */
export function searchRows(rows: ReceivableRow[], query: string): ReceivableRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return rows
  return rows.filter(({ invoice, clientName }) => {
    const amounts = [invoice.amount, invoice.amount - invoice.amountPaid].flatMap((value) => [String(value), value.toFixed(2), value.toLocaleString('en-US', { minimumFractionDigits: 2 })])
    const haystack = [invoice.customer, invoice.number, clientName, invoice.invoiceDate, invoice.dueDate, paymentStatus(invoice), ...amounts].join(' ').toLowerCase()
    return words.every((word) => haystack.includes(word.replace(/^\$/, '')))
  })
}

export function filterRows(rows: ReceivableRow[], filters: ReceivableFilters, today: string): ReceivableRow[] {
  return searchRows(rows, filters.search).filter(
    ({ invoice }) => (filters.payment === 'All' || paymentStatus(invoice) === filters.payment) && matchesAging(invoice, filters.aging, today),
  )
}

/** Counts for each option, with the other filters and the search applied so every number matches the table. */
export function filterCounts(rows: ReceivableRow[], filters: ReceivableFilters, today: string) {
  const searched = searchRows(rows, filters.search)
  const payment = Object.fromEntries(paymentFilters.map((option) => [option, searched.filter(({ invoice }) => (option === 'All' || paymentStatus(invoice) === option) && matchesAging(invoice, filters.aging, today)).length])) as Record<PaymentFilter, number>
  const aging = Object.fromEntries(agingFilters.map((option) => [option, searched.filter(({ invoice }) => (filters.payment === 'All' || paymentStatus(invoice) === filters.payment) && matchesAging(invoice, option, today)).length])) as Record<AgingFilter, number>
  return { payment, aging }
}

export const hasActiveFilters = (filters: ReceivableFilters) => filters.payment !== 'All' || filters.aging !== 'All' || filters.search.trim() !== ''

/** Relative due wording for an open invoice. Paid, missing and invalid dates give undefined rather than an invented label. */
export function invoiceDue(invoice: Invoice, today: string): DueDescription | undefined {
  if (openCents(invoice) <= 0) return undefined
  const due = normalizeDate(invoice.dueDate)
  return due ? describeDue(due, today) : undefined
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** "2026-10-15" as "October 15, 2026"; anything unreadable is returned unchanged. */
export function formatLongDate(iso: string): string {
  const date = normalizeDate(iso)
  return date ? `${MONTH_NAMES[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}` : iso
}
