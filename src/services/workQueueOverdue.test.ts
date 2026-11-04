import { describe, expect, it } from 'vitest'
import { buildReviewTasks, summarizeTasks, type ClientRecords } from './workQueue'
import type { Invoice } from './bookkeepingTypes'

const records = (invoices: Invoice[], today?: string): ClientRecords => ({ client: { id: 'c1', name: 'Client' }, transactions: [], invoices, bills: [], accounts: [], reconciliations: [], requests: [], monthEnd: [], today })
const invoice = (id: string, dueDate: string, amount: number, amountPaid: number, status: Invoice['status']): Invoice => ({ id, customer: 'Acme', number: id.toUpperCase(), invoiceDate: '2026-07-01', dueDate, amount, amountPaid, status })

describe('invoice overdue tasks use the balance and the local date', () => {
  it('produces one overdue task for an invoice that is both partially paid and overdue', () => {
    const tasks = buildReviewTasks(records([invoice('a', '2026-09-01', 500, 200, 'Partially Paid')], '2026-10-15'))
    expect(tasks.map((task) => task.kind)).toEqual(['overdue-invoice'])
    expect(tasks[0].description).toContain('partially paid')
    expect(tasks[0].amount).toBe(300)
  })
  it('does not flag an invoice before its due date, even if the stored status says Overdue', () => {
    const tasks = buildReviewTasks(records([invoice('b', '2026-11-01', 500, 0, 'Overdue')], '2026-10-15'))
    expect(summarizeTasks(tasks).overdueInvoices).toBe(0)
  })
  it('does not flag a fully paid invoice', () => {
    expect(buildReviewTasks(records([invoice('c', '2026-01-01', 500, 500, 'Overdue')], '2026-10-15'))).toEqual([])
  })
  it('keeps a not-yet-due partial payment as a partially paid task', () => {
    const tasks = buildReviewTasks(records([invoice('d', '2026-11-01', 500, 100, 'Partially Paid')], '2026-10-15'))
    expect(tasks.map((task) => task.kind)).toEqual(['partially-paid-invoice'])
  })
  it('falls back to the stored status when no date is supplied', () => {
    const tasks = buildReviewTasks(records([invoice('e', '2026-11-01', 500, 0, 'Overdue')]))
    expect(summarizeTasks(tasks).overdueInvoices).toBe(1)
  })
})
