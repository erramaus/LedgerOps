import { describe, expect, it } from 'vitest'
import { ADDITIONAL_DEMO_CLIENT_IDS, getAdditionalDemoCompany } from '../shared/demoCompanyBooks'
import type { MonthEndRecord } from '../shared/monthEnd'
import { clientMonthEndItems, loadedDemoClientIds, ALL_DEMO_CLIENT_IDS, type ClientMonthEndContext } from './useClientsMonthEnd'
import { companyRequests, companyTransactions } from './services/demoCompanyData'
import type { RecordSummary } from './services/reconciliationService'
import { buildFindingRows } from './services/reviewFindings'
import type { ReviewDecision } from './services/reviewFindings'
import { buildWorkTasks, type ClientRecords } from './services/workQueue'

const AUGUST = { year: 2026, month: 8 }
const TODAY = '2026-10-15'

const contextFor = (id: string): ClientMonthEndContext => {
  const company = getAdditionalDemoCompany(id)!
  const requests = companyRequests(company)
  return { id, name: company.clientName, ledger: company.ledger, transactions: companyTransactions(company), requests }
}

const record = (accountId: string, overrides: Partial<RecordSummary> = {}) =>
  ({ id: `rec-${accountId}`, accountId, status: 'completed', periodEnd: '2026-08-31', version: 1, completedAt: '2026-09-02T10:00:00Z', completedBy: 'Tester', result: { differenceCents: 0 }, history: [], ...overrides }) as unknown as RecordSummary

const accountIds = (id: string, kind: 'bank' | 'credit_card') => getAdditionalDemoCompany(id)!.ledger.reconAccounts!.filter((account) => account.kind === kind).map((account) => account.id)
const stored = (records: RecordSummary[], monthEnd: MonthEndRecord | null = null) => ({ records, record: monthEnd })
const item = (items: ReturnType<typeof clientMonthEndItems>, id: string) => items.find((entry) => entry.id === id)!

describe('month-end tasks for clients that are not selected', () => {
  it.each(ADDITIONAL_DEMO_CLIENT_IDS)('%s: an unreconciled August keeps the bank and card checks open', (id) => {
    const items = clientMonthEndItems(AUGUST, contextFor(id), stored([]), TODAY)
    expect(item(items, 'reconcile-bank').status).not.toBe('Complete')
    expect(item(items, 'reconcile-card').status).not.toBe('Complete')
  })

  it.each(ADDITIONAL_DEMO_CLIENT_IDS)('%s: completed stored reconciliations complete the bank and card checks', (id) => {
    const records = [...accountIds(id, 'bank'), ...accountIds(id, 'credit_card')].map((accountId) => record(accountId))
    const items = clientMonthEndItems(AUGUST, contextFor(id), stored(records), TODAY)
    expect(item(items, 'reconcile-bank').status).toBe('Complete')
    expect(item(items, 'reconcile-card').status).toBe('Complete')
  })

  it('completing one client does not complete another (client isolation)', () => {
    const [first, second] = ADDITIONAL_DEMO_CLIENT_IDS
    const records = [...accountIds(first, 'bank'), ...accountIds(first, 'credit_card')].map((accountId) => record(accountId))
    expect(item(clientMonthEndItems(AUGUST, contextFor(first), stored(records), TODAY), 'reconcile-bank').status).toBe('Complete')
    expect(item(clientMonthEndItems(AUGUST, contextFor(second), stored([]), TODAY), 'reconcile-bank').status).not.toBe('Complete')
  })

  it('a reopened reconciliation restores the outstanding check', () => {
    const id = ADDITIONAL_DEMO_CLIENT_IDS[0]
    const banks = accountIds(id, 'bank')
    const reopened = banks.map((accountId) => record(accountId, { status: 'draft', completedAt: undefined, completedBy: undefined, history: [{ action: 'reopened', at: '2026-09-10T09:00:00Z', reason: 'Fix' }] } as Partial<RecordSummary>))
    const result = item(clientMonthEndItems(AUGUST, contextFor(id), stored(reopened), TODAY), 'reconcile-bank')
    expect(result.status).toBe('Needs Attention')
    expect(result.explanation).toMatch(/still need/)
  })

  it('a reconciliation for a different period does not complete August', () => {
    const id = ADDITIONAL_DEMO_CLIENT_IDS[0]
    const july = accountIds(id, 'bank').map((accountId) => record(accountId, { periodEnd: '2026-07-31' }))
    expect(item(clientMonthEndItems(AUGUST, contextFor(id), stored(july), TODAY), 'reconcile-bank').status).not.toBe('Complete')
  })

  it('a completed reconciliation with a difference is not accepted as complete', () => {
    const id = ADDITIONAL_DEMO_CLIENT_IDS[0]
    const off = accountIds(id, 'bank').map((accountId) => record(accountId, { result: { differenceCents: 500 } } as Partial<RecordSummary>))
    expect(item(clientMonthEndItems(AUGUST, contextFor(id), stored(off), TODAY), 'reconcile-bank').status).not.toBe('Complete')
  })

  it('a period without demo books is not available rather than complete', () => {
    const id = ADDITIONAL_DEMO_CLIENT_IDS[0]
    const items = clientMonthEndItems({ year: 2030, month: 1 }, contextFor(id), stored([]), TODAY)
    expect(items.every((entry) => entry.status === 'Not Available')).toBe(true)
  })

  it('open checks make a month-end task, and finishing them removes it', () => {
    const id = ADDITIONAL_DEMO_CLIENT_IDS[0]
    const context = contextFor(id)
    const base = (monthEnd: ClientRecords['monthEnd']): ClientRecords => ({ client: { id, name: context.name }, transactions: [], invoices: [], bills: [], accounts: [], reconciliations: [], requests: [], monthEnd, today: TODAY })
    const open = buildWorkTasks(base(clientMonthEndItems(AUGUST, context, stored([]), TODAY))).filter((task) => task.kind === 'month-end-open')
    expect(open).toHaveLength(1)
    expect(open[0].clientId).toBe(id)
    const done = clientMonthEndItems(AUGUST, context, stored([...accountIds(id, 'bank'), ...accountIds(id, 'credit_card')].map((accountId) => record(accountId))), TODAY)
    const bankCard = done.filter((entry) => entry.id.startsWith('reconcile-'))
    expect(bankCard.every((entry) => entry.status === 'Complete')).toBe(true)
  })
})

