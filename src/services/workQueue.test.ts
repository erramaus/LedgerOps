import { describe, expect, it } from 'vitest'
import type { ClientRequest, LedgerAccount, LedgerBill, LedgerInvoice, LedgerTransaction } from './bookkeepingTypes'
import { demoDataService } from './demoDataService'
import { needsCategory } from './transactionReview'
import {
  QUICKBOOKS_CLIENT_ID,
  buildReviewTasks,
  buildWorkTasks,
  countByClient,
  countByType,
  filterTasks,
  isReviewTask,
  monthEndPercent,
  scopeRequests,
  sortTasks,
  summarizeTasks,
  taskPriorities,
  type ClientRecords,
  type WorkTask,
} from './workQueue'

const { clients, demoClient, transactions, invoices, bills, reconciliationAccounts, clientRequests, monthEndItems } = demoDataService
const validDestinations = ['Transactions', 'Receivables', 'Payables', 'Reconcile', 'Client Requests', 'Month End']

const demoRecords: ClientRecords = {
  client: { id: demoClient.id, name: demoClient.name },
  transactions,
  invoices,
  bills,
  accounts: [],
  reconciliations: reconciliationAccounts,
  requests: scopeRequests(clientRequests, 'demo'),
  monthEnd: monthEndItems,
}
const otherClients = clients.filter((client) => client.id !== demoClient.id)
const demoTasks = buildWorkTasks(demoRecords, otherClients)

const sandboxRecords = (overrides: Partial<ClientRecords> = {}): ClientRecords => ({
  client: { id: QUICKBOOKS_CLIENT_ID, name: 'Sandbox Company' },
  transactions: [],
  invoices: [],
  bills: [],
  accounts: [],
  reconciliations: [],
  requests: [],
  monthEnd: [],
  ...overrides,
})

const qbTransaction = (overrides: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: 'quickbooks-Purchase-1', date: '2026-10-01', payee: 'Vendor', description: '', amount: '$50.00', category: 'Office', status: 'Categorized', source: 'quickbooks', ...overrides,
})

describe('task counts are calculated from the records', () => {
  it('finds each rule-based issue in the demo client records', () => {
    const tasks = buildReviewTasks(demoRecords)
    const kinds = (kind: WorkTask['kind']) => tasks.filter((task) => task.kind === kind).length
    expect(kinds('uncategorized')).toBe(transactions.filter((item) => needsCategory(item)).length)
    expect(kinds('needs-receipt')).toBe(transactions.filter((item) => item.status === 'Needs Receipt').length)
    expect(kinds('overdue-invoice')).toBe(invoices.filter((item) => item.status === 'Overdue').length)
    expect(kinds('overdue-bill')).toBe(bills.filter((item) => item.status === 'Overdue').length)
    expect(kinds('reconciliation-difference')).toBe(1)
  })

  it('counts open client questions and ignores resolved ones', () => {
    const questions = demoTasks.filter((task) => task.kind === 'client-question')
    expect(questions.map((task) => task.requestId).sort()).toEqual(['request-deposit', 'request-home-depot'])
  })

  it('adds one month-end task per client with unfinished work', () => {
    const monthEnd = demoTasks.filter((task) => task.type === 'Month End')
    const expected = [demoClient, ...otherClients].filter((client) => client.id === demoClient.id || client.monthEnd < 100)
    expect(monthEnd.map((task) => task.clientId).sort()).toEqual(expected.map((client) => client.id).sort())
  })

  it('changes when the records change instead of using fixed numbers', () => {
    const fixed = transactions.map((item) => (needsCategory(item) ? { ...item, category: 'Materials', lines: undefined } : item))
    const before = summarizeTasks(demoTasks).transactions
    const after = summarizeTasks(buildWorkTasks({ ...demoRecords, transactions: fixed }, otherClients)).transactions
    expect(after).toBe(before - transactions.filter((item) => needsCategory(item)).length)
  })

  it('summarizes totals, priorities and per-type counts consistently', () => {
    const summary = summarizeTasks(demoTasks)
    const byType = countByType(demoTasks)
    expect(summary.total).toBe(Object.values(byType).reduce((total, count) => total + count, 0))
    expect(summary.transactions).toBe(byType.Transactions)
    expect(summary.high).toBe(demoTasks.filter((task) => task.priority === 'High').reduce((total, task) => total + task.count, 0))
    expect(summary.clientsNeedingAttention).toBe(new Set(demoTasks.map((task) => task.clientId)).size)
    expect(summary.overdueInvoices).toBe(1)
    expect(summary.overdueBills).toBe(1)
  })

  it('reports no tasks for clean records', () => {
    expect(buildWorkTasks(sandboxRecords({ transactions: [qbTransaction({})] }))).toEqual([])
  })

  it('computes month-end percent only from checks that can be evaluated', () => {
    expect(monthEndPercent(monthEndItems)).toBe(90)
    expect(monthEndPercent([{ id: 'a', label: 'A', status: 'Not Available' }])).toBeNull()
    expect(monthEndPercent([{ id: 'a', label: 'A', status: 'Complete' }, { id: 'b', label: 'B', status: 'Not Available' }])).toBe(100)
  })
})

