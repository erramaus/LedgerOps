import { describe, expect, it } from 'vitest'
import {
  TransactionUpdateError,
  buildLineUpdatePayload,
  describeQuickBooksFailure,
  getReadOnlyReason,
  normalizeTransaction,
  verifyUpdatedTransaction,
  type LineChangeRequest,
  type QbAccount,
  type QbTransaction,
} from './transactionLines.js'

const accounts: QbAccount[] = [
  { Id: '10', Name: 'Office Supplies', AccountType: 'Expense', Active: true },
  { Id: '20', Name: 'Meals', AccountType: 'Expense', Active: true },
  { Id: '30', Name: 'Uncategorized Expense', AccountType: 'Expense', Active: true },
  { Id: '40', Name: 'Job Materials', AccountType: 'Cost of Goods Sold', Active: true },
  { Id: '50', Name: 'Old Account', AccountType: 'Expense', Active: false },
  { Id: '60', Name: 'Checking', AccountType: 'Bank', Active: true },
  { Id: '70', Name: 'Sales', AccountType: 'Income', Active: true },
]

const line = (id: string, amount: number, accountId: string, accountName: string, description: string, extra: object = {}) => ({
  Id: id,
  Amount: amount,
  Description: description,
  DetailType: 'AccountBasedExpenseLineDetail',
  AccountBasedExpenseLineDetail: { AccountRef: { value: accountId, name: accountName }, BillableStatus: 'NotBillable', TaxCodeRef: { value: 'NON' }, ...extra },
})

const splitPurchase = (): QbTransaction => ({
  Id: '42',
  SyncToken: '5',
  TxnDate: '2026-08-21',
  TotalAmt: 286.4,
  PaymentType: 'CreditCard',
  PrivateNote: 'Costco run',
  AccountRef: { value: '99', name: 'Business Credit Card' },
  EntityRef: { value: '7', name: 'Costco Wholesale' },
  CustomField: [{ Name: 'PO', StringValue: 'A-17' }],
  Line: [
    line('1', 120.4, '10', 'Office Supplies', 'Printer paper'),
    line('2', 64, '20', 'Meals', 'Coffee and snacks'),
    line('3', 102, '30', 'Uncategorized Expense', 'Cleaning supplies'),
  ],
})

const request = (overrides: Partial<LineChangeRequest> = {}): LineChangeRequest => ({
  transactionType: 'Purchase',
  transactionId: '42',
  syncToken: '5',
  expectedTotal: 286.4,
  changes: [{ lineId: '3', accountId: '40' }],
  ...overrides,
})

const codeOf = (action: () => unknown) => {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(TransactionUpdateError)
    return (error as TransactionUpdateError).code
  }
  throw new Error('expected a TransactionUpdateError')
}

describe('reading split transactions', () => {
  it('keeps every line with its own account, amount and description', () => {
    const result = normalizeTransaction('Purchase', splitPurchase())
    expect(result.lines).toEqual([
      { id: '1', description: 'Printer paper', amount: 120.4, category: 'Office Supplies', categoryId: '10' },
      { id: '2', description: 'Coffee and snacks', amount: 64, category: 'Meals', categoryId: '20' },
      { id: '3', description: 'Cleaning supplies', amount: 102, category: 'Uncategorized Expense', categoryId: '30' },
    ])
    expect(result.category).toBe('Split')
    expect(result.totalAmount).toBe(286.4)
    expect(result.readOnlyReason).toBeUndefined()
  })

  it('reports the paid-from account separately from the category', () => {
    const result = normalizeTransaction('Purchase', splitPurchase())
    expect(result.account).toBe('Business Credit Card')
    expect(result.lines.map((item) => item.category)).not.toContain('Business Credit Card')
  })

  it('needs review while any line is still an uncategorized account', () => {
    expect(normalizeTransaction('Purchase', splitPurchase()).status).toBe('Needs Review')
    const done = splitPurchase()
    done.Line![2] = line('3', 102, '40', 'Job Materials', 'Cleaning supplies')
    expect(normalizeTransaction('Purchase', done).status).toBe('Categorized')
  })

  it('uses the single line’s category for a one-line transaction', () => {
    const single = { ...splitPurchase(), TotalAmt: 64, Line: [line('1', 64, '20', 'Meals', 'Lunch')] }
    const result = normalizeTransaction('Purchase', single)
    expect(result.category).toBe('Meals')
    expect(result.lines).toHaveLength(1)
  })
})

