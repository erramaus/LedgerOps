import { describe, expect, it } from 'vitest'
import { demoDataService } from './demoDataService'
import {
  buildFindingRows,
  decisionKey,
  filterFindingRows,
  findingTypeOf,
  explainFinding,
  isAccountingFinding,
  isDismissalCurrent,
  readLegacyReviewDecisionExport,
  sourceFingerprint,
  summarizeFindings,
  type FindingFilters,
  type ReviewDecision,
} from './reviewFindings'
import { buildWorkTasks, scopeRequests, type ClientRecords, type WorkTask } from './workQueue'

const { clients, demoClient, transactions, invoices, bills, reconciliationAccounts, clientRequests, monthEndItems } = demoDataService
const records: ClientRecords = {
  client: { id: demoClient.id, name: demoClient.name }, transactions, invoices, bills, accounts: [],
  reconciliations: reconciliationAccounts, requests: scopeRequests(clientRequests, 'demo'), monthEnd: monthEndItems,
}
const tasks = buildWorkTasks(records, clients.filter((client) => client.id !== demoClient.id))
const findings = tasks.filter(isAccountingFinding)
const source = { transactions, invoices, bills }
const filters: FindingFilters = { client: 'All', type: 'All', priority: 'All', status: 'Active', query: '' }

const decide = (task: WorkTask, status: ReviewDecision['status'], over: Partial<ReviewDecision> = {}): ReviewDecision => ({
  id: `${status}-${task.id}`, source: 'demo', clientId: task.clientId, clientName: task.client, findingId: task.id, findingType: findingTypeOf(task),
  issue: task.issue, description: task.description, priority: task.priority, status, at: '2026-11-02T10:00:00Z', fingerprint: sourceFingerprint(task, source), ...over,
  version: 1,
})

describe('classification', () => {
  it('keeps accounting findings and leaves reminders, requests and month-end in the Inbox', () => {
    const kinds = new Set(findings.map((task) => task.kind))
    for (const kind of ['overdue-invoice', 'overdue-bill', 'partially-paid-invoice', 'partially-paid-bill', 'bill-due-soon', 'large-unpaid-invoice', 'client-question', 'month-end-open', 'missing-recurring'] as const) {
      expect(kinds.has(kind)).toBe(false)
    }
    expect(kinds.has('uncategorized')).toBe(true)
    expect(kinds.has('reconciliation-difference')).toBe(true)
    expect(findings.length).toBeLessThan(tasks.length)
  })

  it('does not hide an invoice or bill that has a genuine accounting problem', () => {
    expect(isAccountingFinding({ kind: 'bill-needs-review' } as WorkTask)).toBe(true)
  })

  it('maps each rule to one finding type', () => {
    const type = (kind: WorkTask['kind']) => findingTypeOf({ kind } as WorkTask)
    expect(type('possible-duplicate')).toBe('duplicate')
    expect(type('uncategorized')).toBe('categorization')
    expect(type('rule-suggestion')).toBe('categorization')
    expect(type('missing-payee')).toBe('missing-info')
    expect(type('needs-receipt')).toBe('missing-info')
    expect(type('large-transaction')).toBe('unusual-amount')
    expect(type('reconciliation-difference')).toBe('inconsistency')
  })

  it('explains heuristic findings as possible issues', () => {
    const duplicate = { ...findings[0], kind: 'possible-duplicate' as const, suspected: true }
    const explanation = explainFinding(duplicate)
    expect(explanation.why).toMatch(/^Possible issue, not a confirmed error/)
    expect(explanation.detected).toBe(duplicate.description)
    expect(explanation.next).toBe(duplicate.action)
  })
})

describe('summary counts', () => {
  it('are calculated from the actual findings', () => {
    const summary = summarizeFindings(findings)
    const sum = (kind: string[]) => findings.filter((task) => kind.includes(task.kind)).reduce((total, task) => total + task.count, 0)
    expect(summary.total).toBe(findings.reduce((total, task) => total + task.count, 0))
    expect(summary.duplicates).toBe(sum(['possible-duplicate']))
    expect(summary.categorization).toBe(sum(['uncategorized', 'rule-suggestion']))
    expect(summary.missingInfo).toBe(sum(['missing-payee', 'needs-receipt']))
    expect(summarizeFindings([])).toEqual({ total: 0, duplicates: 0, categorization: 0, missingInfo: 0 })
  })
})

