import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import App from './App'
import { demoDataService } from './services/demoDataService'
import { buildWorkTasks, summarizeTasks, type ClientRecords } from './services/workQueue'
import { buildAutomationTasks } from './services/automationReminders'
import { demoRecurringHistory } from './services/automationDemoData'
import { historyFromTransactions, recurringFromHistory } from './services/recurringTransactions'

const { clients, demoClient, transactions, invoices, bills, reconciliationAccounts, clientRequests, monthEndItems } = demoDataService

const html = renderToStaticMarkup(<App user={{ sub: 'u1', email: 'pat@example.com', name: 'Pat Bookkeeper' }} onSignOut={() => undefined} />)

const records: ClientRecords = {
  client: { id: demoClient.id, name: demoClient.name },
  transactions, invoices, bills, accounts: [], reconciliations: reconciliationAccounts,
  requests: clientRequests.filter((request) => !request.quickBooksId),
  monthEnd: monthEndItems,
}
const visibleRecurringHistory = historyFromTransactions(demoClient.id, 'demo', transactions)
const visibleRecurringKeys = new Set(visibleRecurringHistory.map((entry) => `${entry.payee}|${entry.date}|${entry.amountCents}`))
const recurringHistory = [
  ...demoRecurringHistory.filter((entry) => entry.clientId === demoClient.id && !visibleRecurringKeys.has(`${entry.payee}|${entry.date}|${entry.amountCents}`)),
  ...visibleRecurringHistory,
]
const recurringPatterns = recurringFromHistory(recurringHistory, '2026-10-15')
const baseTasks = buildWorkTasks(records, clients.filter((client) => client.id !== demoClient.id))
const summary = summarizeTasks([...baseTasks, ...buildAutomationTasks(records.client, new Map(), recurringPatterns)])
const metric = (label: string) => new RegExp(`${label}</span><strong>([^<]+)</strong>`).exec(html)?.[1]

describe('dashboard first render (demo data)', () => {
  it('shows figures calculated from the demo records', () => {
    expect(metric('Clients')).toBe(String(clients.length))
    expect(metric('Clients needing attention')).toBe(String(summary.clientsNeedingAttention))
    expect(metric('Transactions to review')).toBe(String(summary.transactions))
    expect(metric('Reconciliation issues')).toBe(String(summary.reconciliation))
    expect(metric('Overdue invoices')).toBe(String(summary.overdueInvoices))
    expect(metric('Overdue bills')).toBe(String(summary.overdueBills))
    expect(metric('Client questions')).toBe(String(summary.clientQuestions))
    expect(metric('High priority')).toBe(String(summary.high))
  })

  it('no longer contains the old hardcoded totals or names', () => {
    expect(html).not.toContain('Jordan')
    expect(html).not.toContain('September 7, 2026')
    expect(html).not.toContain('14 transactions')
    expect(html).not.toMatch(/Month end<\/span><strong>90%/)
  })

  it('makes the active data source and client selection obvious', () => {
    expect(html).toContain('source-badge demo')
    expect(html).toMatch(/<option value=""[^>]*>All clients<\/option>/)
    clients.forEach((client) => expect(html).toContain(`>${client.name}</option>`))
    expect(html).toContain('Pat Bookkeeper')
  })

  it('lists the highest-priority task first in Today’s work', () => {
    const firstCard = /review-card[^>]*>.*?priority-badge (\w+)/s.exec(html)?.[1]
    expect(firstCard).toBe('high')
    expect(html).toContain('Today&#x27;s work')
  })

  it('never shows "Not available" for demo data, which is fully loaded', () => {
    expect(html).not.toContain('Not available')
  })
})
