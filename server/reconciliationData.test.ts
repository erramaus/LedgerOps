import { describe, expect, it } from 'vitest'
import { READ_ENTITIES, buildAccountRegister, referencesAccount, type EntityRead, type QbEntity } from './reconciliationData.js'

const BANK = { id: '35', kind: 'bank' as const }
const CARD = { id: '41', kind: 'credit_card' as const }
const read = (entity: string, items: QbEntity[], extra: Partial<EntityRead> = {}): EntityRead => ({ entity, items, ...extra })
const only = (reads: EntityRead[], account = BANK, through = '2026-08-31') => buildAccountRegister(account, reads, through)

describe('mapping QuickBooks entities onto a bank account', () => {
  it('turns a check or cash purchase from the account into a withdrawal', () => {
    const { transactions } = only([read('Purchase', [{ Id: '1', TxnDate: '2026-08-05', TotalAmt: 120.5, AccountRef: { value: '35' }, EntityRef: { name: 'Supplier' }, PaymentType: 'Check' }])])
    expect(transactions).toEqual([{ id: 'Purchase-1', date: '2026-08-05', payee: 'Supplier', memo: '', amountCents: 12050, direction: 'decrease', type: 'Purchase' }])
  })
  it('turns deposits and customer payments into deposits', () => {
    const { transactions } = only([read('Deposit', [{ Id: '2', TxnDate: '2026-08-06', TotalAmt: 900, DepositToAccountRef: { value: '35' } }]), read('Payment', [{ Id: '3', TxnDate: '2026-08-07', TotalAmt: 50, DepositToAccountRef: { value: '35' }, CustomerRef: { name: 'Pat' } }])])
    expect(transactions.map((t) => [t.id, t.direction, t.amountCents])).toEqual([['Deposit-2', 'increase', 90000], ['Payment-3', 'increase', 5000]])
  })
  it('treats a refund (Credit purchase) as money coming in', () => {
    expect(only([read('Purchase', [{ Id: '4', TxnDate: '2026-08-08', TotalAmt: 10, AccountRef: { value: '35' }, Credit: true }])]).transactions[0].direction).toBe('increase')
  })
  it('handles transfers in both directions and ignores other accounts', () => {
    const { transactions } = only([read('Transfer', [
      { Id: '5', TxnDate: '2026-08-09', Amount: 200, FromAccountRef: { value: '35' }, ToAccountRef: { value: '99' } },
      { Id: '6', TxnDate: '2026-08-10', Amount: 300, FromAccountRef: { value: '99' }, ToAccountRef: { value: '35' } },
      { Id: '7', TxnDate: '2026-08-10', Amount: 400, FromAccountRef: { value: '98' }, ToAccountRef: { value: '99' } },
    ])])
    expect(transactions.map((t) => [t.id, t.direction])).toEqual([['Transfer-5', 'decrease'], ['Transfer-6', 'increase']])
  })
  it('reads bill payments by check from the bank account', () => {
    const { transactions } = only([read('BillPayment', [{ Id: '8', TxnDate: '2026-08-11', TotalAmt: 75, PayType: 'Check', CheckPayment: { BankAccountRef: { value: '35' } }, VendorRef: { name: 'Vendor' } }])])
    expect(transactions[0]).toMatchObject({ direction: 'decrease', amountCents: 7500, payee: 'Vendor' })
  })
  it('leaves out transactions after the statement date and zero-amount records', () => {
    const { transactions } = only([read('Deposit', [{ Id: '1', TxnDate: '2026-09-01', TotalAmt: 5, DepositToAccountRef: { value: '35' } }, { Id: '2', TxnDate: '2026-08-31', TotalAmt: 0, DepositToAccountRef: { value: '35' } }, { Id: '3', TxnDate: '2026-08-31', TotalAmt: 5, DepositToAccountRef: { value: '35' } }])])
    expect(transactions.map((t) => t.id)).toEqual(['Deposit-3'])
  })
  it('sorts by date then id', () => {
    const { transactions } = only([read('Deposit', [{ Id: '9', TxnDate: '2026-08-02', TotalAmt: 1, DepositToAccountRef: { value: '35' } }, { Id: '8', TxnDate: '2026-08-02', TotalAmt: 1, DepositToAccountRef: { value: '35' } }, { Id: '7', TxnDate: '2026-08-01', TotalAmt: 1, DepositToAccountRef: { value: '35' } }])])
    expect(transactions.map((t) => t.id)).toEqual(['Deposit-7', 'Deposit-8', 'Deposit-9'])
  })
})

