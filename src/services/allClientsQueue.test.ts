import { describe, expect, it } from 'vitest'
import { ADDITIONAL_DEMO_CLIENT_IDS, getAdditionalDemoCompany } from '../../shared/demoCompanyBooks'
import type { MonthEndItem } from '../data/demoData'
import { companyBills, companyInvoices, companyMonthEndItems, companyReconciliationAccounts, companyRequests, companyTransactions } from './demoCompanyData'
import { demoDataService } from './demoDataService'
import { matchesDue } from './payablesView'
import { isOverdue } from './receivablesView'
import { buildWorkTasks, countByClient, sortTasks, summarizeTasks, type ClientRecords } from './workQueue'

const TODAY = '2026-10-15'
const { demoClient, transactions, invoices, bills, reconciliationAccounts, clientRequests, monthEndItems } = demoDataService

const abc: ClientRecords = {
  client: { id: demoClient.id, name: demoClient.name },
  transactions, invoices, bills, accounts: [], reconciliations: reconciliationAccounts,
  requests: clientRequests.filter((request) => !request.quickBooksId && (request.clientId ?? demoClient.id) === demoClient.id),
  monthEnd: monthEndItems, today: TODAY,
}
const companies = ADDITIONAL_DEMO_CLIENT_IDS.flatMap((id) => {
  const company = getAdditionalDemoCompany(id)
  return company ? [company] : []
})
const others: ClientRecords[] = companies.map((company) => ({
  client: { id: company.clientId, name: company.clientName },
  transactions: companyTransactions(company), invoices: companyInvoices(company), bills: companyBills(company), accounts: [],
  reconciliations: companyReconciliationAccounts(company), requests: companyRequests(company),
  monthEnd: companyMonthEndItems(company, { year: 2026, month: 8 }) as MonthEndItem[], today: TODAY,
}))
const everyClient = [abc, ...others]
const perClient = everyClient.map((records) => buildWorkTasks(records))
const allTasks = sortTasks(perClient.flat())

describe('All clients work queue', () => {
  it('builds item-level tasks for all five companies and no summary-only tasks', () => {
    expect(everyClient).toHaveLength(5)
    perClient.forEach((tasks) => expect(tasks.length).toBeGreaterThan(0))
    expect(allTasks.some((task) => task.kind.startsWith('summary-'))).toBe(false)
    expect(new Set(allTasks.map((task) => task.clientId)).size).toBe(5)
  })

  it('totals equal the sum of the individual client totals', () => {
    const all = summarizeTasks(allTasks)
    const each = perClient.map((tasks) => summarizeTasks(tasks))
    const total = (pick: (summary: ReturnType<typeof summarizeTasks>) => number) => each.reduce((sum, summary) => sum + pick(summary), 0)
    expect(all.total).toBe(total((summary) => summary.total))
    expect(all.transactions).toBe(total((summary) => summary.transactions))
    expect(all.reconciliation).toBe(total((summary) => summary.reconciliation))
    expect(all.clientQuestions).toBe(total((summary) => summary.clientQuestions))
    expect(all.overdueInvoices).toBe(total((summary) => summary.overdueInvoices))
    expect(all.overdueBills).toBe(total((summary) => summary.overdueBills))
    expect(all.high).toBe(total((summary) => summary.high))
    expect(all.clientsNeedingAttention).toBe(5)
  })

  it('overdue invoice and bill counts match the Receivables and Payables lists', () => {
    everyClient.forEach((records, index) => {
      const summary = summarizeTasks(perClient[index])
      expect(summary.overdueInvoices, `${records.client.name} invoices`).toBe(records.invoices.filter((invoice) => isOverdue(invoice, TODAY)).length)
      expect(summary.overdueBills, `${records.client.name} bills`).toBe(records.bills.filter((bill) => matchesDue(bill, 'Overdue', TODAY)).length)
    })
    const all = summarizeTasks(allTasks)
    expect(all.overdueInvoices).toBe(everyClient.flatMap((records) => records.invoices).filter((invoice) => isOverdue(invoice, TODAY)).length)
    expect(all.overdueInvoices).toBeGreaterThan(abc.invoices.filter((invoice) => isOverdue(invoice, TODAY)).length)
  })

  it('every task carries its owning client and only references that client’s records', () => {
    everyClient.forEach((records) => {
      const own = new Set([...records.transactions, ...records.invoices, ...records.bills].map((record) => record.id))
      allTasks.filter((task) => task.clientId === records.client.id).forEach((task) => {
        expect(task.client).toBe(records.client.name)
        expect(task.id.startsWith(`${records.client.id}/`)).toBe(true)
        if (task.recordId) expect(own.has(task.recordId)).toBe(true)
      })
    })
  })

  it('opens a specific record for tasks from companies other than ABC Plumbing', () => {
    const invoiceTask = allTasks.find((task) => task.kind === 'overdue-invoice' && task.clientId !== demoClient.id)
    expect(invoiceTask?.recordId).toBeTruthy()
    expect(invoiceTask?.destination).toBe('Receivables')
    const billTask = allTasks.find((task) => task.kind === 'overdue-bill' && task.clientId !== demoClient.id)
    expect(billTask?.recordId).toBeTruthy()
    expect(billTask?.destination).toBe('Payables')
    const reconciliation = allTasks.find((task) => task.kind === 'reconciliation-difference' && task.clientId !== demoClient.id)
    expect(reconciliation?.destination).toBe('Reconcile')
  })

  it('has no duplicate task ids and counts match per client', () => {
    expect(new Set(allTasks.map((task) => task.id)).size).toBe(allTasks.length)
    const counts = countByClient(allTasks)
    everyClient.forEach((records, index) => {
      expect(counts[records.client.id]).toBe(summarizeTasks(perClient[index]).total)
    })
  })

  it('sorts high priority first across clients', () => {
    const rank = { High: 0, Medium: 1, Low: 2 }
    for (let index = 1; index < allTasks.length; index += 1) {
      expect(rank[allTasks[index - 1].priority]).toBeLessThanOrEqual(rank[allTasks[index].priority])
    }
  })
})
