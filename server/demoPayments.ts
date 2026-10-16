import crypto from 'node:crypto'
import express, { type Response } from 'express'
import { validateLedger } from '../shared/accounting.js'
import { DEMO_CLIENT_ID, DEMO_RECONCILIATION_ACCOUNTS, demoLedger } from '../shared/demoBooks.js'
import { ADDITIONAL_DEMO_CLIENT_IDS, getAdditionalDemoCompany } from '../shared/demoCompanyBooks.js'
import {
  activePaymentCents, makePaymentBook, mergeDemoPayments, paymentBookId, paymentDocument, reversePayment, seededPaidCents, validatePaymentInput,
  type DemoPaymentBook, type DocumentPaymentKind,
} from '../shared/demoPayments.js'
import { ENTRY_WINDOW } from '../shared/demoEntries.js'
import { monthEndId } from '../shared/monthEnd.js'
import { monthLabel, parsePeriodKey } from '../shared/period.js'
import type { MonthEndStore } from './monthEndStore.js'
import type { ReconciliationStore } from './reconciliationStore.js'
import type { DemoPaymentStore } from './demoPaymentStore.js'

type Problem = { status: number; code: string; error: string; extra?: Record<string, unknown> }
const problem = (status: number, code: string, error: string, extra?: Record<string, unknown>): Problem => ({ status, code, error, extra })
const isProblem = (value: unknown): value is Problem => typeof value === 'object' && value !== null && 'code' in value && 'status' in value && 'error' in value
const KINDS: DocumentPaymentKind[] = ['invoice', 'bill']
const isKind = (value: unknown): value is DocumentPaymentKind => KINDS.includes(value as DocumentPaymentKind)

