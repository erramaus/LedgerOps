import type { JournalEntry, OpenItem } from './accounting.js'
import { balanceAt } from './accounting.js'
import { DEMO_CLIENT_ID, DEMO_RECONCILIATION_ACCOUNTS, demoBillDocuments, demoInvoiceDocuments, demoLedger, demoPayableItems, demoReceivableItems } from './demoBooks.js'
import type { RegisterTxn } from './demoBooks.js'
import { formatCents } from './reconciliation.js'
import { getAdditionalDemoCompany } from './demoCompanyBooks.js'
import type { Period } from './period.js'

export type DocumentPaymentKind = 'invoice' | 'bill'
export type DemoPaymentInput = { date: string; amountCents: number; bankAccountId: string }
export type DemoPaymentEvent = { at: string; by: string; action: 'recorded' | 'reversed'; reason?: string; summary: string }
export type DemoDocumentPayment = DemoPaymentInput & {
  id: string
  status: 'active' | 'reversed'
  createdAt: string
  createdBy: string
  history: DemoPaymentEvent[]
}
export type DemoPaymentBook = {
  id: string
  clientId: string
  kind: DocumentPaymentKind
  documentId: string
  version: number
  payments: DemoDocumentPayment[]
}
export type DemoLedger = typeof demoLedger & {
  receivableItems?: OpenItem[]
  payableItems?: OpenItem[]
  clientId?: string
  periods?: Period[]
  reconAccounts?: { id: string; name: string; kind: 'bank' | 'credit_card'; ledgerId: 'checking' | 'card' }[]
  reviewScenarios?: Record<string, { possibleDuplicates: number; missingReceipts: number; missingPayees: number; openClientRequests: number }>
}

export const paymentBookId = (clientId: string, kind: DocumentPaymentKind, documentId: string) => `${clientId}:${kind}:${documentId}`
export const paymentDocument = (kind: DocumentPaymentKind, documentId: string, clientId = DEMO_CLIENT_ID) => {
  if (clientId !== DEMO_CLIENT_ID) {
    const company = getAdditionalDemoCompany(clientId)
    const document = (kind === 'invoice' ? company?.invoices : company?.bills)?.find((item) => item.id === documentId)
    return document ? { id: document.id, party: document.party, number: document.number, date: document.date, dueDate: document.dueDate, amountCents: document.amountCents, accountId: document.accountId, payments: document.payments.map((payment) => ({ ...payment })) } : undefined
  }
  const document = kind === 'invoice' ? demoInvoiceDocuments.find((item) => item.id === documentId) : demoBillDocuments.find((item) => item.id === documentId)
  return document ? { id: document.id, party: document.party, number: document.number, date: document.date, dueDate: document.dueDate, amountCents: Math.round(document.amount * 100), accountId: document.account, payments: document.payments.map((payment) => ({ date: payment.date, amountCents: Math.round(payment.amount * 100), depositTo: payment.depositTo as 'checking' })) } : undefined
}
export const seededPaidCents = (kind: DocumentPaymentKind, documentId: string, clientId = DEMO_CLIENT_ID) => {
  const document = paymentDocument(kind, documentId, clientId)
  return document ? document.payments.reduce((sum, payment) => sum + payment.amountCents, 0) : null
}
export const activePaymentCents = (book: DemoPaymentBook | undefined) =>
  book?.payments.reduce((sum, payment) => sum + (payment.status === 'active' ? payment.amountCents : 0), 0) ?? 0

const documentItems = (kind: DocumentPaymentKind): OpenItem[] => kind === 'invoice' ? demoReceivableItems() : demoPayableItems()
export function paymentOpenItems(kind: DocumentPaymentKind, books: DemoPaymentBook[], clientId = DEMO_CLIENT_ID): OpenItem[] {
  const company = getAdditionalDemoCompany(clientId)
  const items = clientId === DEMO_CLIENT_ID ? documentItems(kind) : kind === 'invoice' ? company?.ledger.receivableItems ?? [] : company?.ledger.payableItems ?? []
  return items.map((item) => {
    const book = books.find((candidate) => candidate.kind === kind && candidate.documentId === item.id && candidate.clientId === clientId)
    const extra = book?.payments.filter((payment) => payment.status === 'active').map((payment) => ({ date: payment.date, amountCents: payment.amountCents })) ?? []
    return { ...item, payments: [...item.payments, ...extra] }
  })
}

