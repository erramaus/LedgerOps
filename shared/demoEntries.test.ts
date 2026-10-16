import { describe, expect, it } from 'vitest'
import { balanceAt, validateLedger } from './accounting'
import { demoLedger } from './demoBooks'
import { demoClientFigures, demoReport, demoStatementFacts } from './demoMonthEnd'
import {
  accountRegister, additionRegister, categoryOptions, createRecord, editRecord, findPossibleDuplicates, journalFor, mergedLedger, reverseRecord, toJournalEntries, validateEntryInput,
  type DemoEntryInput,
} from './demoEntries'

const AT = '2026-10-15T12:00:00.000Z'
const missingCharge: DemoEntryInput = { accountId: 'chase-card', type: 'charge', date: '2026-08-08', payee: 'Home Depot', amountCents: 22_420, categoryId: 'materials', memo: 'Pipe and fittings' }
const record = (input = missingCharge, id = 'e1') => createRecord(id, 'abc-plumbing', input, 'pat@example.com', AT)
const august = { start: '2026-08-01', end: '2026-08-31', label: 'August 2026' }
const cell = (table: ReturnType<typeof demoReport>, key: string) => table.rows.find((row) => row.key === key)?.cells[0]

describe('validation: nothing is defaulted and every field is checked', () => {
  it('accepts the missing card charge', () => {
    expect(validateEntryInput(missingCharge)).toEqual({})
  })

  it('requires every field to be chosen by the person', () => {
    const errors = validateEntryInput({})
    expect(Object.keys(errors).sort()).toEqual(['accountId', 'amountCents', 'categoryId', 'date', 'payee', 'type'])
  })

  it('rejects zero, negative and fractional amounts, bad and out-of-range dates, and blank payees', () => {
    expect(validateEntryInput({ ...missingCharge, amountCents: 0 }).amountCents).toBeDefined()
    expect(validateEntryInput({ ...missingCharge, amountCents: -500 }).amountCents).toBeDefined()
    expect(validateEntryInput({ ...missingCharge, amountCents: 10.5 }).amountCents).toBeDefined()
    expect(validateEntryInput({ ...missingCharge, date: '2026-02-30' }).date).toBeDefined()
    expect(validateEntryInput({ ...missingCharge, date: '2026-09-02' }).date).toContain('May 1 to August 31')
    expect(validateEntryInput({ ...missingCharge, payee: '   ' }).payee).toBeDefined()
  })

  it('only allows types that fit the account, and categories that fit the type', () => {
    expect(validateEntryInput({ ...missingCharge, type: 'deposit' }).type).toContain('credit card cannot have a deposit')
    expect(validateEntryInput({ ...missingCharge, accountId: 'chase-checking', type: 'charge' }).type).toContain('bank account cannot have a charge')
    expect(validateEntryInput({ ...missingCharge, categoryId: 'income' }).categoryId).toContain('does not fit')
    expect(validateEntryInput({ ...missingCharge, categoryId: 'nonsense' }).categoryId).toBeDefined()
    expect(categoryOptions('charge').every((option) => ['cogs', 'expense', 'other_expense'].includes(option.klass) || option.id === 'equipment')).toBe(true)
    expect(categoryOptions('deposit').map((option) => option.id)).toContain('income')
  })
})

