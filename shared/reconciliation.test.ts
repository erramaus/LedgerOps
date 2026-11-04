import { describe, expect, it } from 'vitest'
import {
  computeReconciliation,
  findAmountDiscrepancies,
  findChangedSincePrevious,
  findDuplicateLines,
  findDuplicateTransactions,
  formatCents,
  isValidIsoDate,
  parseMoneyToCents,
  previousFrom,
  sameTransactions,
  splitEligible,
  suggestMatches,
  validateCompletion,
  type CalcInput,
  type ReconTxn,
  type StatementLine,
} from './reconciliation.js'

const txn = (id: string, date: string, payee: string, dollars: number, direction: ReconTxn['direction'], memo = ''): ReconTxn => ({ id, date, payee, memo, amountCents: Math.round(dollars * 100), direction })
const line = (id: string, date: string, description: string, dollars: number, direction: StatementLine['direction']): StatementLine => ({ id, date, description, amountCents: Math.round(dollars * 100), direction })

const bank = (overrides: Partial<CalcInput> = {}): CalcInput => ({
  accountKind: 'bank', periodStart: '2026-08-01', periodEnd: '2026-08-31', statementDate: '2026-08-31',
  beginningCents: 100000, endingCents: 100000 + 50000 - 12000, openingConfirmed: true, statementMode: 'manual',
  statementLines: [], clearedIds: ['d1', 'w1'], matches: [], completeness: { complete: true, reasons: [] },
  transactions: [txn('d1', '2026-08-05', 'Customer', 500, 'increase'), txn('w1', '2026-08-10', 'Supplier', 120, 'decrease')],
  ...overrides,
})
const codes = (input: CalcInput, options = {}) => computeReconciliation(input, { today: '2026-10-01', ...options }).issues.map((issue) => issue.code)

describe('money and dates', () => {
  it.each([['$1,234.56', 123456], ['(12.30)', -1230], ['-12.3', -1230], ['12', 1200], ['+0.05', 5], ['  $5  ', 500]])('parses %s', (text, cents) => {
    expect(parseMoneyToCents(text)).toBe(cents)
  })
  it.each(['', 'abc', '1.234', '1,23', '12.3.4', '$', '--5', '1e5'])('rejects %j', (text) => {
    expect(parseMoneyToCents(text)).toBeNull()
  })
  it('works in cents, so floating point cannot drift', () => {
    expect(parseMoneyToCents('0.10')! + parseMoneyToCents('0.20')!).toBe(parseMoneyToCents('0.30'))
    expect(formatCents(123456)).toBe('$1,234.56')
  })
  it('validates real calendar dates only', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true)
    expect(isValidIsoDate('2026-02-30')).toBe(false)
    expect(isValidIsoDate('2026-13-01')).toBe(false)
    expect(isValidIsoDate('08/31/2026')).toBe(false)
    expect(isValidIsoDate(20260831)).toBe(false)
  })
})

describe('balances for a bank account', () => {
  it('computes cleared totals, cleared balance and a zero difference from the data', () => {
    const result = computeReconciliation(bank())
    expect(result.clearedIncreaseCents).toBe(50000)
    expect(result.clearedDecreaseCents).toBe(12000)
    expect(result.clearedBalanceCents).toBe(138000)
    expect(result.differenceCents).toBe(0)
    expect(result.cleared).toHaveLength(2)
  })

  it('reports the difference against the statement ending balance', () => {
    expect(computeReconciliation(bank({ endingCents: 140000 })).differenceCents).toBe(2000)
    expect(computeReconciliation(bank({ endingCents: 130000 })).differenceCents).toBe(-8000)
  })

  it('treats uncleared items as deposits in transit and outstanding payments', () => {
    const result = computeReconciliation(bank({
      transactions: [txn('d1', '2026-08-05', 'Customer', 500, 'increase'), txn('w1', '2026-08-10', 'Supplier', 120, 'decrease'), txn('d2', '2026-08-31', 'Late deposit', 300, 'increase'), txn('c1', '2026-08-29', 'Check 1001', 75.5, 'decrease')],
    }))
    expect(result.outstandingIncrease.map((item) => item.id)).toEqual(['d2'])
    expect(result.outstandingDecrease.map((item) => item.id)).toEqual(['c1'])
    expect(result.outstandingIncreaseCents).toBe(30000)
    expect(result.outstandingDecreaseCents).toBe(7550)
    expect(result.adjustedBankBalanceCents).toBe(138000 + 30000 - 7550)
    expect(result.differenceCents).toBe(0)
  })

  it('keeps the adjusted bank balance and the book balance consistent with the difference', () => {
    for (const ending of [138000, 140000, 120500]) {
      const input = bank({
        endingCents: ending,
        transactions: [txn('d1', '2026-08-05', 'Customer', 500, 'increase'), txn('w1', '2026-08-10', 'Supplier', 120, 'decrease'), txn('d2', '2026-08-31', 'Late', 300, 'increase'), txn('c1', '2026-08-29', 'Check', 75.5, 'decrease')],
      })
      const result = computeReconciliation(input)
      expect(result.adjustedBankBalanceCents - result.bookBalanceCents).toBe(result.differenceCents)
    }
  })

  it('has nothing hardcoded: changing one cleared item changes the result', () => {
    const before = computeReconciliation(bank()).clearedBalanceCents
    const after = computeReconciliation(bank({ clearedIds: ['d1'] })).clearedBalanceCents
    expect(before - after).toBe(-12000)
  })
})