describe('priorities', () => {
  it('orders High before Medium before Low', () => {
    const ranks = demoTasks.map((task) => taskPriorities.indexOf(task.priority))
    expect(ranks).toEqual([...ranks].sort((left, right) => left - right))
  })

  it('puts earlier due dates (overdue work) first within a priority', () => {
    const base = { clientId: 'c', client: 'C', type: 'Payables', kind: 'overdue-bill', issue: 'x', description: 'x', priority: 'High', status: 'Open', suspected: false, count: 1, destination: 'Payables', action: 'x' } as const
    const sorted = sortTasks([
      { ...base, id: 'later', dueDate: '2026-09-30' },
      { ...base, id: 'none' },
      { ...base, id: 'earlier', dueDate: '2026-08-15' },
    ])
    expect(sorted.map((task) => task.id)).toEqual(['earlier', 'later', 'none'])
  })

  it('treats a large overdue invoice as High and a small one as Medium', () => {
    const invoice = (id: string, amount: number): LedgerInvoice => ({ id, customer: 'Customer', number: id, invoiceDate: '2026-07-01', dueDate: '2026-08-01', amount, amountPaid: 0, status: 'Overdue' })
    const tasks = buildReviewTasks(sandboxRecords({ invoices: [invoice('big', 2500), invoice('small', 200)] }))
    expect(tasks.find((task) => task.id.includes('big'))?.priority).toBe('High')
    expect(tasks.find((task) => task.id.includes('small'))?.priority).toBe('Medium')
  })

  it('keeps partial invoice and bill balances in the review queues', () => {
    const partialInvoice: LedgerInvoice = { id: 'partial-invoice', customer: 'Customer', number: 'PI-1', invoiceDate: '2026-08-01', dueDate: '2026-08-31', amount: 500, amountPaid: 200, status: 'Partially Paid' }
    const partialBill: LedgerBill = { id: 'partial-bill', vendor: 'Vendor', number: 'PB-1', billDate: '2026-08-01', dueDate: '2026-08-31', amount: 800, amountPaid: 300, category: 'Materials', status: 'Partially Paid' }
    const tasks = buildReviewTasks(sandboxRecords({ invoices: [partialInvoice], bills: [partialBill] }))
    expect(tasks.find((task) => task.kind === 'partially-paid-invoice')).toMatchObject({ amount: 300, destination: 'Receivables' })
    expect(tasks.find((task) => task.kind === 'partially-paid-bill')).toMatchObject({ amount: 500, destination: 'Payables' })
  })

  it('carries ISO due dates from both demo and QuickBooks date formats', () => {
    const overdue = demoTasks.find((task) => task.kind === 'overdue-invoice')
    expect(overdue?.dueDate).toBe('2026-08-27')
    const qb = buildReviewTasks(sandboxRecords({ invoices: [{ id: 'quickbooks-invoice-9', customer: 'C', number: '9', invoiceDate: '2026-07-01', dueDate: '2026-09-02', amount: 10, amountPaid: 0, status: 'Overdue' }] }))
    expect(qb[0].dueDate).toBe('2026-09-02')
  })
})