describe('double entry', () => {
  it('every kind of entry is balanced, in whole cents, and passes the ledger validator', () => {
    const inputs: DemoEntryInput[] = [
      missingCharge,
      { ...missingCharge, type: 'payment_or_credit', categoryId: 'checking', payee: 'Chase card payment' },
      { ...missingCharge, type: 'payment_or_credit', categoryId: 'materials', payee: 'Home Depot refund' },
      { accountId: 'chase-checking', type: 'deposit', date: '2026-08-10', payee: 'Customer', amountCents: 123_456, categoryId: 'income', memo: '' },
      { accountId: 'chase-checking', type: 'withdrawal', date: '2026-08-12', payee: 'Supplier', amountCents: 999, categoryId: 'ap', memo: '' },
    ]
    inputs.forEach((input, index) => {
      const entry = journalFor(input, `x${index}`)
      expect(entry.lines.reduce((sum, line) => sum + line.debitCents, 0)).toBe(entry.lines.reduce((sum, line) => sum + line.creditCents, 0))
    })
    const merged = mergedLedger(inputs.map((input, index) => record(input, `e${index}`)))
    expect(validateLedger(merged.accounts, merged.entries)).toEqual([])
  })

  it('a charge raises what is owed on the card and the expense; a payment lowers the card and the bank', () => {
    const base = balanceAt(demoLedger.accounts, demoLedger.entries, 'card', '2026-08-31')
    const withCharge = mergedLedger([record()])
    expect(balanceAt(withCharge.accounts, withCharge.entries, 'card', '2026-08-31')).toBe(base + 22_420)
    const payment = record({ ...missingCharge, type: 'payment_or_credit', categoryId: 'checking', amountCents: 50_000 }, 'p1')
    const withPayment = mergedLedger([payment])
    expect(balanceAt(withPayment.accounts, withPayment.entries, 'card', '2026-08-31')).toBe(base - 50_000)
    expect(balanceAt(withPayment.accounts, withPayment.entries, 'checking', '2026-08-31')).toBe(4_842_172 - 50_000)
  })

  it('closes the demo card difference exactly: the books then equal the $6,234.50 statement', () => {
    const merged = mergedLedger([record()])
    expect(balanceAt(merged.accounts, merged.entries, 'card', '2026-08-31')).toBe(623_450)
  })

  it('does not change the base books it was merged into', () => {
    const before = demoLedger.entries.length
    mergedLedger([record()])
    expect(demoLedger.entries).toHaveLength(before)
    expect(balanceAt(demoLedger.accounts, demoLedger.entries, 'card', '2026-08-31')).toBe(601_030)
  })
})

describe('reports and figures follow the ledger', () => {
  const merged = mergedLedger([record()])

  it('the charge lowers August net income by exactly its amount and the sheet still balances', () => {
    expect(cell(demoReport('profit-loss', august, demoLedger), 'net-income')).toBe(414_918)
    const after = demoReport('profit-loss', august, merged)
    expect(cell(after, 'net-income')).toBe(414_918 - 22_420)
    expect(after.checks.every((check) => check.status === 'pass')).toBe(true)
    const sheet = demoReport('balance-sheet', august, merged)
    expect(sheet.checks.find((check) => check.id === 'bs-balanced')?.status).toBe('pass')
    expect(cell(sheet, 'card')).toBe(623_450)
  })

  it('appears in the general ledger on the card account and the expense account, and the trial balance balances', () => {
    const ledger = demoReport('general-ledger', august, merged)
    expect(ledger.rows.some((row) => row.key === 'card/e1')).toBe(true)
    expect(ledger.rows.some((row) => row.key === 'materials/e1')).toBe(true)
    expect(demoReport('trial-balance', august, merged).checks.find((check) => check.id === 'tb-balanced')?.status).toBe('pass')
    expect(demoReport('cash-flow', august, merged).checks.every((check) => check.status === 'pass')).toBe(true)
  })

  it('dashboard figures and month-end statement facts are recalculated', () => {
    expect(demoClientFigures({ year: 2026, month: 8 }, merged).profitCents).toBe(414_918 - 22_420)
    expect(demoStatementFacts({ year: 2026, month: 8 }, merged).netIncomeCents).toBe(414_918 - 22_420)
    expect(demoClientFigures({ year: 2026, month: 8 }).profitCents).toBe(414_918)
  })

  it('earlier months are untouched by an August entry', () => {
    const july = { start: '2026-07-01', end: '2026-07-31', label: 'July 2026' }
    expect(cell(demoReport('profit-loss', july, merged), 'net-income')).toBe(cell(demoReport('profit-loss', july), 'net-income'))
  })
})

describe('the register used for reconciliation', () => {
  it('an active entry appears once in the right account, with the right direction', () => {
    const rows = additionRegister([record()], 'card')
    expect(rows).toEqual([{ id: 'e1', date: '2026-08-08', payee: 'Home Depot', memo: 'Pipe and fittings', amountCents: 22_420, direction: 'increase' }])
    expect(additionRegister([record()], 'checking')).toEqual([])
  })

  it('a card payment from the bank appears in both registers, as a decrease in each', () => {
    const payment = record({ ...missingCharge, type: 'payment_or_credit', categoryId: 'checking', amountCents: 1_000 }, 'p1')
    expect(additionRegister([payment], 'card')[0].direction).toBe('decrease')
    expect(additionRegister([payment], 'checking')[0].direction).toBe('decrease')
  })

  it('a reversed entry leaves the register but not the ledger', () => {
    const reversed = reverseRecord(record(), 'pat@example.com', AT, 'Entered twice by mistake')
    expect(additionRegister([reversed], 'card')).toEqual([])
    expect(toJournalEntries(reversed).map((entry) => entry.id)).toEqual(['e1', 'e1-rev'])
  })
})

