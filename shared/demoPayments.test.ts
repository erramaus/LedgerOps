import { describe, expect, it } from 'vitest'
import { balanceAt } from './accounting'
import { DEMO_CLIENT_ID, demoLedger } from './demoBooks'
import { demoClientFigures, demoReport } from './demoMonthEnd'
import {
  makePaymentBook, mergeDemoPayments, paymentJournalEntries, paymentOpenItems, paymentRegister, reversePayment, seededPaidCents, validatePaymentInput,
  type DemoPaymentBook,
} from './demoPayments'

const date = '2026-08-25'
const now = '2026-08-25T12:00:00.000Z'
const invoicePayment = (amountCents = 50_000) => makePaymentBook(null, 'invoice', 'invoice-1004', { date, amountCents, bankAccountId: 'chase-checking' }, 'bookkeeper@example.com', now, 'payment-invoice-1')
const billPayment = (amountCents = 60_000) => makePaymentBook(null, 'bill', 'bill-2001', { date, amountCents, bankAccountId: 'chase-checking' }, 'bookkeeper@example.com', now, 'payment-bill-1')
const range = { start: '2026-08-01', end: '2026-08-31', label: 'August 2026' }

describe('demo document payments: accounting entries and balances', () => {
  it('customer payment debits checking and credits AR without recording new income', () => {
    const baseIncome = demoReport('profit-loss', range).rows.find((row) => row.key === 'net-income')?.cells[0]
    const merged = mergeDemoPayments([invoicePayment()])
    const payment = paymentJournalEntries([invoicePayment()])[0]
    expect(payment.lines).toEqual([
      { accountId: 'checking', debitCents: 50_000, creditCents: 0 },
      { accountId: 'ar', debitCents: 0, creditCents: 50_000 },
    ])
    expect(balanceAt(merged.accounts, merged.entries, 'checking', '2026-08-31')).toBe(4_892_172)
    expect(balanceAt(merged.accounts, merged.entries, 'ar', '2026-08-31')).toBe(792_000)
    expect(demoReport('profit-loss', range, merged).rows.find((row) => row.key === 'net-income')?.cells[0]).toBe(baseIncome)
    expect(demoReport('ar-aging', range, merged).checks.find((check) => check.id === 'aging-control')?.status).toBe('pass')
    expect(demoClientFigures({ year: 2026, month: 8 }, merged).receivableCents).toBe(792_000)
  })

  it('vendor payment debits AP and credits checking without recording a new expense', () => {
    const baseProfit = demoReport('profit-loss', range).rows.find((row) => row.key === 'net-income')?.cells[0]
    const merged = mergeDemoPayments([billPayment()])
    const payment = paymentJournalEntries([billPayment()])[0]
    expect(payment.lines).toEqual([
      { accountId: 'ap', debitCents: 60_000, creditCents: 0 },
      { accountId: 'checking', debitCents: 0, creditCents: 60_000 },
    ])
    expect(balanceAt(merged.accounts, merged.entries, 'checking', '2026-08-31')).toBe(4_782_172)
    expect(balanceAt(merged.accounts, merged.entries, 'ap', '2026-08-31')).toBe(195_644)
    expect(demoReport('profit-loss', range, merged).rows.find((row) => row.key === 'net-income')?.cells[0]).toBe(baseProfit)
    expect(demoReport('ap-aging', range, merged).checks.find((check) => check.id === 'aging-control')?.status).toBe('pass')
    expect(demoClientFigures({ year: 2026, month: 8 }, merged).payableCents).toBe(195_644)
  })

  it('partial and full payments reduce only the linked invoice balance and preserve seeded payments', () => {
    const first = invoicePayment(100_000)
    const second = makePaymentBook(first, 'invoice', 'invoice-1004', { date: '2026-08-28', amountCents: 98_000, bankAccountId: 'chase-checking' }, 'bookkeeper@example.com', now, 'payment-invoice-2')
    const merged = mergeDemoPayments([second])
    const item = paymentOpenItems('invoice', [second]).find((candidate) => candidate.id === 'invoice-1004')!
    expect(item.payments.reduce((sum, payment) => sum + payment.amountCents, 0)).toBe(198_000)
    expect(item.amountCents - item.payments.reduce((sum, payment) => sum + payment.amountCents, 0)).toBe(0)
    expect(seededPaidCents('invoice', 'invoice-1001')).toBe(420_000)
    expect(balanceAt(merged.accounts, merged.entries, 'ar', '2026-08-31')).toBe(644_000)
    expect(merged.entries.filter((entry) => entry.id.startsWith('payment-invoice')).every((entry) => entry.lines.reduce((sum, line) => sum + line.debitCents, 0) === entry.lines.reduce((sum, line) => sum + line.creditCents, 0))).toBe(true)
  })

  it('a reversed payment remains in the ledger with an opposite entry and restores the open amount', () => {
    const book = invoicePayment()
    const reversed = reversePayment(book, 'payment-invoice-1', 'bookkeeper@example.com', now, 'Applied to the wrong invoice')
    const merged = mergeDemoPayments([reversed])
    expect(reversed.version).toBe(2)
    expect(reversed.payments[0].history.map((event) => event.action)).toEqual(['recorded', 'reversed'])
    expect(reversed.payments[0].history[1].reason).toBe('Applied to the wrong invoice')
    expect(paymentJournalEntries([reversed]).map((entry) => entry.id)).toEqual(['payment-invoice-1', 'payment-invoice-1-reversal'])
    expect(balanceAt(merged.accounts, merged.entries, 'checking', '2026-08-31')).toBe(4_842_172)
    expect(balanceAt(merged.accounts, merged.entries, 'ar', '2026-08-31')).toBe(842_000)
    expect(paymentRegister([reversed], 'checking').map((entry) => entry.direction)).toEqual(['increase', 'decrease'])
    expect(demoReport('balance-sheet', range, merged).checks.every((check) => check.status === 'pass')).toBe(true)
    expect(demoReport('cash-flow', range, merged).checks.every((check) => check.status === 'pass')).toBe(true)
  })

  it('does not include payments belonging to another client', () => {
    const other: DemoPaymentBook = { ...invoicePayment(), clientId: 'green-leaf-landscaping', id: 'green-leaf-landscaping:invoice:invoice-1004' }
    const merged = mergeDemoPayments([other])
    expect(merged.entries).toEqual(demoLedger.entries)
    expect(balanceAt(merged.accounts, merged.entries, 'checking', '2026-08-31')).toBe(4_842_172)
    expect(paymentOpenItems('invoice', [other]).find((item) => item.id === 'invoice-1004')?.payments.reduce((sum, payment) => sum + payment.amountCents, 0)).toBe(0)
    expect(other.clientId).not.toBe(DEMO_CLIENT_ID)
  })
})

describe('payment input validation', () => {
  it('requires an ISO date, positive whole cents and a demo bank account', () => {
    expect(validatePaymentInput({ date, amountCents: 100, bankAccountId: 'chase-checking' })).toEqual({})
    expect(validatePaymentInput({ date: '2026-02-30', amountCents: 100, bankAccountId: 'chase-checking' }).date).toBeDefined()
    expect(validatePaymentInput({ date, amountCents: 0, bankAccountId: 'chase-checking' }).amountCents).toBeDefined()
    expect(validatePaymentInput({ date, amountCents: 100.1, bankAccountId: 'chase-checking' }).amountCents).toBeDefined()
    expect(validatePaymentInput({ date, amountCents: 100, bankAccountId: 'chase-card' }).bankAccountId).toBeDefined()
  })
})