export function createDemoPaymentRouter(deps: { store: DemoPaymentStore; reconciliations: ReconciliationStore; monthEnd: MonthEndStore; now: () => number }) {
  const { store, reconciliations, monthEnd, now } = deps
  const router = express.Router()
  const iso = () => new Date(now()).toISOString()
  const actor = (request: express.Request) => request.session?.user?.email ?? 'unknown'
  const send = (response: Response, failure: Problem) => response.status(failure.status).json({ error: failure.error, code: failure.code, ...failure.extra })
  const guard = (handler: (request: express.Request, response: Response) => Promise<void>): express.RequestHandler => async (request, response) => {
    try {
      await handler(request, response)
    } catch (error) {
      console.error('[demo payments] request failed:', error instanceof Error ? error.message : error)
      send(response, problem(500, 'UNEXPECTED', 'The payment could not be saved. Nothing was changed.'))
    }
  }

  const validClient = (value: unknown): Problem | null => value === DEMO_CLIENT_ID || (typeof value === 'string' && ADDITIONAL_DEMO_CLIENT_IDS.includes(value)) ? null : problem(422, 'NO_BOOKS', 'Choose one of the five demo companies. QuickBooks payments must be recorded in QuickBooks.')
  const companyName = (clientId: string) => clientId === DEMO_CLIENT_ID ? 'ABC Plumbing' : getAdditionalDemoCompany(clientId)?.clientName ?? 'this demo client'
  const accountsFor = (clientId: string) => clientId === DEMO_CLIENT_ID ? DEMO_RECONCILIATION_ACCOUNTS : getAdditionalDemoCompany(clientId)?.reconciliationAccounts ?? []
  const ledgerFor = (clientId: string) => getAdditionalDemoCompany(clientId)?.ledger ?? demoLedger
  const checkDate = async (clientId: string, date: string): Promise<Problem | null> => {
    const month = date.slice(0, 7)
    const closed = await monthEnd.get(monthEndId('demo', clientId, month))
    if (closed?.status === 'closed') return problem(409, 'PERIOD_CLOSED', `${monthLabel(parsePeriodKey(month)!)} is closed. Reopen the month, with a reason, before changing its books.`)
    const account = accountsFor(clientId).find((item) => item.kind === 'bank')
    const reconciled = (await reconciliations.list({ source: 'demo', clientId })).find((record) => record.accountId === account?.id && record.status === 'completed' && record.periodEnd >= date)
    if (reconciled) return problem(409, 'ACCOUNT_RECONCILED', `${account?.name ?? 'The bank account'} is reconciled through ${reconciled.periodEnd}. Reopen that reconciliation, with a reason, before changing its books.`)
    return null
  }
  const readPaymentInput = (value: unknown, clientId: string) => {
    const body = (value ?? {}) as Record<string, unknown>
    const input = {
      date: typeof body.date === 'string' ? body.date : '',
      amountCents: typeof body.amountCents === 'number' ? body.amountCents : NaN,
      bankAccountId: typeof body.bankAccountId === 'string' ? body.bankAccountId : '',
    }
    const errors = validatePaymentInput(input, clientId)
    return Object.keys(errors).length > 0 ? { error: Object.values(errors)[0], fields: errors } : { input }
  }
  const validateSavedLedger = (clientId: string, books: DemoPaymentBook[]): Problem | null => {
    const merged = mergeDemoPayments(books, ledgerFor(clientId), clientId)
    return validateLedger(merged.accounts, merged.entries).length === 0 ? null : problem(500, 'UNBALANCED', 'The payment would leave the demo ledger out of balance, so nothing was saved.')
  }

  router.get('/', guard(async (request, response) => {
    const clientId = request.query.clientId
    if (typeof clientId !== 'string' || !/^[\w-]{1,60}$/.test(clientId)) return void send(response, problem(400, 'INVALID', 'A client is required.'))
    response.json({ durable: store.durable, books: await store.list(clientId) })
  }))

  router.post('/', guard(async (request, response) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    const notDemo = validClient(body.clientId)
    if (notDemo) return void send(response, notDemo)
    if (!isKind(body.kind) || typeof body.documentId !== 'string' || !/^[\w-]{1,60}$/.test(body.documentId)) return void send(response, problem(400, 'INVALID', 'Choose a valid invoice or bill.'))
    if (!Number.isInteger(body.expectedVersion) || (body.expectedVersion as number) < 0) return void send(response, problem(400, 'INVALID', 'Reload this document before recording a payment.'))
    const clientId = body.clientId as string
    const parsed = readPaymentInput(body.input, clientId)
    if (!parsed.input) return void send(response, problem(400, 'INVALID', parsed.error!, { fields: parsed.fields }))
    const { input } = parsed
    const clientPeriods = getAdditionalDemoCompany(clientId)?.periods
    const firstPeriod = clientPeriods?.[0]
    const lastPeriod = clientPeriods?.[clientPeriods.length - 1]
    const start = firstPeriod ? `${firstPeriod.year}-${String(firstPeriod.month).padStart(2, '0')}-01` : ENTRY_WINDOW.start
    const end = lastPeriod ? `${lastPeriod.year}-${String(lastPeriod.month).padStart(2, '0')}-${String(new Date(Date.UTC(lastPeriod.year, lastPeriod.month, 0)).getUTCDate()).padStart(2, '0')}` : ENTRY_WINDOW.end
    if (input.date < start || input.date > end) return void send(response, problem(422, 'DATE_OUT_OF_RANGE', `The demo accounting books cover ${start} through ${end}.`))
    const document = paymentDocument(body.kind, body.documentId, clientId)
    if (!document) return void send(response, problem(404, 'DOCUMENT_NOT_FOUND', `That invoice or bill is not in ${companyName(clientId)}'s demo books.`))
    const documentDate = document.date
    if (input.date < documentDate) return void send(response, problem(422, 'PAYMENT_BEFORE_DOCUMENT', 'A payment cannot be dated before its invoice or bill.'))
    const blocked = await checkDate(clientId, input.date)
    if (blocked) return void send(response, blocked)

    const id = paymentBookId(clientId, body.kind, body.documentId)
    const existing = await store.get(id)
    if ((existing?.version ?? 0) !== body.expectedVersion) return void send(response, problem(409, 'CONFLICT', 'This payment history changed elsewhere. Reload it before recording a payment.'))
    const duplicate = existing?.payments.find((payment) => payment.status === 'active' && payment.date === input.date && payment.amountCents === input.amountCents && payment.bankAccountId === input.bankAccountId)
    if (duplicate) return void send(response, problem(409, 'DUPLICATE_PAYMENT', 'An active payment with this date, amount and bank account is already recorded for this document.', { paymentId: duplicate.id }))
    const totalCents = document.amountCents
    const initialPaidCents = seededPaidCents(body.kind, body.documentId, clientId) ?? 0
    const outstandingCents = totalCents - initialPaidCents - activePaymentCents(existing ?? undefined)
    if (outstandingCents <= 0) return void send(response, problem(409, 'ALREADY_PAID', 'This invoice or bill has no remaining balance.', { outstandingCents: 0 }))
    if (input.amountCents > outstandingCents) return void send(response, problem(422, 'OVERPAYMENT', 'The payment is greater than the remaining document balance.', { outstandingCents }))

    const next = makePaymentBook(existing, body.kind, body.documentId, input, actor(request), iso(), `payment-${crypto.randomBytes(8).toString('hex')}`, clientId)
    const books = await store.list(clientId)
    const nextBooks = [...books.filter((book) => book.id !== id), next]
    const invalid = validateSavedLedger(clientId, nextBooks)
    if (invalid) return void send(response, invalid)
    if (!(await store.put(next, existing?.version ?? 0))) return void send(response, problem(409, 'CONFLICT', 'This payment history changed elsewhere. Reload it before recording a payment.'))
    response.status(201).json({ durable: store.durable, book: next, outstandingCents: outstandingCents - input.amountCents })
  }))

  router.post('/:bookId/payments/:paymentId/reverse', guard(async (request, response) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (reason.length < 5 || reason.length > 1000) return void send(response, problem(400, 'REASON_REQUIRED', 'Give a reason for reversing this payment. It is kept in the history.'))
    const id = String(request.params.bookId)
    const stored = await store.get(id)
    if (!stored || !ADDITIONAL_DEMO_CLIENT_IDS.concat(DEMO_CLIENT_ID).includes(stored.clientId)) return void send(response, problem(404, 'NOT_FOUND', 'That payment history could not be found.'))
    if (!Number.isInteger(body.expectedVersion) || stored.version !== body.expectedVersion) return void send(response, problem(409, 'CONFLICT', 'This payment history changed elsewhere. Reload it before reversing a payment.'))
    const payment = stored.payments.find((item) => item.id === request.params.paymentId)
    if (!payment) return void send(response, problem(404, 'NOT_FOUND', 'That payment could not be found.'))
    if (payment.status !== 'active') return void send(response, problem(409, 'ALREADY_REVERSED', 'That payment was already reversed.'))
    const blocked = await checkDate(stored.clientId, payment.date)
    if (blocked) return void send(response, blocked)
    const next = reversePayment(stored, payment.id, actor(request), iso(), reason)
    const books = await store.list(stored.clientId)
    const invalid = validateSavedLedger(stored.clientId, books.map((book) => book.id === stored.id ? next : book))
    if (invalid) return void send(response, invalid)
    if (!(await store.put(next, stored.version))) return void send(response, problem(409, 'CONFLICT', 'This payment history changed elsewhere. Reload it before reversing a payment.'))
    response.json({ durable: store.durable, book: next })
  }))

  return router
}
