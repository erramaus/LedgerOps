import { describe, expect, it } from 'vitest'
import { demoDataService } from './demoDataService'
import type { ClientRequest, Transaction } from './bookkeepingTypes'
import { failed, loaded, quickBooksInputs, toMonthEndItems, transactionFacts, type QuickBooksPeriodData } from './monthEndData'
import { buildChecklist } from '../../shared/monthEnd'
import { parseQbReport } from '../../shared/qbReports'

const txn = (id: string, date: string, payee: string, amount: string, over: Partial<Transaction> = {}): Transaction => ({ id, date, payee, description: '', amount, category: 'Materials', status: 'Categorized', ...over })
const request = (over: Partial<ClientRequest>): ClientRequest => ({ id: 'r', client: 'c', requestType: 'Transaction Question', dateCreated: 'August 18, 2026', question: '?', status: 'Waiting for Client', ...over })
const july = { year: 2026, month: 7 }
const august = { year: 2026, month: 8 }

describe('transactionFacts', () => {
  const list = [txn('a', 'Jul 30, 2026', 'Home Depot', '$198.40'), txn('b', 'Aug 28, 2026', 'Home Depot', '$341.22', { category: 'Uncategorized', status: 'Needs Review' }), txn('c', '2026-08-02', '', '$10.00')]

  it('counts only what is dated in the month, understanding both date formats', () => {
    expect(transactionFacts(july, list, []).facts).toMatchObject({ total: 1, uncategorized: 0, missingPayees: 0 })
    expect(transactionFacts(august, list, []).facts).toMatchObject({ total: 2, uncategorized: 1, missingPayees: 1 })
  })

  it('reports transactions with no readable date instead of dropping them', () => {
    expect(transactionFacts(august, [...list, txn('d', 'someday', 'X', '$1.00')], []).undated).toBe(1)
  })

  it('a request is tied to a month by its transaction date, or by payee and amount, never by payee alone', () => {
    const sameAmount = request({ relatedTransaction: 'Home Depot', relatedAmount: '$198.40', dateCreated: 'August 18, 2026' })
    const otherAmount = request({ relatedTransaction: 'Home Depot', relatedAmount: '$1,284.00', dateCreated: 'August 18, 2026' })
    expect(transactionFacts(july, list, [sameAmount]).facts.openClientRequests).toBe(1)
    expect(transactionFacts(july, list, [otherAmount]).facts.openClientRequests).toBe(0)
    expect(transactionFacts(august, list, [otherAmount]).facts.openClientRequests).toBe(1)
    expect(transactionFacts(july, list, [request({ transactionDate: '2026-07-04' })]).facts.openClientRequests).toBe(1)
  })

  it('completed requests never count', () => {
    expect(transactionFacts(august, list, [request({ status: 'Completed' })]).facts.openClientRequests).toBe(0)
  })

  it('works on the real demo data without crashing', () => {
    const { transactions, clientRequests } = demoDataService
    expect(transactionFacts(august, transactions, clientRequests).facts.total).toBeGreaterThan(0)
  })
})

describe('QuickBooks month-end inputs', () => {
  const ok = (rows: { label: string; cells: (number | null)[] }[]) => parseQbReport('trial-balance', 'TB', { Columns: { Column: [{ ColType: 'Account' }, { ColType: 'Money', ColTitle: 'Debit' }, { ColType: 'Money', ColTitle: 'Credit' }] }, Rows: { Row: rows.map((row) => ({ type: 'Data', ColData: [{ value: row.label }, { value: row.cells[0] === null ? '' : String(row.cells[0]! / 100) }, { value: row.cells[1] === null ? '' : String(row.cells[1]! / 100) }] })) } })
  const base = (over: Partial<QuickBooksPeriodData> = {}): QuickBooksPeriodData => ({
    transactions: loaded([]), accounts: loaded([{ quickBooksId: '1', name: 'Checking', accountType: 'Bank', currentBalance: 0, active: true }, { quickBooksId: '2', name: 'Old', accountType: 'Bank', currentBalance: 0, active: false }]),
    profitLoss: failed('no'), balanceSheet: failed('no'), trialBalance: loaded(ok([{ label: 'Checking', cells: [10000, null] }])), receivables: failed('no'), payables: failed('no'), ...over,
  })
  const context = { records: [], signoffs: {}, requests: [] }

  it('lists only active bank accounts, and an unreadable source blocks instead of defaulting to nothing to do', () => {
    const inputs = quickBooksInputs(august, base(), context)
    expect(inputs.bankAccounts.available && inputs.bankAccounts.value.map((account) => account.accountId)).toEqual(['1'])
    const checklist = buildChecklist(quickBooksInputs(august, base({ accounts: failed('QuickBooks has 1001 Account records but only the first 1000 are loaded.') }), context))
    expect(checklist.items.find((item) => item.id === 'reconcile-bank')!.status).toBe('Blocked')
    expect(checklist.items.find((item) => item.id === 'receivables')!.status).toBe('Blocked')
  })

  it('a trial balance that does not add up makes the unusual-balance check unavailable', () => {
    const unbalanced = parseQbReport('trial-balance', 'TB', { Columns: { Column: [{ ColType: 'Account' }, { ColType: 'Money', ColTitle: 'Debit' }, { ColType: 'Money', ColTitle: 'Credit' }] }, Rows: { Row: [{ type: 'Data', ColData: [{ value: 'Checking' }, { value: '100.00' }, { value: '' }] }, { group: 'GrandTotal', Summary: { ColData: [{ value: 'TOTAL' }, { value: '100.00' }, { value: '90.00' }] } }] } })
    const inputs = quickBooksInputs(august, base({ trialBalance: loaded(unbalanced) }), context)
    expect(inputs.unusual.available).toBe(false)
  })

  it('accounts that cannot be classified are disclosed, not silently passed', () => {
    const inputs = quickBooksInputs(august, base({ trialBalance: loaded(ok([{ label: 'Mystery', cells: [500, null] }])) }), context)
    expect(inputs.unusual.available && inputs.unusual.value.findings.join(' ')).toContain('could not be matched')
  })
})

describe('toMonthEndItems', () => {
  it('is empty until a checklist exists, and maps unavailable data to Not Available rather than a problem', () => {
    expect(toMonthEndItems(null)).toEqual([])
    const items = toMonthEndItems(buildChecklist(quickBooksInputs(august, { transactions: failed('x'), accounts: failed('x'), profitLoss: failed('x'), balanceSheet: failed('x'), trialBalance: failed('x'), receivables: failed('x'), payables: failed('x') }, { records: [], signoffs: {}, requests: [] })))
    expect(items).toHaveLength(9)
    expect(items.every((item) => item.status === 'Not Available')).toBe(true)
  })
})