describe('suspected problems are not presented as confirmed errors', () => {
  it('marks heuristics as suspected and factual gaps as not suspected', () => {
    const tasks = buildReviewTasks({
      ...sandboxRecords(),
      transactions: [
        qbTransaction({ id: 'a', payee: 'Acme', amount: '$40.00' }),
        qbTransaction({ id: 'b', payee: 'Acme', amount: '$40.00' }),
        qbTransaction({ id: 'c', payee: 'Big Co', amount: '$6,500.00' }),
        qbTransaction({ id: 'd', category: 'Uncategorized', payee: 'Unknown' }),
      ],
    })
    const byKind = (kind: WorkTask['kind']) => tasks.find((task) => task.kind === kind)
    expect(byKind('possible-duplicate')?.suspected).toBe(true)
    expect(byKind('large-transaction')?.suspected).toBe(true)
    expect(byKind('uncategorized')?.suspected).toBe(false)
    expect(byKind('missing-payee')?.suspected).toBe(false)
    expect(byKind('possible-duplicate')?.description).toMatch(/compare/i)
    expect(tasks.map((task) => task.description).join(' ')).not.toMatch(/\berror\b|\bwrong\b|\bfraud/i)
  })

  it('does not flag a duplicate when the payee is unknown', () => {
    const tasks = buildReviewTasks(sandboxRecords({ transactions: [qbTransaction({ id: 'a', payee: 'Unknown' }), qbTransaction({ id: 'b', payee: 'Unknown' })] }))
    expect(tasks.some((task) => task.kind === 'possible-duplicate')).toBe(false)
  })
})

describe('client selection', () => {
  it('attributes detailed tasks to the demo client and summary tasks to their own clients', () => {
    const owners = new Set(demoTasks.map((task) => task.clientId))
    expect(owners.has(demoClient.id)).toBe(true)
    otherClients.filter((client) => client.attention > 0).forEach((client) => expect(owners.has(client.id)).toBe(true))
    expect(demoTasks.filter((task) => task.clientId === demoClient.id).every((task) => task.client === demoClient.name)).toBe(true)
  })

  it('shows only the selected client’s tasks and counts', () => {
    const smith = clients.find((client) => client.id === 'smith-construction')!
    const selected = filterTasks(demoTasks, { clientId: smith.id })
    expect(selected.length).toBeGreaterThan(0)
    expect(selected.every((task) => task.clientId === smith.id)).toBe(true)
    expect(summarizeTasks(selected).clientsNeedingAttention).toBe(1)
    expect(countByClient(demoTasks)[smith.id]).toBe(selected.reduce((total, task) => total + task.count, 0))
  })

  it('shows every client when none is selected', () => {
    expect(filterTasks(demoTasks, { clientId: null })).toHaveLength(demoTasks.length)
    expect(filterTasks(demoTasks, {})).toHaveLength(demoTasks.length)
  })

  it('returns nothing for a client with no tasks', () => {
    expect(filterTasks(demoTasks, { clientId: 'green-leaf-landscaping', type: 'Payables' })).toEqual([])
    expect(filterTasks(demoTasks, { clientId: 'unknown-client' })).toEqual([])
  })

  it('keeps summary-only clients from claiming records they do not have', () => {
    const summary = demoTasks.filter((task) => task.kind.startsWith('summary-'))
    expect(summary.every((task) => task.clientId !== demoClient.id)).toBe(true)
    expect(summary.filter((task) => task.kind === 'summary-flagged').every((task) => /summary only/i.test(task.description))).toBe(true)
  })

  it('never mixes demo records into QuickBooks mode', () => {
    const quickBooksTasks = buildWorkTasks(
      sandboxRecords({
        transactions: [qbTransaction({ id: 'quickbooks-Purchase-7', category: 'Uncategorized' })],
        accounts: [{ quickBooksId: '5', name: 'Checking', accountType: 'Bank', currentBalance: -20, active: true } satisfies LedgerAccount],
        requests: scopeRequests([...clientRequests, { id: 'qb-request', client: 'Sandbox Company', requestType: 'Transaction Question', dateCreated: 'x', question: 'Q?', status: 'Waiting for Client', quickBooksId: '7' } satisfies ClientRequest], 'quickbooks'),
      }),
    )
    expect(quickBooksTasks.length).toBeGreaterThan(0)
    expect(quickBooksTasks.every((task) => task.clientId === QUICKBOOKS_CLIENT_ID && task.client === 'Sandbox Company')).toBe(true)
    expect(quickBooksTasks.some((task) => task.kind === 'reconciliation-difference' || task.kind.startsWith('summary-'))).toBe(false)
    expect(quickBooksTasks.filter((task) => task.kind === 'client-question').map((task) => task.requestId)).toEqual(['qb-request'])
    expect(JSON.stringify(quickBooksTasks)).not.toMatch(/ABC Plumbing|Home Depot|Westview/)
  })

  it('separates demo and QuickBooks client requests by source', () => {
    const qbRequest = { id: 'qb', client: 'Sandbox', requestType: 'Transaction Question', dateCreated: 'x', question: 'Q', status: 'Waiting for Client', quickBooksId: '1' } satisfies ClientRequest
    const all = [...clientRequests, qbRequest]
    expect(scopeRequests(all, 'demo').map((request) => request.id)).not.toContain('qb')
    expect(scopeRequests(all, 'quickbooks').map((request) => request.id)).toEqual(['qb'])
  })
})

