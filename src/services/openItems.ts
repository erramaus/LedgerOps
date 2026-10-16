// Aging of the invoices or bills a page is showing, calculated from those records as of a given day.
// An item whose due date cannot be read is counted as `unreadable`; it is never placed in a bucket by guesswork.
import { daysBetween, normalizeDate } from '../../shared/period'

export type OpenItemLike = { dueDate: string; amount: number; amountPaid: number }
export type AgingSummary = {
  totalCents: number
  currentCents: number
  days1to30Cents: number
  days31to60Cents: number
  over60Cents: number
  dueWithin7DaysCents: number
  paidCents: number
  /** Open items whose due date could not be read. Their amounts are in `totalCents` but in no bucket. */
  unreadable: number
}

const cents = (dollars: number) => Math.round(dollars * 100)

export function summarizeOpenItems(items: OpenItemLike[], today: string): AgingSummary {
  const summary: AgingSummary = { totalCents: 0, currentCents: 0, days1to30Cents: 0, days31to60Cents: 0, over60Cents: 0, dueWithin7DaysCents: 0, paidCents: 0, unreadable: 0 }
  for (const item of items) {
    summary.paidCents += cents(item.amountPaid)
    const open = cents(item.amount) - cents(item.amountPaid)
    if (open <= 0) continue
    summary.totalCents += open
    const due = normalizeDate(item.dueDate)
    if (!due) {
      summary.unreadable += 1
      continue
    }
    const late = daysBetween(due, today)
    if (late <= 0) {
      summary.currentCents += open
      if (late >= -7) summary.dueWithin7DaysCents += open
    } else if (late <= 30) summary.days1to30Cents += open
    else if (late <= 60) summary.days31to60Cents += open
    else summary.over60Cents += open
  }
  return summary
}