describe('loading every company under All clients', () => {
  it('loads all five demo companies under All clients in Demo Mode only', () => {
    expect(ALL_DEMO_CLIENT_IDS).toHaveLength(5)
    expect(loadedDemoClientIds(undefined, 'demo')).toEqual(ALL_DEMO_CLIENT_IDS)
    expect(loadedDemoClientIds('client-x', 'demo')).toEqual(['client-x'])
    expect(loadedDemoClientIds(undefined, 'quickbooks')).toHaveLength(1)
  })
})

describe('Bookkeeping Review under All clients', () => {
  const decision = (clientId: string, findingId: string, status: ReviewDecision['status']): ReviewDecision => ({
    id: `${clientId}-${findingId}-${status}`, source: 'demo', clientId, clientName: clientId, findingId, findingType: 'Possible duplicate' as ReviewDecision['findingType'],
    issue: 'Possible duplicate', description: 'x', priority: 'High', status, actor: 'Bookkeeper', at: '2026-10-01T00:00:00Z', fingerprint: 'f',
  })
  const empty = { transactions: [], invoices: [], bills: [] }

  it('shows resolved findings for every company, not just ABC Plumbing', () => {
    const decisions = ['demo-abc', ...ADDITIONAL_DEMO_CLIENT_IDS].map((id) => decision(id, `${id}-finding`, 'reviewing'))
    const rows = buildFindingRows({ source: 'demo', live: [], dismissed: [], decisions, records: empty, detailClientId: null })
    expect(rows.filter((row) => row.status === 'Resolved')).toHaveLength(5)
  })

  it('limits resolved findings to the selected client', () => {
    const decisions = ['demo-abc', ...ADDITIONAL_DEMO_CLIENT_IDS].map((id) => decision(id, `${id}-finding`, 'reviewing'))
    const one = ADDITIONAL_DEMO_CLIENT_IDS[1]
    const rows = buildFindingRows({ source: 'demo', live: [], dismissed: [], decisions, records: empty, detailClientId: one })
    expect(rows.map((row) => row.task.clientId)).toEqual([one])
  })

  it('never resolves a dismissal, a different source, or a finding that still triggers', () => {
    const id = ADDITIONAL_DEMO_CLIENT_IDS[0]
    const decisions = [decision(id, 'a', 'dismissed'), { ...decision(id, 'b', 'reviewing'), source: 'quickbooks' as const }]
    expect(buildFindingRows({ source: 'demo', live: [], dismissed: [], decisions, records: empty, detailClientId: null })).toHaveLength(0)
  })
})
