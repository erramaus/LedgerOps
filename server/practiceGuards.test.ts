import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { openBalanceCents } from '../shared/accounting.js'
import { getAdditionalDemoCompany } from '../shared/demoCompanyBooks.js'
import { monthEndId } from '../shared/monthEnd.js'
import { paymentOpenItems } from '../shared/demoPayments.js'
import { createDemoPaymentRouter } from './demoPayments.js'
import { MemoryDemoPaymentStore } from './demoPaymentStore.js'
import { seedDemoRecords } from './demoSeed.js'
import { MemoryMonthEndStore } from './monthEndStore.js'
import { MemoryReconciliationStore } from './reconciliationStore.js'

const CLIENT = 'smith-construction'
const OTHER = 'acme-consulting'
const AS_OF = '2026-08-31'
const bankOf = (clientId: string) => getAdditionalDemoCompany(clientId)!.reconciliationAccounts.find((account) => account.kind === 'bank')!.id
const bankId = bankOf(CLIENT)

let store: MemoryDemoPaymentStore
let monthEnd: MemoryMonthEndStore
let app: express.Express

beforeEach(async () => {
  store = new MemoryDemoPaymentStore()
  monthEnd = new MemoryMonthEndStore()
  const reconciliations = new MemoryReconciliationStore()
  await seedDemoRecords(reconciliations, monthEnd)
  app = express()
  app.use(express.json())
  app.use((incoming, _response, next) => {
    ;(incoming as unknown as { session: unknown }).session = { user: { email: 'practice@example.com' } }
    next()
  })
  app.use('/api/demo-payments', createDemoPaymentRouter({ store, reconciliations, monthEnd, now: () => Date.parse('2026-10-15T12:00:00Z') }))
})

const openInvoice = () => paymentOpenItems('invoice', [], CLIENT).find((item) => openBalanceCents(item, AS_OF) > 0)!
const post = (documentId: string, amountCents: number, overrides: Record<string, unknown> = {}) =>
  request(app).post('/api/demo-payments').send({ clientId: CLIENT, kind: 'invoice', documentId, expectedVersion: 0, input: { date: AS_OF, amountCents, bankAccountId: bankId }, ...overrides })

describe('Phase 11: demo payment guards (Smith Construction)', () => {
  it('records a payment once and reports the remaining balance', async () => {
    const invoice = openInvoice()
    const response = await post(invoice.id, openBalanceCents(invoice, AS_OF) - 100)
    expect(response.status).toBe(201)
    expect(response.body.outstandingCents).toBe(100)
    expect((await store.list(CLIENT)).flatMap((book) => book.payments)).toHaveLength(1)
  })

  it.each([
    ['zero', 0],
    ['negative', -500],
    ['fractional cents', 10.5],
    ['absurdly large', 1_000_000_000],
  ])('rejects a %s payment amount and saves nothing', async (_label, amount) => {
    const response = await post(openInvoice().id, amount)
    expect(response.status).toBe(400)
    expect(await store.list(CLIENT)).toEqual([])
  })

  it('rejects overpayment, a date before the document, and an impossible date', async () => {
    const invoice = openInvoice()
    expect((await post(invoice.id, openBalanceCents(invoice, AS_OF) + 1)).body.code).toBe('OVERPAYMENT')
    expect((await post(invoice.id, 100, { input: { date: '2026-02-30', amountCents: 100, bankAccountId: bankId } })).status).toBe(400)
    expect((await post(invoice.id, 100, { input: { date: '2026-03-01', amountCents: 100, bankAccountId: bankId } })).status).not.toBe(201)
    expect(await store.list(CLIENT)).toEqual([])
  })

  it('rejects a duplicate payment and a stale version without changing the books', async () => {
    const invoice = openInvoice()
    expect((await post(invoice.id, 100)).status).toBe(201)
    expect((await post(invoice.id, 100, { expectedVersion: 1 })).body.code).toBe('DUPLICATE_PAYMENT')
    expect((await post(invoice.id, 200, { expectedVersion: 0 })).body.code).toBe('CONFLICT')
    expect((await store.list(CLIENT)).flatMap((book) => book.payments)).toHaveLength(1)
  })

  it('refuses a payment into a closed month', async () => {
    const record = (await monthEnd.get(monthEndId('demo', CLIENT, '2026-08')))!
    expect(await monthEnd.put({ ...record, status: 'closed', version: record.version + 1 }, record.version)).toBe(true)
    const response = await post(openInvoice().id, 100)
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('PERIOD_CLOSED')
    expect(await store.list(CLIENT)).toEqual([])
  })

  it('refuses a payment dated inside a reconciled bank period', async () => {
    const early = paymentOpenItems('invoice', [], CLIENT).find((item) => item.date <= '2026-07-31' && openBalanceCents(item, AS_OF) > 0)
    expect(early).toBeDefined()
    const response = await post(early!.id, 100, { input: { date: '2026-07-31', amountCents: 100, bankAccountId: bankId } })
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('ACCOUNT_RECONCILED')
  })

  it('rejects another company’s bank account, unknown clients and cross-company documents', async () => {
    expect((await post(openInvoice().id, 100, { input: { date: AS_OF, amountCents: 100, bankAccountId: bankOf(OTHER) } })).status).toBe(400)
    expect((await post(openInvoice().id, 100, { clientId: 'real-company' })).status).toBe(422)
    expect((await post(openInvoice().id, 100, { clientId: OTHER, input: { date: AS_OF, amountCents: 100, bankAccountId: bankOf(OTHER) } })).status).toBe(404)
    expect(await store.list(OTHER)).toEqual([])
  })

  it('requires a reason to reverse and refuses a second reversal', async () => {
    const created = await post(openInvoice().id, 100)
    const { book } = created.body
    const path = `/api/demo-payments/${book.id}/payments/${book.payments[0].id}/reverse`
    expect((await request(app).post(path).send({ expectedVersion: book.version, reason: '' })).body.code).toBe('REASON_REQUIRED')
    const reversed = await request(app).post(path).send({ expectedVersion: book.version, reason: 'Entered in error' })
    expect(reversed.status).toBe(200)
    expect((await request(app).post(path).send({ expectedVersion: reversed.body.book.version, reason: 'Entered in error' })).status).toBe(409)
  })
})