describe('duplicate prevention', () => {
  it('flags a transaction already in the books for the same payee, direction and amount within a week', () => {
    const duplicate = findPossibleDuplicates({ ...missingCharge, payee: 'Adobe', amountCents: 5_999, date: '2026-08-14' }, [])
    expect(duplicate.map((row) => row.id)).toEqual(['rec-card-3'])
  })

  it('flags a second entry of the same charge, but not a different amount or a different week', () => {
    const existing = [record()]
    expect(findPossibleDuplicates(missingCharge, existing).map((row) => row.id)).toEqual(['e1'])
    expect(findPossibleDuplicates({ ...missingCharge, amountCents: 22_421 }, existing)).toEqual([])
    expect(findPossibleDuplicates({ ...missingCharge, date: '2026-08-30' }, existing)).toEqual([])
  })

  it('the original missing charge is not a duplicate, because it is not in the books', () => {
    expect(findPossibleDuplicates(missingCharge, [])).toEqual([])
  })

  it('a reversed entry no longer blocks entering the corrected one, and an edit ignores itself', () => {
    const reversed = reverseRecord(record(), 'pat', AT, 'Wrong date')
    expect(findPossibleDuplicates(missingCharge, [reversed])).toEqual([])
    expect(findPossibleDuplicates(missingCharge, [record()], 'e1')).toEqual([])
  })

  it('the account register contains the base books plus active entries', () => {
    const rows = accountRegister([record()], 'card')
    expect(rows.some((row) => row.id === 'rec-card-1')).toBe(true)
    expect(rows.some((row) => row.id === 'e1')).toBe(true)
  })
})

describe('corrections keep a complete, readable history', () => {
  it('an edit reverses the old entry and adds a replacement, and the history says so', () => {
    const edited = editRecord(record(), { ...missingCharge, amountCents: 22_240 }, 'sam@example.com', '2026-10-16T09:00:00.000Z', 'Digits were transposed')
    expect(edited.version).toBe(2)
    expect(edited.status).toBe('active')
    expect(edited.revisions.map((revision) => revision.entryId)).toEqual(['e1', 'e1~2'])
    expect(toJournalEntries(edited).map((entry) => entry.id)).toEqual(['e1', 'e1-rev', 'e1~2'])
    expect(edited.history).toHaveLength(2)
    expect(edited.history[1]).toMatchObject({ action: 'edited', by: 'sam@example.com', reason: 'Digits were transposed' })
    expect(edited.history[1].summary).toContain('$224.20')
    expect(edited.history[1].summary).toContain('$222.40')
    expect(edited.history[1].summary).toContain('reversed, not deleted')
  })

  it('the net effect of an edit is only the corrected amount', () => {
    const edited = editRecord(record(), { ...missingCharge, amountCents: 22_240 }, 'sam', AT, 'Typo')
    const merged = mergedLedger([edited])
    expect(balanceAt(merged.accounts, merged.entries, 'card', '2026-08-31')).toBe(601_030 + 22_240)
    expect(validateLedger(merged.accounts, merged.entries)).toEqual([])
  })

  it('reversing nets the entry to zero while every entry stays in the books, and the history keeps the reason', () => {
    const reversed = reverseRecord(record(), 'pat', AT, 'Duplicate of a bank charge')
    const merged = mergedLedger([reversed])
    expect(reversed.status).toBe('reversed')
    expect(balanceAt(merged.accounts, merged.entries, 'card', '2026-08-31')).toBe(601_030)
    expect(merged.entries.filter((entry) => entry.id.startsWith('e1'))).toHaveLength(2)
    expect(reversed.history.map((event) => event.action)).toEqual(['created', 'reversed'])
    expect(reversed.history[1].reason).toBe('Duplicate of a bank charge')
    expect(reversed.revisions).toHaveLength(1)
  })

  it('a record keeps the client it belongs to', () => {
    expect(record().clientId).toBe('abc-plumbing')
    expect(createRecord('z', 'green-leaf-landscaping', missingCharge, 'pat', AT).clientId).toBe('green-leaf-landscaping')
  })
})
