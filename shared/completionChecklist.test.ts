import { describe, expect, it } from 'vitest'
import { completionChecklist, outstandingBasis } from './completionChecklist'
import { computeReconciliation, validateCompletion, type CalcInput, type ReconTxn, type StatementLine } from './reconciliation'

const txn = (id: string, date: string, payee: string, dollars: number, direction: ReconTxn['direction']): ReconTxn => ({ id, date, payee, memo: '', amountCents: Math.round(dollars * 100), direction })
const line = (id: string, date: string, description: string, dollars: number, direction: StatementLine['direction']): StatementLine => ({ id, date, description, amountCents: Math.round(dollars * 100), direction })

const base = (overrides: Partial<CalcInput> = {}): CalcInput => ({
  accountKind: 'bank', periodStart: '2026-08-01', periodEnd: '2026-08-31', statementDate: '2026-08-31',
  beginningCents: 100000, endingCents: 138000, openingConfirmed: true, statementMode: 'manual',
  statementLines: [], clearedIds: ['d1', 'w1'], matches: [], completeness: { complete: true, reasons: [] },
  transactions: [txn('d1', '2026-08-05', 'Customer', 500, 'increase'), txn('w1', '2026-08-10', 'Supplier', 120, 'decrease')],
  ...overrides,
})
const csv = (overrides: Partial<CalcInput> = {}) => base({
  statementMode: 'csv',
  statementLines: [line('l1', '2026-08-05', 'CUSTOMER', 500, 'increase'), line('l2', '2026-08-10', 'SUPPLIER', 120, 'decrease')],
  matches: [{ lineId: 'l1', txnId: 'd1' }, { lineId: 'l2', txnId: 'w1' }], ...overrides,
})
const check = (rec: CalcInput) => completionChecklist(rec, computeReconciliation(rec, { today: '2026-10-01' }))
const status = (rec: CalcInput, id: string) => check(rec).find((item) => item.id === id)!

describe('completion checklist', () => {
  it('passes every item for a valid imported-statement reconciliation', () => {
    expect(check(csv()).map((item) => item.status)).toEqual(Array(7).fill('passed'))
  })

  it('marks statement-detail items unavailable, not passed, for a manual statement', () => {
    const items = check(base())
    expect(items.filter((item) => item.status === 'unavailable').map((item) => item.id)).toEqual(['coverage', 'matches', 'discrepancies'])
    expect(items.find((item) => item.id === 'coverage')!.reason).toMatch(/manually/)
    expect(items.find((item) => item.id === 'blocking')!.status).toBe('passed')
  })

  it('flags an unconfirmed opening balance', () => {
    expect(status(base({ openingConfirmed: false }), 'opening').status).toBe('attention')
  })

  it('flags invalid dates', () => {
    expect(status(base({ periodStart: '2026-09-02' }), 'statement').status).toBe('attention')
  })

  it('flags a non-zero difference with its amount', () => {
    const item = status(base({ endingCents: 138001 }), 'difference')
    expect(item.status).toBe('attention')
    expect(item.reason).toMatch(/\$0\.01/)
  })

  it('does not pass overall when the difference is zero but another blocker remains', () => {
    const rec = base({ completeness: { complete: false, reasons: ['cut off'] } })
    expect(computeReconciliation(rec, { today: '2026-10-01' }).differenceCents).toBe(0)
    expect(status(rec, 'difference').status).toBe('passed')
    const overall = status(rec, 'blocking')
    expect(overall.status).toBe('attention')
    expect(overall.reason).toMatch(/zero difference alone/)
  })

  it('flags coverage gaps, unmatched lines and discrepancies', () => {
    const gap = csv({ statementLines: [line('l1', '2026-08-05', 'CUSTOMER', 500, 'increase')], matches: [{ lineId: 'l1', txnId: 'd1' }] })
    expect(status(gap, 'coverage').status).toBe('attention')
    expect(status(csv({ matches: [{ lineId: 'l1', txnId: 'd1' }] }), 'matches').status).toBe('attention')
    const wrong = csv({ statementLines: [line('l1', '2026-08-05', 'CUSTOMER', 500, 'decrease'), line('l2', '2026-08-10', 'SUPPLIER', 120, 'decrease')], endingCents: 100000 - 62000 })
    expect(status(wrong, 'discrepancies').status).toBe('attention')
  })

  it('flags duplicate statement matches', () => {
    const rec = csv({ matches: [{ lineId: 'l1', txnId: 'd1' }, { lineId: 'l1', txnId: 'w1' }] })
    expect(status(rec, 'matches').status).toBe('attention')
    expect(status(rec, 'blocking').status).toBe('attention')
  })

  it('agrees exactly with the server completion rule', () => {
    for (const rec of [base(), csv(), base({ endingCents: 1 }), csv({ matches: [] }), base({ openingConfirmed: false })]) {
      const server = validateCompletion({ ...rec, status: 'draft' }, { today: '2026-10-01' })
      expect(check(rec).every((item) => item.status !== 'attention')).toBe(server.ok)
    }
  })
})

describe('outstanding items: provisional versus verified', () => {
  const unclearedCsv = () => csv({
    transactions: [...csv().transactions, txn('o1', '2026-08-30', 'Late check', 40, 'decrease')],
  })
  const basis = (rec: CalcInput) => outstandingBasis(rec, computeReconciliation(rec, { today: '2026-10-01' }))

  it('is provisional for a manual statement', () => {
    expect(basis(base()).basis).toBe('provisional')
  })
  it('is provisional while any check needs attention', () => {
    expect(basis(csv({ matches: [] })).basis).toBe('provisional')
  })
  it('is verified only for a fully matched imported statement that passes every check', () => {
    expect(basis(unclearedCsv()).basis).toBe('verified')
  })
})

describe('adjusted statement balance and signs', () => {
  const outstanding = [txn('o1', '2026-08-30', 'Late check', 40, 'decrease'), txn('o2', '2026-08-31', 'Late deposit', 75, 'increase')]

  it('bank: statement + deposits in transit - outstanding checks equals the book balance', () => {
    const result = computeReconciliation(base({ transactions: [...base().transactions, ...outstanding] }), { today: '2026-10-01' })
    expect(result.differenceCents).toBe(0)
    expect(result.adjustedBankBalanceCents).toBe(138000 + 7500 - 4000)
    expect(result.adjustedBankBalanceCents).toBe(result.bookBalanceCents)
  })

  it('credit card: statement balance owed + new charges - payments not yet posted equals the balance owed in the books', () => {
    const card = { accountKind: 'credit_card' as const, beginningCents: 20000, endingCents: 20000 + 9000 - 5000 }
    const transactions = [txn('c1', '2026-08-05', 'Hardware', 90, 'increase'), txn('p1', '2026-08-10', 'Payment', 50, 'decrease'), txn('c2', '2026-08-30', 'Late charge', 60, 'increase'), txn('p2', '2026-08-31', 'Late payment', 25, 'decrease')]
    const result = computeReconciliation(base({ ...card, transactions, clearedIds: ['c1', 'p1'] }), { today: '2026-10-01' })
    expect(result.differenceCents).toBe(0)
    expect(result.adjustedBankBalanceCents).toBe(card.endingCents + 6000 - 2500)
    expect(result.adjustedBankBalanceCents).toBe(result.bookBalanceCents)
  })

  it('does not report adjusted equal to books when the difference is not zero', () => {
    const result = computeReconciliation(base({ endingCents: 138500 }), { today: '2026-10-01' })
    expect(result.adjustedBankBalanceCents).not.toBe(result.bookBalanceCents)
  })
})