export function paymentJournal(payment: DemoDocumentPayment, kind: DocumentPaymentKind, reversing = false, clientId = DEMO_CLIENT_ID): JournalEntry {
  const accounts = clientId === DEMO_CLIENT_ID ? DEMO_RECONCILIATION_ACCOUNTS : getAdditionalDemoCompany(clientId)?.reconciliationAccounts ?? []
  const accountId = accounts.find((account) => account.id === payment.bankAccountId)?.ledgerId
  if (!accountId) throw new Error('The selected demo bank account is not available.')
  const lines = kind === 'invoice'
    ? [{ accountId, debitCents: payment.amountCents, creditCents: 0 }, { accountId: 'ar', debitCents: 0, creditCents: payment.amountCents }]
    : [{ accountId: 'ap', debitCents: payment.amountCents, creditCents: 0 }, { accountId, debitCents: 0, creditCents: payment.amountCents }]
  const entry: JournalEntry = { id: payment.id, date: payment.date, memo: `${kind === 'invoice' ? 'Customer payment' : 'Vendor payment'} (recorded manually)`, lines }
  if (!reversing) return entry
  return { id: `${payment.id}-reversal`, date: payment.date, memo: `Reversal of ${entry.memo}`, lines: entry.lines.map((line) => ({ accountId: line.accountId, debitCents: line.creditCents, creditCents: line.debitCents })) }
}

export function paymentJournalEntries(books: DemoPaymentBook[], clientId = DEMO_CLIENT_ID): JournalEntry[] {
  return books.filter((book) => book.clientId === clientId).flatMap((book) => book.payments.flatMap((payment) => {
    const document = paymentDocument(book.kind, book.documentId, clientId)
    const original = paymentJournal(payment, book.kind, false, clientId)
    return [
    { ...original, memo: `${original.memo}: ${document?.number ?? book.documentId}` },
    ...(payment.status === 'reversed' ? [{ ...paymentJournal(payment, book.kind, true, clientId), memo: `Reversal of ${document?.number ?? book.documentId}` }] : []),
  ] })).sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id))
}

/** Adds document-linked payment entries and paid amounts without touching invoice revenue or bill expense entries. */
export function mergeDemoPayments(books: DemoPaymentBook[], base: DemoLedger = demoLedger, clientId = DEMO_CLIENT_ID): DemoLedger {
  const entries = [...base.entries, ...paymentJournalEntries(books, clientId)].sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id))
  return { ...base, accounts: base.accounts, entries, receivableItems: paymentOpenItems('invoice', books, clientId), payableItems: paymentOpenItems('bill', books, clientId) }
}

/** Bank-register additions include reversals as separate opposite-direction transactions, preserving the register history. */
export function paymentRegister(books: DemoPaymentBook[], ledgerId: 'checking', clientId = DEMO_CLIENT_ID): RegisterTxn[] {
  return books.filter((book) => book.clientId === clientId).flatMap((book) => book.payments.flatMap((payment) => {
    const document = paymentDocument(book.kind, book.documentId, clientId)
    const original = paymentJournal(payment, book.kind, false, clientId)
    const line = original.lines.find((candidate) => candidate.accountId === ledgerId)
    if (!line) return []
    const originalRow: RegisterTxn = { id: original.id, date: original.date, payee: document?.party ?? book.documentId, memo: `${book.kind === 'invoice' ? 'Invoice' : 'Bill'} ${document?.number ?? book.documentId}`, amountCents: payment.amountCents, direction: line.debitCents > 0 ? 'increase' : 'decrease' }
    if (payment.status !== 'reversed') return [originalRow]
    const reversalDirection: RegisterTxn['direction'] = originalRow.direction === 'increase' ? 'decrease' : 'increase'
    return [originalRow, { ...originalRow, id: `${original.id}-reversal`, payee: `Reversal: ${originalRow.payee}`, direction: reversalDirection }]
  })).sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id))
}

