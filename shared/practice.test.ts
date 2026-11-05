import { describe, expect, it } from 'vitest'
import { aging, balanceAt, balanceSheetSummary, openBalanceCents, profitAndLossSummary, trialBalance, validateLedger } from './accounting'
import { DEMO_CLIENT_ID, DEMO_RECONCILIATION_ACCOUNTS, demoLedger } from './demoBooks'
import { OTHER_DEMO_COMPANIES } from './demoCompanyBooks'
import { makePaymentBook, mergeDemoPayments, paymentBalances, paymentOpenItems, reversePayment, validatePaymentInput, type DemoPaymentBook } from './demoPayments'

const AS_OF = '2026-08-31'
const PERIOD_ENDS = ['2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31', AS_OF]

type Practice = { clientId: string; name: string; ledger: typeof demoLedger; bankId: string }

const practices: Practice[] = [
  { clientId: DEMO_CLIENT_ID, name: 'ABC Plumbing', ledger: demoLedger, bankId: DEMO_RECONCILIATION_ACCOUNTS.find((account) => account.kind === 'bank')!.id },
  ...OTHER_DEMO_COMPANIES.map((company) => ({ clientId: company.clientId, name: company.clientName, ledger: company.ledger, bankId: company.reconciliationAccounts.find((account) => account.kind === 'bank')!.id })),
]

const entriesOf = (books: DemoPaymentBook[], practice: Practice) => mergeDemoPayments(books, practice.ledger, practice.clientId)
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

