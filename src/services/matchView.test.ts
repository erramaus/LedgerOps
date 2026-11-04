import { describe, expect, it } from 'vitest'
import { computeReconciliation, suggestMatches, type ReconciliationRecord, type ReconTxn, type StatementLine } from '../../shared/reconciliation'
import { acceptMatch, classifyTxn, matchEvidence, unmatchedSummary, validateManualMatch, planBulkClear } from './matchView'

const txn = (patch: Partial<ReconTxn> & { id: string }): ReconTxn => ({ date: '2026-08-10', payee: 'Home Depot', memo: '', amountCents: 5000, direction: 'decrease', ...patch })
const line = (patch: Partial<StatementLine> & { id: string }): StatementLine => ({ date: '2026-08-11', description: 'HOME DEPOT #123', amountCents: 5000, direction: 'decrease', ...patch })

describe('transaction state', () => {
  it('does not call an uncleared item a confirmed outstanding item', () => {
    expect(classifyTxn({ cleared: false, flagged: false, suggested: false, csv: true })).toBe('Uncleared / potentially outstanding')
    expect(classifyTxn({ cleared: false, flagged: false, suggested: false, csv: false })).toBe('Not yet reviewed')
    expect(classifyTxn({ cleared: false, flagged: false, suggested: true, csv: true })).toBe('Not yet reviewed')
  })
  it('flags investigations ahead of other uncleared states and keeps cleared items cleared', () => {
    expect(classifyTxn({ cleared: false, flagged: true, suggested: true, csv: true })).toBe('Needs investigation')
    expect(classifyTxn({ cleared: true, flagged: true, suggested: false, csv: true })).toBe('Matched and cleared')
  })
})

describe('match evidence', () => {
  it('lists amount, date and payee evidence', () => {
    const evidence = matchEvidence(txn({ id: 't' }), line({ id: 'l' }))
    expect(evidence).toEqual(['Amount $50.00 is the same', 'Dates are 1 day apart (books 2026-08-10, statement 2026-08-11)', 'Description shares "home depot" with the payee'])
  })
  it('reports differences instead of hiding them', () => {
    const evidence = matchEvidence(txn({ id: 't', date: '2026-08-11' }), line({ id: 'l', amountCents: 5100, description: 'ZZZ' }))
    expect(evidence[0]).toContain('Amount differs')
    expect(evidence[1]).toBe('Same date (2026-08-11)')
    expect(evidence).toHaveLength(2)
  })
})

describe('acceptMatch (one statement line, one book entry)', () => {
  it('clears and pairs the transaction', () => {
    expect(acceptMatch({ clearedIds: [], matches: [] }, 't1', 'l1')).toEqual({ clearedIds: ['t1'], matches: [{ lineId: 'l1', txnId: 't1' }] })
  })
  it('refuses a line already used by another transaction', () => {
    expect(acceptMatch({ clearedIds: ['t1'], matches: [{ lineId: 'l1', txnId: 't1' }] }, 't2', 'l1')).toBeNull()
  })
  it('re-accepting the same pair is harmless', () => {
    const state = { clearedIds: ['t1'], matches: [{ lineId: 'l1', txnId: 't1' }] }
    expect(acceptMatch(state, 't1', 'l1')).toEqual(state)
  })
  it('suggestions never pair one statement line with two transactions', () => {
    const suggestions = suggestMatches([line({ id: 'l1' })], [txn({ id: 't1' }), txn({ id: 't2' })])
    expect(suggestions).toHaveLength(1)
  })
})

describe('unmatched statement lines and difference', () => {
  const lines = [line({ id: 'l1' }), line({ id: 'l2', amountCents: 900 }), line({ id: 'l3', amountCents: 700 })]
  it('counts only lines that are not matched', () => {
    const summary = unmatchedSummary(lines, [{ lineId: 'l1', txnId: 't1' }])
    expect(summary.total).toBe(3)
    expect(summary.matched).toBe(1)
    expect(summary.unmatched.map((item) => item.id)).toEqual(['l2', 'l3'])
  })
  it('difference moves with each cleared transaction, in integer cents', () => {
    const base = {
      beginningCents: 10000, endingCents: 5000, statementMode: 'manual', statementLines: [], matches: [], openingConfirmed: true,
      transactions: [txn({ id: 't1' }), txn({ id: 't2', amountCents: 4999 })], periodStart: '2026-08-01', periodEnd: '2026-08-31', statementDate: '2026-08-31', accountKind: 'bank',
      completeness: { complete: true, reasons: [] },
    } as unknown as ReconciliationRecord
    const none = computeReconciliation({ ...base, clearedIds: [] }, undefined)
    const one = computeReconciliation({ ...base, clearedIds: ['t1'] }, undefined)
    const both = computeReconciliation({ ...base, clearedIds: ['t1', 't2'] }, undefined)
    expect(Math.abs(none.differenceCents - one.differenceCents)).toBe(5000)
    expect(Math.abs(one.differenceCents - both.differenceCents)).toBe(4999)
    expect(both.clearedBalanceCents).toBe(10000 - 5000 - 4999)
  })
})

describe('manual match validation', () => {
  it('accepts an exact amount in the same direction', () => {
    expect(validateManualMatch(txn({ id: 't1' }), line({ id: 'l1' }), [])).toBeNull()
  })
  it('rejects a different amount with an explanation', () => {
    expect(validateManualMatch(txn({ id: 't1' }), line({ id: 'l1', amountCents: 5100 }), [])).toMatch(/Amounts disagree.*\$50\.00.*\$51\.00/)
  })
  it('rejects the opposite direction even when amounts are equal', () => {
    expect(validateManualMatch(txn({ id: 't1' }), line({ id: 'l1', direction: 'increase' }), [])).toMatch(/Direction disagrees/)
  })
  it('rejects a statement item already matched to another transaction', () => {
    expect(validateManualMatch(txn({ id: 't2' }), line({ id: 'l1' }), [{ lineId: 'l1', txnId: 't1' }])).toMatch(/already matched/)
  })
})

describe('bulk clear planning', () => {
  const shown = [txn({ id: 't1' }), txn({ id: 't2' }), txn({ id: 't3' })]
  it('clears only items with an unclaimed suggestion and leaves the rest', () => {
    const plan = planBulkClear(shown, [], [], [{ txnId: 't1', lineId: 'l1' }])
    expect(plan).toEqual({ clear: ['t1'], skipped: ['t2', 't3'] })
  })
  it('does not reuse a line claimed by an existing match', () => {
    const plan = planBulkClear(shown, ['t3'], [{ lineId: 'l1', txnId: 't3' }], [{ txnId: 't1', lineId: 'l1' }])
    expect(plan.clear).toEqual([])
    expect(plan.skipped).toEqual(['t1', 't2'])
  })
  it('skips items that are already cleared and matched', () => {
    expect(planBulkClear([shown[0]], ['t1'], [{ lineId: 'l1', txnId: 't1' }], [])).toEqual({ clear: [], skipped: [] })
  })
})