describe('credit card accounts', () => {
  const card = (overrides: Partial<CalcInput> = {}): CalcInput => ({
    ...bank(), accountKind: 'credit_card', beginningCents: 500000, endingCents: 500000 + 30000 + 2500 - 10000,
    clearedIds: ['c1', 'c2', 'p1'],
    transactions: [txn('c1', '2026-08-03', 'Fuel', 300, 'increase'), txn('c2', '2026-08-12', 'Office', 25, 'increase'), txn('p1', '2026-08-20', 'Payment, thank you', 100, 'decrease')],
    ...overrides,
  })

  it('adds charges to the amount owed and subtracts payments', () => {
    const result = computeReconciliation(card())
    expect(result.clearedBalanceCents).toBe(522500)
    expect(result.differenceCents).toBe(0)
  })

  it('does not treat a charge as reducing the balance', () => {
    const wrongWay = computeReconciliation(card({ endingCents: 500000 - 30000 - 2500 + 10000 }))
    expect(wrongWay.differenceCents).not.toBe(0)
  })

  it('labels outstanding items for a card, not as checks or deposits', () => {
    const result = computeReconciliation(card({ clearedIds: ['c1', 'p1'], endingCents: 500000 + 30000 - 10000 }))
    expect(result.outstandingIncrease.map((item) => item.id)).toEqual(['c2'])
    expect(result.adjustedBankBalanceCents).toBe(500000 + 30000 - 10000 + 2500)
  })

  it('explains a difference in terms of the amount owed', () => {
    const result = computeReconciliation(card({ endingCents: 522500 + 22420 }))
    expect(result.explanations[0]).toMatch(/higher than your cleared transactions \(amount owed\)/)
  })
})

describe('matching statement lines to transactions', () => {
  const books = [txn('t1', '2026-08-05', 'Home Depot', 224.2, 'increase'), txn('t2', '2026-08-06', 'Adobe', 59.99, 'increase'), txn('t3', '2026-08-07', 'Adobe', 59.99, 'increase')]

  it('suggests one-to-one matches on amount, direction and nearby dates', () => {
    const matches = suggestMatches([line('l1', '2026-08-06', 'ADOBE SYSTEMS', 59.99, 'increase'), line('l2', '2026-08-05', 'HOME DEPOT #123', 224.2, 'increase')], books)
    expect(matches).toHaveLength(2)
    expect(new Set(matches.map((match) => match.txnId)).size).toBe(2)
    expect(matches.find((match) => match.lineId === 'l2')!.txnId).toBe('t1')
    expect(matches.find((match) => match.lineId === 'l1')!.reasons).toContain('Same amount')
  })

  it('never matches the same transaction to two lines', () => {
    const matches = suggestMatches([line('l1', '2026-08-06', 'Adobe', 59.99, 'increase'), line('l2', '2026-08-07', 'Adobe', 59.99, 'increase'), line('l3', '2026-08-06', 'Adobe', 59.99, 'increase')], books)
    expect(matches.filter((match) => match.txnId === 't2')).toHaveLength(1)
    expect(matches).toHaveLength(2)
  })

  it('does not match a different direction, amount or a far-away date', () => {
    expect(suggestMatches([line('l', '2026-08-05', 'Home Depot', 224.2, 'decrease')], books)).toEqual([])
    expect(suggestMatches([line('l', '2026-08-05', 'Home Depot', 224.21, 'increase')], books)).toEqual([])
    expect(suggestMatches([line('l', '2026-08-25', 'Home Depot', 224.2, 'increase')], books)).toEqual([])
  })

  it('flags a near match whose amount differs', () => {
    const near = findAmountDiscrepancies([line('l1', '2026-08-05', 'HOME DEPOT', 242.2, 'increase')], books)
    expect(near).toEqual([{ lineId: 'l1', txnId: 't1', statementCents: 24220, bookCents: 22420 }])
  })
})