describe('mapping onto a credit card account', () => {
  it('treats purchases on the card as charges that increase what is owed', () => {
    expect(only([read('Purchase', [{ Id: '1', TxnDate: '2026-08-05', TotalAmt: 40, AccountRef: { value: '41' }, PaymentType: 'CreditCard' }])], CARD).transactions[0].direction).toBe('increase')
  })
  it('treats a card credit and a payment from the bank as reducing what is owed', () => {
    const { transactions } = only([
      read('Purchase', [{ Id: '2', TxnDate: '2026-08-06', TotalAmt: 15, AccountRef: { value: '41' }, Credit: true }]),
      read('CreditCardPayment', [{ Id: '3', TxnDate: '2026-08-07', Amount: 500, BankAccountRef: { value: '35' }, CreditCardAccountRef: { value: '41' } }]),
    ], CARD)
    expect(transactions.map((t) => t.direction)).toEqual(['decrease', 'decrease'])
  })
  it('shows the same card payment as a withdrawal from the bank', () => {
    expect(only([read('CreditCardPayment', [{ Id: '3', TxnDate: '2026-08-07', Amount: 500, BankAccountRef: { value: '35' }, CreditCardAccountRef: { value: '41' } }])]).transactions[0].direction).toBe('decrease')
  })
})

describe('completeness of the data read', () => {
  const complete = () => READ_ENTITIES.map((entity) => read(entity, [], { expected: 0 }))

  it('is complete when every entity was read in full', () => {
    expect(only(complete()).completeness).toEqual({ complete: true, reasons: [] })
  })
  it('is incomplete when a read failed', () => {
    const result = only([...complete().slice(1), read('Purchase', [], { error: 'HTTP 500' })])
    expect(result.completeness.complete).toBe(false)
    expect(result.completeness.reasons[0]).toMatch(/Could not read Purchase records \(HTTP 500\)/)
  })
  it('is incomplete when results were cut off at the page limit', () => {
    expect(only([read('Deposit', [], { truncated: true })]).completeness.reasons[0]).toMatch(/cut off at the page limit/)
  })
  it('is incomplete when fewer records were read than QuickBooks counted', () => {
    expect(only([read('Deposit', [{ Id: '1', TxnDate: '2026-08-01', TotalAmt: 1, DepositToAccountRef: { value: '35' } }], { expected: 3 })]).completeness.reasons[0]).toMatch(/Read 1 of 3 Deposit records/)
  })
  it('is incomplete when an unsupported entry such as a journal entry touches the account', () => {
    const journal: QbEntity = { Id: '9', TxnDate: '2026-08-12', Line: [{ JournalEntryLineDetail: { AccountRef: { value: '35' } } }] }
    const result = only([read('JournalEntry', [journal], { expected: 1 })])
    expect(result.completeness.complete).toBe(false)
    expect(result.completeness.reasons[0]).toMatch(/1 JournalEntry record affect this account but cannot be read here/)
  })
  it('ignores unsupported entries that do not touch the account or are dated later', () => {
    const other: QbEntity = { Id: '9', TxnDate: '2026-08-12', Line: [{ JournalEntryLineDetail: { AccountRef: { value: '77' } } }] }
    const later: QbEntity = { Id: '10', TxnDate: '2026-09-12', DepositToAccountRef: { value: '35' } }
    expect(only([read('JournalEntry', [other], { expected: 1 }), read('SalesReceipt', [later], { expected: 1 })]).completeness.complete).toBe(true)
  })
  it('finds account references nested anywhere', () => {
    expect(referencesAccount({ a: [{ b: { DepositToAccountRef: { value: '35' } } }] }, '35')).toBe(true)
    expect(referencesAccount({ a: { Name: '35' } }, '35')).toBe(false)
  })
})
