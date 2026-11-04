import { describe, expect, it } from 'vitest'
import { computeReconciliation, formatCents, type ReconciliationRecord } from '../../shared/reconciliation'
import { buildReconciliationCsv } from './reconciliationReport'

const record = (patch: Partial<ReconciliationRecord> = {}): ReconciliationRecord => ({
  id: 'demo:abc:35:2026-08-31', source: 'demo', clientId: 'abc', clientName: 'ABC Plumbing', accountId: '35', accountName: 'Checking', accountKind: 'bank',
  periodStart: '2026-08-01', periodEnd: '2026-08-31', statementDate: '2026-08-31', beginningCents: 100000, endingCents: 138000, openingConfirmed: true,
  statementMode: 'csv',
  statementLines: [
    { id: 'l1', date: '2026-08-05', description: 'CUSTOMER', amountCents: 50000, direction: 'increase' },
    { id: 'l2', date: '2026-08-10', description: 'SUPPLIER', amountCents: 12000, direction: 'decrease' },
  ],
  transactions: [
    { id: 'd1', date: '2026-08-05', payee: 'Customer', memo: '', amountCents: 50000, direction: 'increase' },
    { id: 'w1', date: '2026-08-10', payee: 'Supplier', memo: '', amountCents: 12000, direction: 'decrease' },
    { id: 'o1', date: '2026-08-30', payee: 'Late check', memo: '', amountCents: 4000, direction: 'decrease' },
  ],
  clearedIds: ['d1', 'w1'], matches: [{ lineId: 'l1', txnId: 'd1' }, { lineId: 'l2', txnId: 'w1' }],
  completeness: { complete: true, reasons: [] }, status: 'draft', version: 1, history: [], ...patch,
} as unknown as ReconciliationRecord)

const csv = (rec: ReconciliationRecord) => buildReconciliationCsv(rec, { durable: false }, computeReconciliation(rec, { today: '2026-10-01' }))

describe('reconciliation CSV report', () => {
  it('uses the same figures as the screen computation', () => {
    const rec = record()
    const computation = computeReconciliation(rec, { today: '2026-10-01' })
    const text = csv(rec)
    expect(text).toContain(`Cleared balance,${(computation.clearedBalanceCents / 100).toFixed(2)}`)
    expect(text).toContain(`Difference,${(computation.differenceCents / 100).toFixed(2)}`)
    expect(text).toContain(`Adjusted statement balance (verified),${(computation.adjustedBankBalanceCents / 100).toFixed(2)}`)
    expect(formatCents(computation.differenceCents)).toBe('$0.00')
  })

  it('labels outstanding items verified only when the imported statement is fully matched', () => {
    const text = csv(record())
    expect(text).toContain('Verified against the imported statement')
    expect(text).toContain('Outstanding checks and payments (verified),40.00')
    expect(text).not.toContain('(provisional)')
  })

  it('labels outstanding amounts provisional for a manual statement', () => {
    const text = csv(record({ statementMode: 'manual', statementLines: [], matches: [] }))
    expect(text).toContain('Provisional - not yet confirmed against statement lines')
    expect(text).toContain('Outstanding checks and payments (provisional),40.00')
    expect(text).toContain('Adjusted statement balance (provisional)')
  })

  it('includes the checklist and does not say Balanced when a blocker remains with a zero difference', () => {
    const text = csv(record({ completeness: { complete: false, reasons: ['cut off'] } }))
    expect(text).toContain('Completion checklist')
    expect(text).toContain('No remaining blocking issues,Needs attention')
    expect(text).toContain('Difference is zero but completion checks need attention')
    expect(text).not.toMatch(/Balanced - all/)
  })

  it('says Balanced only when every check passes', () => {
    expect(csv(record())).toContain('Balanced - all completion checks passed')
    expect(csv(record({ endingCents: 138001 }))).toContain('Not balanced')
  })
})