describe('unsupported transactions are read-only', () => {
  it.each([
    ['Deposit', splitPurchase(), /read-only/i],
    ['Transfer', splitPurchase(), /read-only/i],
    ['Payment', splitPurchase(), /read-only/i],
  ])('%s cannot be edited', (type, item, reason) => {
    expect(getReadOnlyReason(type, item)).toMatch(reason)
    expect(normalizeTransaction(type, item).lines).toEqual([])
  })

  it('refuses item-based lines even when mixed with account lines', () => {
    const mixed = splitPurchase()
    mixed.Line!.push({ Id: '4', Amount: 0, DetailType: 'ItemBasedExpenseLineDetail' })
    expect(getReadOnlyReason('Purchase', mixed)).toMatch(/item-based/i)
  })

  it('refuses a missing SyncToken, missing line ids, tax, foreign currency and total mismatches', () => {
    expect(getReadOnlyReason('Purchase', { ...splitPurchase(), SyncToken: undefined })).toMatch(/SyncToken/)
    const noId = splitPurchase()
    delete noId.Line![0].Id
    expect(getReadOnlyReason('Purchase', noId)).toMatch(/no QuickBooks id/)
    expect(getReadOnlyReason('Purchase', { ...splitPurchase(), TxnTaxDetail: { TotalTax: 5 } })).toMatch(/tax/i)
    expect(getReadOnlyReason('Purchase', { ...splitPurchase(), CurrencyRef: { value: 'EUR' } })).toMatch(/currency/i)
    expect(getReadOnlyReason('Purchase', { ...splitPurchase(), TotalAmt: 300 })).toMatch(/do not add up/)
    expect(getReadOnlyReason('Purchase', { ...splitPurchase(), Line: [] })).toMatch(/no lines/)
  })

  it('refuses to build an update for them', () => {
    expect(codeOf(() => buildLineUpdatePayload(splitPurchase(), request({ transactionType: 'Deposit' }), accounts))).toBe('UNSUPPORTED')
    expect(codeOf(() => buildLineUpdatePayload({ ...splitPurchase(), SyncToken: undefined }, request(), accounts))).toBe('UNSUPPORTED')
  })
})

describe('line-level updates', () => {
  it('changes only the requested line and leaves every other line untouched', () => {
    const original = splitPurchase()
    const payload = buildLineUpdatePayload(original, request(), accounts)
    expect(payload.Line![2].AccountBasedExpenseLineDetail!.AccountRef).toEqual({ value: '40', name: 'Job Materials' })
    expect(payload.Line![0]).toEqual(original.Line![0])
    expect(payload.Line![1]).toEqual(original.Line![1])
  })

  it('never copies one category onto every line', () => {
    const payload = buildLineUpdatePayload(splitPurchase(), request(), accounts)
    const used = new Set(payload.Line!.map((item) => item.AccountBasedExpenseLineDetail!.AccountRef!.value))
    expect(used.size).toBe(3)
  })

  it('updates several lines independently in one request', () => {
    const payload = buildLineUpdatePayload(splitPurchase(), request({ changes: [{ lineId: '1', accountId: '40' }, { lineId: '3', accountId: '20' }] }), accounts)
    expect(payload.Line!.map((item) => item.AccountBasedExpenseLineDetail!.AccountRef!.value)).toEqual(['40', '20', '20'])
  })

  it('preserves amounts, descriptions, other line fields and unrelated transaction fields', () => {
    const original = splitPurchase()
    const payload = buildLineUpdatePayload(original, request(), accounts)
    expect(payload.Line!.map((item) => [item.Id, item.Amount, item.Description])).toEqual(original.Line!.map((item) => [item.Id, item.Amount, item.Description]))
    expect(payload.Line![2].AccountBasedExpenseLineDetail).toMatchObject({ BillableStatus: 'NotBillable', TaxCodeRef: { value: 'NON' } })
    expect({ ...payload, Line: undefined }).toEqual({ ...original, Line: undefined })
    expect(payload.CustomField).toEqual(original.CustomField)
  })

  it('does not modify the object it was given', () => {
    const original = splitPurchase()
    const snapshot = structuredClone(original)
    buildLineUpdatePayload(original, request(), accounts)
    expect(original).toEqual(snapshot)
  })

  it('sends the latest SyncToken from QuickBooks unchanged', () => {
    expect(buildLineUpdatePayload(splitPurchase(), request(), accounts).SyncToken).toBe('5')
  })
})

