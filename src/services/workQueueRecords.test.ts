import { describe, expect, it } from 'vitest'
import { demoDataService } from './demoDataService'
import { buildReviewTasks } from './workQueue'

const { demoClient, transactions, invoices, bills } = demoDataService
const records = { client: { id: demoClient.id, name: demoClient.name }, transactions, invoices, bills, accounts: [], reconciliations: [], requests: [], monthEnd: [] }

describe('review tasks name the record they are about', () => {
  const tasks = buildReviewTasks(records)

  it('a transaction task carries that transaction so it can be opened directly', () => {
    const amazon = tasks.find((task) => task.kind === 'uncategorized' && task.description.startsWith('Amazon'))!
    expect(amazon.recordId).toBe('txn-001')
    expect(transactions.some((transaction) => transaction.id === amazon.recordId)).toBe(true)
  })

  it('invoice and bill tasks carry their own record, matching the destination page', () => {
    const invoice = tasks.find((task) => task.kind === 'overdue-invoice')!
    expect(invoice.destination).toBe('Receivables')
    expect(invoices.some((item) => item.id === invoice.recordId)).toBe(true)
    const bill = tasks.find((task) => task.kind === 'overdue-bill')!
    expect(bills.some((item) => item.id === bill.recordId)).toBe(true)
  })

  it('every task that names a record names one that exists, and only for the pages that can open it', () => {
    const known = new Set([...transactions, ...invoices, ...bills].map((record) => record.id))
    for (const task of tasks.filter((item) => item.recordId)) {
      expect(known.has(task.recordId!)).toBe(true)
      expect(['Transactions', 'Receivables', 'Payables']).toContain(task.destination)
    }
    expect(tasks.filter((task) => task.destination === 'Reconcile').every((task) => task.recordId === undefined)).toBe(true)
  })

  it('a record id that is a prefix of another does not capture the other record\'s tasks', () => {
    const similar = [{ ...transactions[0], id: 'txn-1' }, { ...transactions[0], id: 'txn-10', payee: 'Other Payee' }]
    const result = buildReviewTasks({ ...records, transactions: similar, invoices: [], bills: [] })
    for (const task of result) expect(task.id.endsWith(`/${task.recordId}-category`) || task.id.includes(`/${task.recordId}-`)).toBe(true)
    expect(result.find((task) => task.description.startsWith('Other Payee'))?.recordId).toBe('txn-10')
  })
})
