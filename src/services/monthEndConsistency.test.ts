import { describe, expect, it } from 'vitest'
import { demoPayableItems, demoReceivableItems } from '../../shared/demoBooks'
import { demoOpenItems, demoReport } from '../../shared/demoMonthEnd'
import { openBalanceCents, type OpenItem } from '../../shared/accounting'
import { parsePeriodKey, periodEnd } from '../../shared/period'
import { summarizeOpenItems } from './openItems'

const period = (key: string) => parsePeriodKey(key)!
// What the Receivables and Payables tabs hold for a document on a given day.
const asTabItem = (item: OpenItem, day: string) => ({ dueDate: item.dueDate, amount: item.amountCents / 100, amountPaid: (item.amountCents - openBalanceCents(item, day)) / 100 })
const kinds = [['ar', demoReceivableItems, 'ar-aging'], ['ap', demoPayableItems, 'ap-aging']] as const

describe('Month End agrees with the Receivables and Payables tabs', () => {
  for (const [kind, items, reportId] of kinds) {
    for (const key of ['2026-07', '2026-08']) {
      it(`${kind.toUpperCase()} ${key}: at the month end, total and overdue match the tab's own aging and the Reports aging`, () => {
        const end = periodEnd(period(key))
        const facts = demoOpenItems(kind, period(key), undefined, '2026-10-15').facts!
        const tab = summarizeOpenItems(items().filter((item) => item.date <= end).map((item) => asTabItem(item, end)), end)
        expect(facts.asOf).toBe(end)
        expect(facts.totalCents).toBe(tab.totalCents)
        expect(facts.overdueCents).toBe(tab.totalCents - tab.currentCents)
        const grand = demoReport(reportId, { start: `${key}-01`, end, label: key }).rows.find((row) => row.style === 'grand')!
        expect(grand.cells[grand.cells.length - 1]).toBe(facts.totalCents)
      })
    }

    it(`${kind.toUpperCase()}: today's figures use the same rule at today's date and are kept apart from the month-end figures`, () => {
      const today = '2026-10-15'
      const facts = demoOpenItems(kind, period('2026-08'), undefined, today).facts!
      const tab = summarizeOpenItems(items().filter((item) => item.date <= today).map((item) => asTabItem(item, today)), today)
      expect(facts.today).toMatchObject({ date: today, totalCents: tab.totalCents, overdueCents: tab.totalCents - tab.currentCents })
      expect(facts.asOf).toBe('2026-08-31')
    })
  }

  it('today is optional: without it there are no current-day figures, and nothing is invented', () => {
    expect(demoOpenItems('ar', period('2026-08')).facts!.today).toBeUndefined()
  })

  it('looking at a month on a later day does not change the month-end figures', () => {
    const early = demoOpenItems('ar', period('2026-08'), undefined, '2026-09-05').facts!
    const late = demoOpenItems('ar', period('2026-08'), undefined, '2026-12-31').facts!
    expect({ ...early, today: undefined }).toEqual({ ...late, today: undefined })
  })
})