describe('duplicates', () => {
  it('flags the same payee, amount and direction close together', () => {
    const groups = findDuplicateTransactions([txn('a', '2026-08-01', 'Shell', 40, 'decrease'), txn('b', '2026-08-03', 'SHELL', 40, 'decrease'), txn('c', '2026-08-04', 'Shell', 41, 'decrease')])
    expect(groups).toHaveLength(1)
    expect(groups[0].map((item) => item.id)).toEqual(['a', 'b'])
  })
  it('does not flag repeats far apart or in opposite directions', () => {
    expect(findDuplicateTransactions([txn('a', '2026-08-01', 'Shell', 40, 'decrease'), txn('b', '2026-08-20', 'Shell', 40, 'decrease')])).toEqual([])
    expect(findDuplicateTransactions([txn('a', '2026-08-01', 'Shell', 40, 'decrease'), txn('b', '2026-08-02', 'Shell', 40, 'increase')])).toEqual([])
  })
  it('flags identical statement lines', () => {
    const groups = findDuplicateLines([line('1', '2026-08-01', 'Coffee', 4, 'decrease'), line('2', '2026-08-01', 'coffee', 4, 'decrease'), line('3', '2026-08-02', 'Coffee', 4, 'decrease')])
    expect(groups).toHaveLength(1)
  })
  it('reports duplicates as warnings, not blocking errors', () => {
    const result = computeReconciliation(bank({ transactions: [...bank().transactions, txn('d9', '2026-08-06', 'Customer', 500, 'increase')] }))
    const duplicate = result.issues.find((issue) => issue.code === 'possible_duplicate')!
    expect(duplicate.severity).toBe('warning')
    expect(duplicate.message).toMatch(/suggestions to check, not confirmed errors/)
  })
})