describe('Phase 11: all five demo companies', () => {
  it('has exactly five distinct fictional companies', () => {
    expect(practices).toHaveLength(5)
    expect(new Set(practices.map((practice) => practice.clientId)).size).toBe(5)
  })

  describe.each(practices)('$name', (practice) => {
    it('keeps debits equal to credits and a balanced trial balance at every period end', () => {
      expect(validateLedger(practice.ledger.accounts, practice.ledger.entries)).toEqual([])
      for (const end of PERIOD_ENDS) {
        const table = trialBalance(practice.ledger.accounts, practice.ledger.entries, end)
        expect(table.rows.length).toBeGreaterThan(0)
        const totalRow = table.rows.find((row) => row.key === 'total')
        if (end === AS_OF) expect(totalRow?.cells[0]).toBeGreaterThan(0)
        expect(totalRow?.cells[0]).toBe(totalRow?.cells[1])
      }
    })

    it('has a balance sheet that balances at every period end', () => {
      for (const end of PERIOD_ENDS) {
        const summary = balanceSheetSummary(practice.ledger.accounts, practice.ledger.entries, end)
        expect(summary.assetsCents).toBe(summary.liabilitiesCents + summary.equityCents)
      }
    })

    it('agrees AR and AP aging with the ledger control accounts', () => {
      const receivables = paymentOpenItems('invoice', [], practice.clientId)
      const payables = paymentOpenItems('bill', [], practice.clientId)
      const arLedger = balanceAt(practice.ledger.accounts, practice.ledger.entries, 'ar', AS_OF)
      const apLedger = balanceAt(practice.ledger.accounts, practice.ledger.entries, 'ap', AS_OF)
      expect(sum(receivables.map((item) => openBalanceCents(item, AS_OF)))).toBe(arLedger)
      expect(sum(payables.map((item) => openBalanceCents(item, AS_OF)))).toBe(apLedger)
      expect(aging('ar-aging', receivables, AS_OF).totalCents).toBe(arLedger)
      expect(aging('ap-aging', payables, AS_OF).totalCents).toBe(apLedger)
    })

    it('records a full invoice payment once: AR falls, cash rises, income does not change', () => {
      const openInvoice = paymentOpenItems('invoice', [], practice.clientId).find((item) => openBalanceCents(item, AS_OF) > 0)
      expect(openInvoice).toBeDefined()
      if (!openInvoice) return
      const owed = openBalanceCents(openInvoice, AS_OF)
      const input = { date: AS_OF, amountCents: owed, bankAccountId: practice.bankId }
      expect(validatePaymentInput(input, practice.clientId)).toEqual({})
      const books = [makePaymentBook(null, 'invoice', openInvoice.id, input, 'Practice', '2026-08-31T10:00:00Z', 'pay-1', practice.clientId)]
      const before = practice.ledger
      const after = entriesOf(books, practice)

      expect(validateLedger(after.accounts, after.entries)).toEqual([])
      expect(balanceAt(after.accounts, after.entries, 'ar', AS_OF)).toBe(balanceAt(before.accounts, before.entries, 'ar', AS_OF) - owed)
      expect(balanceAt(after.accounts, after.entries, 'checking', AS_OF)).toBe(balanceAt(before.accounts, before.entries, 'checking', AS_OF) + owed)
      expect(profitAndLossSummary(after.accounts, after.entries, '2026-03-01', AS_OF)).toEqual(profitAndLossSummary(before.accounts, before.entries, '2026-03-01', AS_OF))
      const balanceSheet = balanceSheetSummary(after.accounts, after.entries, AS_OF)
      expect(balanceSheet.assetsCents).toBe(balanceSheet.liabilitiesCents + balanceSheet.equityCents)

      const settled = paymentOpenItems('invoice', books, practice.clientId).find((item) => item.id === openInvoice.id)!
      expect(openBalanceCents(settled, AS_OF)).toBe(0)
    })

    it('records a partial bill payment without duplicating the expense, and a reversal restores the books', () => {
      const openBill = paymentOpenItems('bill', [], practice.clientId).find((item) => openBalanceCents(item, AS_OF) > 1)
      expect(openBill).toBeDefined()
      if (!openBill) return
      const owed = openBalanceCents(openBill, AS_OF)
      const partial = Math.floor(owed / 2)
      const input = { date: AS_OF, amountCents: partial, bankAccountId: practice.bankId }
      const book = makePaymentBook(null, 'bill', openBill.id, input, 'Practice', '2026-08-31T10:00:00Z', 'pay-2', practice.clientId)
      const paid = entriesOf([book], practice)
      const before = practice.ledger

      expect(balanceAt(paid.accounts, paid.entries, 'ap', AS_OF)).toBe(balanceAt(before.accounts, before.entries, 'ap', AS_OF) - partial)
      expect(balanceAt(paid.accounts, paid.entries, 'checking', AS_OF)).toBe(balanceAt(before.accounts, before.entries, 'checking', AS_OF) - partial)
      expect(profitAndLossSummary(paid.accounts, paid.entries, '2026-03-01', AS_OF)).toEqual(profitAndLossSummary(before.accounts, before.entries, '2026-03-01', AS_OF))
      expect(paymentBalances('bill', [book], practice.clientId)).toBe(paymentBalances('bill', [], practice.clientId) - partial)

      const reversed = reversePayment(book, 'pay-2', 'Practice', '2026-08-31T11:00:00Z', 'Entered in error')
      const restored = entriesOf([reversed], practice)
      expect(validateLedger(restored.accounts, restored.entries)).toEqual([])
      expect(balanceAt(restored.accounts, restored.entries, 'ap', AS_OF)).toBe(balanceAt(before.accounts, before.entries, 'ap', AS_OF))
      expect(balanceAt(restored.accounts, restored.entries, 'checking', AS_OF)).toBe(balanceAt(before.accounts, before.entries, 'checking', AS_OF))
      expect(() => reversePayment(reversed, 'pay-2', 'Practice', '2026-08-31T12:00:00Z', 'Again')).toThrow(/not active/i)
    })

    it('rejects invalid payment amounts, dates and bank accounts', () => {
      expect(validatePaymentInput({ date: AS_OF, amountCents: 0, bankAccountId: practice.bankId }, practice.clientId).amountCents).toBeTruthy()
      expect(validatePaymentInput({ date: AS_OF, amountCents: -500, bankAccountId: practice.bankId }, practice.clientId).amountCents).toBeTruthy()
      expect(validatePaymentInput({ date: AS_OF, amountCents: 10.5, bankAccountId: practice.bankId }, practice.clientId).amountCents).toBeTruthy()
      expect(validatePaymentInput({ date: '2026-02-30', amountCents: 100, bankAccountId: practice.bankId }, practice.clientId).date).toBeTruthy()
      expect(validatePaymentInput({ date: AS_OF, amountCents: 100, bankAccountId: 'someone-elses-account' }, practice.clientId).bankAccountId).toBeTruthy()
    })
  })

  it('never lets one company’s payment books change another company’s open items or ledger', () => {
    for (const source of practices) {
      const invoice = paymentOpenItems('invoice', [], source.clientId).find((item) => openBalanceCents(item, AS_OF) > 0)
      if (!invoice) continue
      const books = [makePaymentBook(null, 'invoice', invoice.id, { date: AS_OF, amountCents: openBalanceCents(invoice, AS_OF), bankAccountId: source.bankId }, 'Practice', '2026-08-31T10:00:00Z', 'iso-1', source.clientId)]
      for (const other of practices.filter((practice) => practice.clientId !== source.clientId)) {
        expect(paymentOpenItems('invoice', books, other.clientId)).toEqual(paymentOpenItems('invoice', [], other.clientId))
        expect(entriesOf(books, other).entries).toHaveLength(other.ledger.entries.length)
      }
    }
  })

  it('does not treat transfers or loan principal as income', () => {
    for (const practice of practices) {
      const income = profitAndLossSummary(practice.ledger.accounts, practice.ledger.entries, '2026-03-01', AS_OF)
      const incomeIds = new Set(practice.ledger.accounts.filter((account) => account.klass === 'income' || account.klass === 'other_income').map((account) => account.id))
      const transferLike = practice.ledger.entries.filter((entry) => /transfer|loan (draw|proceeds)/i.test(entry.memo ?? ''))
      for (const entry of transferLike) expect(entry.lines.some((line) => incomeIds.has(line.accountId))).toBe(false)
      expect(Number.isFinite(income.netIncomeCents)).toBe(true)
    }
  })
})