export function validatePaymentInput(input: Partial<DemoPaymentInput>, clientId = DEMO_CLIENT_ID) {
  const errors: Partial<Record<keyof DemoPaymentInput, string>> = {}
  if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(Date.parse(`${input.date}T00:00:00Z`)) || new Date(`${input.date}T00:00:00Z`).toISOString().slice(0, 10) !== input.date) errors.date = 'Enter a valid payment date.'
  if (!Number.isSafeInteger(input.amountCents) || (input.amountCents ?? 0) <= 0) errors.amountCents = 'Enter a payment greater than zero.'
  else if ((input.amountCents ?? 0) > 100_000_000) errors.amountCents = 'That payment is too large for the demo books.'
  const accounts = clientId === DEMO_CLIENT_ID ? DEMO_RECONCILIATION_ACCOUNTS : getAdditionalDemoCompany(clientId)?.reconciliationAccounts ?? []
  if (!accounts.some((account) => account.id === input.bankAccountId && account.kind === 'bank')) errors.bankAccountId = 'Choose an available demo bank account.'
  return errors
}

export function makePaymentBook(book: DemoPaymentBook | null, kind: DocumentPaymentKind, documentId: string, input: DemoPaymentInput, by: string, at: string, paymentId: string, clientId = DEMO_CLIENT_ID): DemoPaymentBook {
  const payment: DemoDocumentPayment = { ...input, id: paymentId, status: 'active', createdAt: at, createdBy: by, history: [{ at, by, action: 'recorded', summary: `Recorded ${formatCents(input.amountCents)} on ${input.date}.` }] }
  return { id: book?.id ?? paymentBookId(clientId, kind, documentId), clientId, kind, documentId, version: (book?.version ?? 0) + 1, payments: [...(book?.payments ?? []), payment] }
}

export function reversePayment(book: DemoPaymentBook, paymentId: string, by: string, at: string, reason: string): DemoPaymentBook {
  const payment = book.payments.find((candidate) => candidate.id === paymentId)
  if (!payment || payment.status !== 'active') throw new Error('That payment is not active.')
  return {
    ...book,
    version: book.version + 1,
    payments: book.payments.map((candidate) => candidate.id !== paymentId ? candidate : {
      ...candidate,
      status: 'reversed',
      history: [...candidate.history, { at, by, action: 'reversed', reason, summary: `Reversed ${formatCents(candidate.amountCents)}. The original payment and reversal remain in the ledger.` }],
    }),
  }
}

export function paymentBalances(kind: DocumentPaymentKind, books: DemoPaymentBook[], clientId = DEMO_CLIENT_ID) {
  const items = paymentOpenItems(kind, books, clientId)
  return items.reduce((sum, item) => sum + Math.max(0, item.amountCents - item.payments.reduce((paid, payment) => paid + payment.amountCents, 0)), 0)
}

export function verifyPaymentLedger(books: DemoPaymentBook[], base: DemoLedger = demoLedger, clientId = DEMO_CLIENT_ID) {
  const merged = mergeDemoPayments(books, base, clientId)
  const debits = merged.entries.flatMap((entry) => entry.lines).reduce((sum, line) => sum + line.debitCents, 0)
  const credits = merged.entries.flatMap((entry) => entry.lines).reduce((sum, line) => sum + line.creditCents, 0)
  return { merged, balanced: debits === credits, checkingCents: balanceAt(merged.accounts, merged.entries, 'checking', '2026-08-31'), arCents: balanceAt(merged.accounts, merged.entries, 'ar', '2026-08-31'), apCents: balanceAt(merged.accounts, merged.entries, 'ap', '2026-08-31') }
}