describe('statement detail, missing transactions and discrepancies', () => {
  const csvInput = (overrides: Partial<CalcInput> = {}): CalcInput => bank({
    statementMode: 'csv', beginningCents: 100000, endingCents: 100000 + 50000 - 12000,
    statementLines: [line('l1', '2026-08-05', 'CUSTOMER PAYMENT', 500, 'increase'), line('l2', '2026-08-10', 'SUPPLIER', 120, 'decrease')],
    matches: [{ lineId: 'l1', txnId: 'd1' }, { lineId: 'l2', txnId: 'w1' }],
    ...overrides,
  })

  it('is complete when every line is matched, balances and covers the period', () => {
    const result = validateCompletion({ ...csvInput(), status: 'draft' }, { today: '2026-10-01' })
    expect(result.blocking).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('identifies a statement line missing from the books and says it equals the difference', () => {
    const input = csvInput({ endingCents: 100000 + 50000 - 12000 + 22420, statementLines: [...csvInput().statementLines, line('l3', '2026-08-15', 'HOME DEPOT', 224.2, 'increase')] })
    const result = computeReconciliation(input, { today: '2026-10-01' })
    expect(result.unmatchedLines.map((item) => item.id)).toEqual(['l3'])
    expect(result.differenceCents).toBe(22420)
    expect(result.explanations.join(' ')).toMatch(/HOME DEPOT.*equals the whole difference.*missing from QuickBooks/)
    expect(result.canComplete).toBe(false)
  })

  it('flags a matched pair whose amounts differ', () => {
    const input = csvInput({ statementLines: [line('l1', '2026-08-05', 'CUSTOMER PAYMENT', 510, 'increase'), line('l2', '2026-08-10', 'SUPPLIER', 120, 'decrease')], endingCents: 100000 + 51000 - 12000 })
    expect(codes(input)).toContain('amount_discrepancy')
  })

  it('blocks a match whose direction is opposite, even when the amounts are equal', () => {
    const input = csvInput({ statementLines: [line('l1', '2026-08-05', 'CUSTOMER PAYMENT', 500, 'decrease'), line('l2', '2026-08-10', 'SUPPLIER', 120, 'decrease')], endingCents: 100000 - 50000 - 12000 })
    const result = computeReconciliation(input, { today: '2026-10-01' })
    expect(result.issues.map((issue) => issue.code)).toContain('amount_discrepancy')
    expect(result.canComplete).toBe(false)
  })

  it('blocks one statement line assigned to two book transactions', () => {
    const input = csvInput({
      transactions: [txn('d1', '2026-08-05', 'Customer', 500, 'increase'), txn('d2', '2026-08-05', 'Customer', 500, 'increase'), txn('w1', '2026-08-10', 'Supplier', 120, 'decrease')],
      clearedIds: ['d1', 'd2', 'w1'], matches: [{ lineId: 'l1', txnId: 'd1' }, { lineId: 'l1', txnId: 'd2' }, { lineId: 'l2', txnId: 'w1' }],
      endingCents: 100000 + 100000 - 12000,
    })
    const result = computeReconciliation(input, { today: '2026-10-01' })
    expect(result.issues.map((issue) => issue.code)).toContain('statement_line_reused')
    expect(result.canComplete).toBe(false)
  })

  it('blocks one book transaction matched to two statement lines', () => {
    const input = csvInput({
      statementLines: [line('l1', '2026-08-05', 'CUSTOMER PAYMENT', 500, 'increase'), line('l3', '2026-08-05', 'CUSTOMER PAYMENT', 500, 'increase'), line('l2', '2026-08-10', 'SUPPLIER', 120, 'decrease')],
      matches: [{ lineId: 'l1', txnId: 'd1' }, { lineId: 'l3', txnId: 'd1' }, { lineId: 'l2', txnId: 'w1' }], endingCents: 100000 + 100000 - 12000,
    })
    expect(codes(input)).toContain('transaction_matched_twice')
  })

  it('does not report either problem for a valid one-to-one matching', () => {
    expect(codes(csvInput())).not.toContain('statement_line_reused')
    expect(codes(csvInput())).not.toContain('transaction_matched_twice')
  })

  it('points out an uncleared near-match with a different amount', () => {
    const input = csvInput({
      clearedIds: ['w1'], matches: [{ lineId: 'l2', txnId: 'w1' }], statementLines: [line('l1', '2026-08-05', 'CUSTOMER PAYMENT', 550, 'increase'), line('l2', '2026-08-10', 'SUPPLIER', 120, 'decrease')],
      endingCents: 100000 + 55000 - 12000,
    })
    const result = computeReconciliation(input)
    expect(result.nearMatches).toHaveLength(1)
    expect(result.explanations.join(' ')).toMatch(/amounts differ by \$50\.00/)
  })

  it('requires cleared transactions to appear on an imported statement', () => {
    const input = csvInput({ matches: [{ lineId: 'l1', txnId: 'd1' }], statementLines: [line('l1', '2026-08-05', 'CUSTOMER PAYMENT', 500, 'increase')], endingCents: 100000 + 50000 - 12000 })
    expect(codes(input)).toEqual(expect.arrayContaining(['cleared_without_line', 'statement_coverage']))
  })

  it('detects statement lines that do not account for the balance change', () => {
    const result = computeReconciliation(csvInput({ statementLines: [line('l1', '2026-08-05', 'CUSTOMER PAYMENT', 500, 'increase')], matches: [{ lineId: 'l1', txnId: 'd1' }], clearedIds: ['d1'], endingCents: 100000 + 50000 - 12000 }))
    expect(result.issues.find((issue) => issue.code === 'statement_coverage')!.message).toMatch(/\$120\.00 unexplained|\$-120\.00|unexplained/)
  })

  it('flags statement lines outside the period and an empty import', () => {
    expect(codes(csvInput({ statementLines: [...csvInput().statementLines, line('l9', '2026-09-02', 'Late', 1, 'increase')] }))).toContain('statement_out_of_period')
    expect(codes(csvInput({ statementLines: [], matches: [] }))).toContain('statement_empty')
  })

  it('does not require statement lines in manual mode', () => {
    expect(codes(bank())).toEqual([])
  })

  it('ignores stale matches to items that are no longer cleared', () => {
    const result = computeReconciliation(csvInput({ clearedIds: ['w1'], matches: [{ lineId: 'l1', txnId: 'd1' }, { lineId: 'l2', txnId: 'w1' }] }))
    expect(result.unmatchedLines.map((item) => item.id)).toContain('l1')
  })
})

describe('explaining a difference', () => {
  it('names an uncleared transaction that equals the difference', () => {
    const input = bank({ clearedIds: ['d1'], endingCents: 100000 + 50000 - 12000 })
    const text = computeReconciliation(input).explanations.join(' ')
    expect(text).toMatch(/Supplier.*not cleared but equals the difference/)
  })
  it('names a cleared transaction that equals the difference in the other direction', () => {
    const text = computeReconciliation(bank({ endingCents: 138000 - 50000 })).explanations.join(' ')
    expect(text).toMatch(/Customer.*cleared but equals the difference in the opposite direction/)
  })
  it('suggests a direction error when twice an amount equals the difference', () => {
    const text = computeReconciliation(bank({ endingCents: 100000 + 50000 + 12000 })).explanations.join(' ')
    expect(text).toMatch(/twice its amount equals the difference/)
  })
  it('mentions transposed digits when divisible by nine', () => {
    expect(computeReconciliation(bank({ endingCents: 138000 + 2700 })).explanations.join(' ')).toMatch(/divisible by 9/)
  })
  it('says nothing when it balances', () => {
    expect(computeReconciliation(bank()).explanations).toEqual([])
  })
})

describe('opening balance and earlier reconciliations', () => {
  const previous = { endingCents: 100000, periodEnd: '2026-07-31', clearedTransactions: [txn('old1', '2026-07-10', 'Rent', 1000, 'decrease')] }

  it('requires the beginning balance to match the last completed ending balance', () => {
    expect(codes(bank({ beginningCents: 99000 }), { previous })).toContain('opening_mismatch')
    expect(codes(bank(), { previous })).not.toContain('opening_mismatch')
  })
  it('requires confirmation of the opening balance for a first reconciliation', () => {
    expect(codes(bank({ openingConfirmed: false }))).toContain('opening_unconfirmed')
    expect(codes(bank({ openingConfirmed: false }), { previous })).not.toContain('opening_unconfirmed')
  })
  it('rejects a period that overlaps the previous one', () => {
    expect(codes(bank({ periodStart: '2026-07-31' }), { previous })).toContain('period_overlap')
  })
  it('detects previously cleared transactions that changed or disappeared', () => {
    const changes = findChangedSincePrevious(previous.clearedTransactions, [txn('old1', '2026-07-10', 'Rent', 1200, 'decrease')])
    expect(changes.map((item) => item.change)).toEqual(['amount'])
    expect(findChangedSincePrevious(previous.clearedTransactions, [])[0].change).toBe('deleted')
    expect(findChangedSincePrevious(previous.clearedTransactions, [txn('old1', '2026-07-12', 'Rent', 1000, 'decrease')])[0].change).toBe('date')
    expect(findChangedSincePrevious(previous.clearedTransactions, [txn('old1', '2026-07-10', 'Rent', 1000, 'decrease')])).toEqual([])
  })
  it('blocks completion when an earlier cleared transaction changed', () => {
    const result = validateCompletion({ ...bank(), status: 'draft' }, { previous, sourceTransactions: [txn('old1', '2026-07-10', 'Rent', 900, 'decrease')], today: '2026-10-01' })
    expect(result.ok).toBe(false)
    expect(result.blocking.map((issue) => issue.code)).toContain('previously_cleared_changed')
  })
  it('builds the previous summary from a completed record', () => {
    const summary = previousFrom({ endingCents: 5, periodEnd: '2026-07-31', transactions: [txn('a', '2026-07-01', 'x', 1, 'increase'), txn('b', '2026-07-02', 'y', 1, 'increase')], clearedIds: ['a'] })
    expect(summary.clearedTransactions.map((item) => item.id)).toEqual(['a'])
  })
})

describe('eligible transactions', () => {
  const all = [txn('old', '2026-06-20', 'Old', 10, 'decrease'), txn('in', '2026-08-10', 'In', 10, 'decrease'), txn('late', '2026-09-02', 'Late', 10, 'decrease'), txn('done', '2026-07-20', 'Done', 10, 'decrease')]
  it('excludes later transactions and ones already reconciled', () => {
    const { eligible } = splitEligible(all, { periodStart: '2026-08-01', periodEnd: '2026-08-31', previouslyClearedIds: new Set(['done']), hasPrevious: true })
    expect(eligible.map((item) => item.id)).toEqual(['old', 'in'])
  })
  it('assumes earlier activity is in the opening balance for a first reconciliation', () => {
    const { eligible, assumedInOpening } = splitEligible(all, { periodStart: '2026-08-01', periodEnd: '2026-08-31', previouslyClearedIds: new Set(), hasPrevious: false })
    expect(eligible.map((item) => item.id)).toEqual(['in'])
    expect(assumedInOpening.map((item) => item.id)).toEqual(['old', 'done'])
  })
  it('compares transaction lists ignoring order and memo', () => {
    expect(sameTransactions(all, [...all].reverse().map((item) => ({ ...item, memo: 'changed' })))).toBe(true)
    expect(sameTransactions(all, all.slice(1))).toBe(false)
    expect(sameTransactions(all, all.map((item, index) => (index === 0 ? { ...item, amountCents: 1 } : item)))).toBe(false)
  })
})

describe('incomplete data and completion rules', () => {
  const draft = (overrides: Partial<CalcInput> = {}) => validateCompletion({ ...bank(overrides), status: 'draft' }, { today: '2026-10-01' })

  it('allows completion only when everything checks out', () => {
    expect(draft().ok).toBe(true)
  })
  it('does not accept a zero difference when the source data is incomplete', () => {
    const result = draft({ completeness: { complete: false, reasons: ['Transactions were cut off at the page limit'] } })
    expect(computeReconciliation(bank()).differenceCents).toBe(0)
    expect(result.ok).toBe(false)
    expect(result.blocking.map((issue) => issue.code)).toContain('data_incomplete')
    expect(result.blocking[0].message).toMatch(/zero difference cannot be trusted/)
  })
  it('blocks a non-zero difference by a single cent', () => {
    const result = draft({ endingCents: 138001 })
    expect(result.ok).toBe(false)
    expect(result.blocking.map((issue) => issue.code)).toEqual(['not_balanced'])
  })
  it('blocks invalid or backwards dates and a future period', () => {
    expect(codes(bank({ periodStart: '2026-02-30' }))).toContain('dates_invalid')
    expect(codes(bank({ periodStart: '2026-09-01' }))).toContain('period_invalid')
    expect(codes(bank({ statementDate: '2026-08-30' }))).toContain('dates_invalid')
    expect(codes(bank({ periodEnd: '2026-12-31', statementDate: '2026-12-31' }))).toContain('period_in_future')
  })
  it('blocks when cleared items are missing from the data', () => {
    expect(codes(bank({ clearedIds: ['d1', 'w1', 'ghost'] }))).toContain('cleared_unknown')
  })
  it('refuses to complete an already completed reconciliation', () => {
    const result = validateCompletion({ ...bank(), status: 'completed' }, { today: '2026-10-01' })
    expect(result.ok).toBe(false)
    expect(result.blocking.map((issue) => issue.code)).toContain('already_completed')
  })
  it('does not let warnings block completion', () => {
    const input = bank({ transactions: [...bank().transactions, txn('d9', '2026-08-06', 'Customer', 500, 'increase')], clearedIds: ['d1', 'w1', 'd9'], endingCents: 188000 })
    const result = validateCompletion({ ...input, status: 'draft' }, { today: '2026-10-01' })
    expect(result.computation.issues.some((issue) => issue.severity === 'warning')).toBe(true)
    expect(result.ok).toBe(true)
  })
})
