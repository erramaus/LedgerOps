import { DEMO_CLIENT_ID, demoLedger } from '../../shared/demoBooks'
import { getAdditionalDemoCompany } from '../../shared/demoCompanyBooks'
import {
  activePaymentCents, paymentDocument, type DemoPaymentBook, type DemoDocumentPayment, type DocumentPaymentKind, type DemoPaymentInput,
} from '../../shared/demoPayments'
import { formatCents } from '../../shared/reconciliation'
import { apiFetch } from './apiClient'
import type { Bill, Invoice } from './bookkeepingTypes'
import type { LedgerTransaction } from './bookkeepingTypes'

export class DemoPaymentApiError extends Error {
  readonly code?: string
  readonly fields?: Record<string, string>
  readonly outstandingCents?: number
  constructor(message: string, extra: { code?: string; fields?: Record<string, string>; outstandingCents?: number } = {}) {
    super(message)
    this.name = 'DemoPaymentApiError'
    Object.assign(this, extra)
  }
}

type Body = { error?: string; code?: string; durable?: boolean; books?: DemoPaymentBook[]; book?: DemoPaymentBook; fields?: Record<string, string>; outstandingCents?: number }
async function call(path: string, init?: RequestInit): Promise<Body> {
  const response = await apiFetch(path, init)
  const body = (await response.json().catch(() => ({}))) as Body
  if (response.ok) return body
  throw new DemoPaymentApiError(body.error || 'The payment could not be saved. Nothing was changed.', { code: body.code, fields: body.fields, outstandingCents: body.outstandingCents })
}
const post = (payload: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
const encode = (value: string) => encodeURIComponent(value)

export const demoPaymentService = {
  list: async (clientId: string) => (await call(`/api/demo-payments?clientId=${encode(clientId)}`)).books ?? [],
  create: async (clientId: string, kind: DocumentPaymentKind, documentId: string, expectedVersion: number, input: DemoPaymentInput) =>
    (await call('/api/demo-payments', post({ clientId, kind, documentId, expectedVersion, input }))).book!,
  reverse: async (bookId: string, paymentId: string, expectedVersion: number, reason: string) =>
    (await call(`/api/demo-payments/${encode(bookId)}/payments/${encode(paymentId)}/reverse`, post({ expectedVersion, reason }))).book!,
}

function paidTotals(books: DemoPaymentBook[], kind: DocumentPaymentKind) {
  return new Map(books.filter((book) => book.kind === kind).map((book) => [book.documentId, activePaymentCents(book)]))
}

export function invoicesWithPayments(invoices: Invoice[], books: DemoPaymentBook[], clientId = DEMO_CLIENT_ID): Invoice[] {
  const added = paidTotals(books.filter((book) => book.clientId === clientId), 'invoice')
  return invoices.map((invoice) => {
    const amountPaid = (Math.round(invoice.amountPaid * 100) + (added.get(invoice.id) ?? 0)) / 100
    const remainingCents = Math.round(invoice.amount * 100) - Math.round(amountPaid * 100)
    const status = remainingCents <= 0 ? 'Paid' as const : amountPaid > 0 ? 'Partially Paid' as const : invoice.status
    return { ...invoice, amountPaid, status }
  })
}

export function billsWithPayments(bills: Bill[], books: DemoPaymentBook[], clientId = DEMO_CLIENT_ID): Bill[] {
  const added = paidTotals(books.filter((book) => book.clientId === clientId), 'bill')
  return bills.map((bill) => {
    const amountPaid = (Math.round(bill.amountPaid * 100) + (added.get(bill.id) ?? 0)) / 100
    const remainingCents = Math.round(bill.amount * 100) - Math.round(amountPaid * 100)
    const status = remainingCents <= 0 ? 'Paid' as const : amountPaid > 0 ? 'Partially Paid' as const : bill.status
    return { ...bill, amountPaid, status }
  })
}

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const displayDate = (date: string) => `${months[Number(date.slice(5, 7)) - 1]} ${date.slice(8, 10)}, ${date.slice(0, 4)}`

function toTransaction(payment: DemoDocumentPayment, kind: DocumentPaymentKind, documentId: string, clientId = DEMO_CLIENT_ID, reversal = false): LedgerTransaction | null {
  const document = paymentDocument(kind, documentId, clientId)
  if (!document) return null
  const chart = getAdditionalDemoCompany(clientId)?.ledger.accounts ?? demoLedger.accounts
  const company = getAdditionalDemoCompany(clientId)
  const sourceAccount = chart.find((account) => account.id === (kind === 'invoice' ? 'ar' : 'ap'))
  const payee = reversal ? `Reversal: ${document.party}` : document.party
  const memo = kind === 'invoice' ? 'Accounts Receivable' : 'Accounts Payable'
  return {
    id: reversal ? `${payment.id}-reversal` : payment.id,
    date: displayDate(payment.date),
    payee,
    description: `${reversal ? 'Reversal of ' : ''}${kind === 'invoice' ? 'Invoice' : 'Bill'} ${document.number}${sourceAccount ? ` · ${sourceAccount.name}` : ''}`,
    amount: formatCents(payment.amountCents),
    totalAmount: payment.amountCents / 100,
    category: memo,
    status: 'Categorized',
    account: company?.reconciliationAccounts.find((account) => account.kind === 'bank')?.name ?? 'Chase Business Checking',
    clientId,
    source: 'demo',
    transactionType: reversal ? 'Payment Reversal' : kind === 'invoice' ? 'Customer Payment' : 'Vendor Payment',
    readOnlyReason: 'This document payment is posted to the demo ledger. Reverse it from the invoice or bill payment history so balances and accounts stay in sync.',
  }
}

export function paymentTransactions(books: DemoPaymentBook[], clientId = DEMO_CLIENT_ID): LedgerTransaction[] {
  return books.filter((book) => book.clientId === clientId).flatMap((book) => book.payments.flatMap((payment) => {
    const original = toTransaction(payment, book.kind, book.documentId, clientId)
    return original ? [original, ...(payment.status === 'reversed' ? [toTransaction(payment, book.kind, book.documentId, clientId, true)!] : [])] : []
  })).sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id))
}

export const bookForDocument = (books: DemoPaymentBook[], kind: DocumentPaymentKind, documentId: string, clientId = DEMO_CLIENT_ID) =>
  books.find((book) => book.clientId === clientId && book.kind === kind && book.documentId === documentId)