describe('decisions', () => {
  const first = findings.find((task) => task.kind === 'uncategorized')!

  it('hides a dismissal only while the source record is unchanged', () => {
    const decision = decide(first, 'dismissed', { reason: 'Verified' })
    expect(isDismissalCurrent(decision, sourceFingerprint(first, source))).toBe(true)
    const changed = { ...source, transactions: transactions.map((item) => (item.id === first.recordId ? { ...item, category: 'Office Supplies', status: 'Categorized' as const } : item)), invoices, bills }
    expect(sourceFingerprint(first, changed)).not.toBe(sourceFingerprint(first, source))
    expect(isDismissalCurrent(decision, sourceFingerprint(first, changed))).toBe(false)
    expect(isDismissalCurrent(decide(first, 'reopened'), sourceFingerprint(first, source))).toBe(false)
  })

  it('a new matching transaction changes a duplicate finding fingerprint', () => {
    const base = { ...transactions[0], id: 'dup-a', payee: 'Same Vendor', amount: '$50.00' }
    const copy = { ...base, id: 'dup-b' }
    const duplicate = { ...first, kind: 'possible-duplicate' as const, recordId: 'dup-b' }
    const two = { transactions: [base, copy], invoices: [], bills: [] }
    const three = { transactions: [base, copy, { ...base, id: 'dup-c' }], invoices: [], bills: [] }
    expect(sourceFingerprint(duplicate, three)).not.toBe(sourceFingerprint(duplicate, two))
  })
  it('builds Open, Under review, Dismissed and Resolved rows', () => {
    const [a, b, c] = findings.filter((task) => task.recordId)
    const gone = { ...c, id: `${c.id}-gone` }
    const rows = buildFindingRows({
      source: 'demo', live: [a, b], dismissed: [c],
      decisions: [decide(a, 'reviewing'), decide(c, 'dismissed', { reason: 'ok' }), decide(gone, 'reviewing')],
      records: source, detailClientId: demoClient.id,
    })
    const status = (id: string) => rows.find((row) => row.task.id === id)?.status
    expect(status(a.id)).toBe('Under review')
    expect(status(b.id)).toBe('Open')
    expect(status(c.id)).toBe('Dismissed')
    expect(status(gone.id)).toBe('Resolved')
  })

  it('marks a dismissed finding that came back because its record changed', () => {
    const decision = decide(first, 'dismissed', { reason: 'ok', fingerprint: 'old' })
    const rows = buildFindingRows({ source: 'demo', live: [first], dismissed: [], decisions: [decision], records: source, detailClientId: demoClient.id })
    expect(rows[0]).toMatchObject({ status: 'Open', changedSinceDismissed: true })
  })

  it('keeps Demo and QuickBooks decisions separate', () => {
    expect(decisionKey('demo', demoClient.id, 'x')).not.toBe(decisionKey('quickbooks', demoClient.id, 'x'))
    expect(decisionKey('demo', demoClient.id, 'x')).not.toBe(decisionKey('demo', 'another-client', 'x'))
    const rows = buildFindingRows({ source: 'quickbooks', live: [first], dismissed: [], decisions: [decide(first, 'dismissed', { reason: 'ok' })], records: source, detailClientId: 'quickbooks-sandbox' })
    expect(rows[0].status).toBe('Open')
  })

  it('does not report another client\'s past review as resolved', () => {
    const rows = buildFindingRows({ source: 'demo', live: [], dismissed: [], decisions: [decide({ ...first, id: 'other/1', clientId: 'other' }, 'reviewing')], records: source, detailClientId: demoClient.id })
    expect(rows).toHaveLength(0)
  })
})

describe('filters', () => {
  const rows = buildFindingRows({ source: 'demo', live: findings, dismissed: [], decisions: [], records: source, detailClientId: demoClient.id })
  it('combines type, priority, client and search', () => {
    expect(filterFindingRows(rows, { ...filters, type: 'duplicate' }).every((row) => row.task.kind === 'possible-duplicate')).toBe(true)
    expect(filterFindingRows(rows, { ...filters, priority: 'High' }).every((row) => row.task.priority === 'High')).toBe(true)
    expect(filterFindingRows(rows, { ...filters, client: 'nobody' })).toHaveLength(0)
    const amazon = filterFindingRows(rows, { ...filters, query: 'amazon' })
    expect(amazon.length).toBeGreaterThan(0)
    expect(amazon.every((row) => /amazon/i.test(`${row.task.description} ${row.task.issue}`))).toBe(true)
    expect(filterFindingRows(rows, { ...filters, type: 'duplicate', query: 'zzzz' })).toHaveLength(0)
  })
})

describe('decision storage', () => {
  it('preserves the legacy browser record for explicit export without changing it', () => {
    let value = JSON.stringify([decide(findings[0], 'dismissed', { reason: 'Checked' })])
    const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next } }
    expect(readLegacyReviewDecisionExport(storage)).toBe(value)
    expect(value).toContain('Checked')
  })
})