describe('total and freshness validation', () => {
  it('keeps the transaction total and line sum identical', () => {
    const payload = buildLineUpdatePayload(splitPurchase(), request(), accounts)
    const sum = payload.Line!.reduce((total, item) => total + Math.round((item.Amount ?? 0) * 100), 0)
    expect(sum).toBe(Math.round(payload.TotalAmt! * 100))
  })

  it('stops when the total the user reviewed is no longer the total in QuickBooks', () => {
    expect(codeOf(() => buildLineUpdatePayload(splitPurchase(), request({ expectedTotal: 280 }), accounts))).toBe('STALE')
  })

  it('stops when the SyncToken is out of date', () => {
    expect(codeOf(() => buildLineUpdatePayload(splitPurchase(), request({ syncToken: '4' }), accounts))).toBe('STALE')
  })

  it('compares cents, not floating point values', () => {
    const tricky = splitPurchase()
    tricky.Line = [line('1', 0.1, '10', 'Office Supplies', 'a'), line('2', 0.2, '20', 'Meals', 'b')]
    tricky.TotalAmt = 0.3
    expect(() => buildLineUpdatePayload(tricky, request({ expectedTotal: 0.3, changes: [{ lineId: '1', accountId: '40' }] }), accounts)).not.toThrow()
  })
})

describe('request validation', () => {
  it('rejects unknown lines, duplicates, empty requests and no-op changes', () => {
    expect(codeOf(() => buildLineUpdatePayload(splitPurchase(), request({ changes: [{ lineId: '99', accountId: '40' }] }), accounts))).toBe('INVALID')
    expect(codeOf(() => buildLineUpdatePayload(splitPurchase(), request({ changes: [{ lineId: '3', accountId: '40' }, { lineId: '3', accountId: '20' }] }), accounts))).toBe('INVALID')
    expect(codeOf(() => buildLineUpdatePayload(splitPurchase(), request({ changes: [] }), accounts))).toBe('INVALID')
    expect(codeOf(() => buildLineUpdatePayload(splitPurchase(), request({ changes: [{ lineId: '1', accountId: '10' }] }), accounts))).toBe('INVALID')
  })

  it.each([
    ['unknown', '999'],
    ['inactive', '50'],
    ['bank', '60'],
    ['income', '70'],
  ])('rejects a %s account', (_label, accountId) => {
    expect(codeOf(() => buildLineUpdatePayload(splitPurchase(), request({ changes: [{ lineId: '3', accountId }] }), accounts))).toBe('INVALID')
  })
})

describe('verifying what QuickBooks stored', () => {
  const changes = [{ lineId: '3', accountId: '40' }]
  const stored = () => buildLineUpdatePayload(splitPurchase(), request(), accounts)

  it('accepts a faithful result', () => {
    expect(() => verifyUpdatedTransaction(splitPurchase(), stored(), changes)).not.toThrow()
  })

  it('detects a requested change that was not applied', () => {
    expect(codeOf(() => verifyUpdatedTransaction(splitPurchase(), splitPurchase(), changes))).toBe('VERIFY_FAILED')
  })

  it('detects an unrelated line that changed', () => {
    const wrong = stored()
    wrong.Line![0].AccountBasedExpenseLineDetail!.AccountRef = { value: '20', name: 'Meals' }
    expect(codeOf(() => verifyUpdatedTransaction(splitPurchase(), wrong, changes))).toBe('VERIFY_FAILED')
  })

  it('detects changed amounts, totals and line counts', () => {
    const amount = stored()
    amount.Line![1].Amount = 70
    expect(codeOf(() => verifyUpdatedTransaction(splitPurchase(), amount, changes))).toBe('VERIFY_FAILED')
    expect(codeOf(() => verifyUpdatedTransaction(splitPurchase(), { ...stored(), TotalAmt: 290 }, changes))).toBe('VERIFY_FAILED')
    expect(codeOf(() => verifyUpdatedTransaction(splitPurchase(), { ...stored(), Line: stored().Line!.slice(1) }, changes))).toBe('VERIFY_FAILED')
  })
})

describe('describing QuickBooks failures', () => {
  it('recognises stale objects', () => {
    expect(describeQuickBooksFailure(400, { Fault: { Error: [{ Message: 'Stale Object Error', code: '5010' }] } }).code).toBe('STALE')
  })

  it('separates credential, outage and validation problems', () => {
    expect(describeQuickBooksFailure(401, undefined).code).toBe('AUTH')
    expect(describeQuickBooksFailure(503, undefined).code).toBe('UNAVAILABLE')
    expect(describeQuickBooksFailure(429, undefined).code).toBe('UNAVAILABLE')
    const rejected = describeQuickBooksFailure(400, { Fault: { Error: [{ Message: 'Invalid Reference Id', Detail: 'secret detail' }] } })
    expect(rejected.code).toBe('REJECTED')
    expect(rejected.message).toContain('Invalid Reference Id')
    expect(rejected.message).not.toContain('secret detail')
  })

  it('copes with an unreadable body', () => {
    expect(describeQuickBooksFailure(400, 'not json').code).toBe('REJECTED')
  })
})