describe('filtering', () => {
  it('filters by priority', () => {
    const high = filterTasks(demoTasks, { priority: 'High' })
    expect(high.length).toBeGreaterThan(0)
    expect(high.every((task) => task.priority === 'High')).toBe(true)
    expect(filterTasks(demoTasks, { priority: 'All' })).toHaveLength(demoTasks.length)
  })

  it('filters by status', () => {
    const waiting = filterTasks(demoTasks, { status: 'Waiting on client' })
    expect(waiting.length).toBeGreaterThan(0)
    expect(waiting.every((task) => task.status === 'Waiting on client')).toBe(true)
    expect(filterTasks(demoTasks, { status: 'Ready to review' }).map((task) => task.requestId)).toContain('request-deposit')
  })

  it('filters by task type', () => {
    const payables = filterTasks(demoTasks, { type: 'Payables' })
    expect(payables).toHaveLength(3)
    expect(payables.every((task) => task.type === 'Payables')).toBe(true)
  })

  it('combines filters', () => {
    const combined = filterTasks(demoTasks, { clientId: demoClient.id, type: 'Transactions', priority: 'High' })
    expect(combined.length).toBeGreaterThan(0)
    expect(combined.every((task) => task.clientId === demoClient.id && task.type === 'Transactions' && task.priority === 'High')).toBe(true)
    expect(combined.length).toBeLessThan(filterTasks(demoTasks, { clientId: demoClient.id, type: 'Transactions' }).length)
  })

  it('keeps client questions and month-end tracking out of the Bookkeeping Review checks', () => {
    const review = demoTasks.filter(isReviewTask)
    expect(review.some((task) => task.kind === 'client-question' || task.kind === 'month-end-open' || task.kind === 'summary-month-end')).toBe(false)
    expect(review.length).toBeLessThan(demoTasks.length)
  })
})

describe('navigation', () => {
  it('sends every task to a real workflow', () => {
    demoTasks.forEach((task) => expect(validDestinations).toContain(task.destination))
  })

  it('routes each kind of task to the matching workflow', () => {
    const destinationOf = (kind: WorkTask['kind']) => demoTasks.find((task) => task.kind === kind)?.destination
    expect(destinationOf('uncategorized')).toBe('Transactions')
    expect(destinationOf('overdue-invoice')).toBe('Receivables')
    expect(destinationOf('overdue-bill')).toBe('Payables')
    expect(destinationOf('reconciliation-difference')).toBe('Reconcile')
    expect(destinationOf('client-question')).toBe('Client Requests')
    expect(destinationOf('month-end-open')).toBe('Month End')
  })

  it('links client questions to their request and gives every task a unique id', () => {
    demoTasks.filter((task) => task.kind === 'client-question').forEach((task) => expect(task.requestId).toBeTruthy())
    expect(new Set(demoTasks.map((task) => task.id)).size).toBe(demoTasks.length)
  })
})
