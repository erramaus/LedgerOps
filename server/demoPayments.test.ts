import session from 'express-session'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { DEMO_CLIENT_ID } from '../shared/demoBooks.js'
import { buildDemoReconciliations } from '../shared/demoMonthEnd.js'
import { createApp, type QuickBooksGateway } from './app.js'
import type { AuthProvider } from './authProvider.js'
import type { AppConfig } from './config.js'
import { MemoryDemoPaymentStore } from './demoPaymentStore.js'
import { MemoryMonthEndStore } from './monthEndStore.js'
import { MemoryReconciliationStore } from './reconciliationStore.js'

const ORIGIN = 'http://localhost:5173'
const NOW = Date.parse('2026-10-15T12:00:00Z')
const invoice = { clientId: DEMO_CLIENT_ID, kind: 'invoice', documentId: 'invoice-1004', input: { date: '2026-08-25', amountCents: 100_000, bankAccountId: 'chase-checking' } }
const bill = { clientId: DEMO_CLIENT_ID, kind: 'bill', documentId: 'bill-2001', input: { date: '2026-08-26', amountCents: 60_000, bankAccountId: 'chase-checking' } }

function build() {
  const provider: AuthProvider = {
    beginLogin: async () => ({ url: 'https://idp.test/authorize?state=state-1', transaction: { state: 'state-1', nonce: 'n', codeVerifier: 'v' } }),
    completeLogin: async () => ({ subject: 'idp|1', email: 'bookkeeper@example.com', emailVerified: true, name: 'Pat' }),
  }
  const quickbooks = new Proxy({}, { get: (_target, name) => vi.fn(() => { throw new Error(`QuickBooks must not be called: ${String(name)}`) }) }) as unknown as QuickBooksGateway
  const paymentStore = new MemoryDemoPaymentStore()
  const reconciliations = new MemoryReconciliationStore()
  for (const record of buildDemoReconciliations()) void reconciliations.put(record, 0)
  const config: AppConfig = { production: false, appOrigin: ORIGIN, corsOrigins: new Set([ORIGIN]), allowedEmails: new Set(['bookkeeper@example.com']), sessionSecret: 'x'.repeat(48), webRoot: '/nonexistent' }
  const create = () => createApp({ config, quickbooks, authProvider: provider, sessionStore: new session.MemoryStore(), reconciliationStore: reconciliations, monthEndStore: new MemoryMonthEndStore(), demoPaymentStore: paymentStore, now: () => NOW })
  return { app: create(), paymentStore }
}
type Harness = ReturnType<typeof build>
type Agent = ReturnType<typeof request.agent>

async function signIn(harness: Harness) {
  const agent = request.agent(harness.app)
  const login = await agent.get('/api/auth/login')
  await agent.get('/api/auth/callback').query({ state: new URL(login.headers.location).searchParams.get('state'), code: 'code' })
  const csrf = (await agent.get('/api/auth/session')).body.csrfToken as string
  return { agent, csrf }
}
const post = (agent: Agent, csrf: string, body: object) => agent.post('/api/demo-payments').set('X-CSRF-Token', csrf).send(body)
const reverse = (agent: Agent, csrf: string, bookId: string, paymentId: string, expectedVersion: number, reason: string) =>
  agent.post(`/api/demo-payments/${encodeURIComponent(bookId)}/payments/${encodeURIComponent(paymentId)}/reverse`).set('X-CSRF-Token', csrf).send({ expectedVersion, reason })

describe('demo payment access and source isolation', () => {
  it('requires a session and CSRF for every write', async () => {
    const harness = build()
    expect((await request(harness.app).get('/api/demo-payments?clientId=abc-plumbing')).status).toBe(401)
    expect((await request(harness.app).post('/api/demo-payments').send(invoice)).status).toBe(401)
    const who = await signIn(harness)
    expect((await post(who.agent, '', invoice)).status).toBe(403)
    expect(await harness.paymentStore.list(DEMO_CLIENT_ID)).toEqual([])
  })

  it('posts to a generated demo client without mixing books and refuses QuickBooks clients', async () => {
    const harness = build()
    const who = await signIn(harness)
    const generatedPayment = { clientId: 'green-leaf-landscaping', kind: 'invoice', documentId: 'green-leaf-landscaping-invoice-202608', expectedVersion: 0, input: { date: '2026-08-29', amountCents: 10_000, bankAccountId: 'green-leaf-landscaping-checking' } }
    expect((await post(who.agent, who.csrf, generatedPayment)).status).toBe(201)
    const rejected = await post(who.agent, who.csrf, { ...generatedPayment, clientId: 'quickbooks-sandbox' })
    expect(rejected.status).toBe(422)
    expect(rejected.body.code).toBe('NO_BOOKS')
    expect(await harness.paymentStore.list('green-leaf-landscaping')).toHaveLength(1)
    expect(await harness.paymentStore.list(DEMO_CLIENT_ID)).toEqual([])
  })

  it('lists only the requested client books', async () => {
    const harness = build()
    const who = await signIn(harness)
    expect((await who.agent.get(`/api/demo-payments?clientId=${DEMO_CLIENT_ID}`)).body).toMatchObject({ durable: false, books: [] })
    expect((await who.agent.get('/api/demo-payments')).status).toBe(400)
  })
})

describe('invoice and bill payments', () => {
  it('supports partial then full invoice payments without overpaying', async () => {
    const harness = build()
    const who = await signIn(harness)
    const first = await post(who.agent, who.csrf, { ...invoice, expectedVersion: 0 })
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({ outstandingCents: 98_000, book: { kind: 'invoice', documentId: 'invoice-1004', version: 1 } })
    const second = await post(who.agent, who.csrf, { ...invoice, expectedVersion: 1, input: { ...invoice.input, date: '2026-08-28', amountCents: 98_000 } })
    expect(second.status).toBe(201)
    expect(second.body).toMatchObject({ outstandingCents: 0, book: { version: 2 } })
    const overpay = await post(who.agent, who.csrf, { ...invoice, expectedVersion: 2, input: { ...invoice.input, date: '2026-08-29', amountCents: 1 } })
    expect(overpay.status).toBe(409)
    expect(overpay.body.code).toBe('ALREADY_PAID')
    expect((await harness.paymentStore.list(DEMO_CLIENT_ID))[0].payments).toHaveLength(2)
  })

  it('rejects overpayment and exact duplicate posting', async () => {
    const harness = build()
    const who = await signIn(harness)
    const tooMuch = await post(who.agent, who.csrf, { ...invoice, expectedVersion: 0, input: { ...invoice.input, amountCents: 198_001 } })
    expect(tooMuch.status).toBe(422)
    expect(tooMuch.body).toMatchObject({ code: 'OVERPAYMENT', outstandingCents: 198_000 })
    const first = await post(who.agent, who.csrf, { ...invoice, expectedVersion: 0 })
    const duplicate = await post(who.agent, who.csrf, { ...invoice, expectedVersion: 1 })
    expect(first.status).toBe(201)
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.code).toBe('DUPLICATE_PAYMENT')
    expect((await harness.paymentStore.list(DEMO_CLIENT_ID))[0].payments).toHaveLength(1)
  })

  it('updates bill payable and checking with one balanced payment, then reverses with history', async () => {
    const harness = build()
    const who = await signIn(harness)
    const created = await post(who.agent, who.csrf, { ...bill, expectedVersion: 0 })
    expect(created.status).toBe(201)
    const book = created.body.book
    const payment = book.payments[0]
    expect(payment.history[0]).toMatchObject({ action: 'recorded', by: 'bookkeeper@example.com' })
    const bookId = book.id as string
    const reversed = await reverse(who.agent, who.csrf, bookId, payment.id, 1, 'Vendor sent the money back')
    expect(reversed.status).toBe(200)
    expect(reversed.body.book).toMatchObject({ version: 2, payments: [{ status: 'reversed', history: [{ action: 'recorded' }, { action: 'reversed', reason: 'Vendor sent the money back' }] }] })
    const again = await reverse(who.agent, who.csrf, bookId, payment.id, 2, 'Trying twice')
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('ALREADY_REVERSED')
  })

  it('validates payment date, amount, account, document and optimistic version', async () => {
    const harness = build()
    const who = await signIn(harness)
    expect((await post(who.agent, who.csrf, { ...invoice, expectedVersion: 0, input: { ...invoice.input, date: '2026-02-30' } })).status).toBe(400)
    expect((await post(who.agent, who.csrf, { ...invoice, expectedVersion: 0, input: { ...invoice.input, bankAccountId: 'chase-card' } })).status).toBe(400)
    expect((await post(who.agent, who.csrf, { ...invoice, expectedVersion: 4 })).body.code).toBe('CONFLICT')
    expect((await post(who.agent, who.csrf, { ...invoice, documentId: 'not-an-invoice', expectedVersion: 0 })).status).toBe(404)
    expect((await post(who.agent, who.csrf, { ...invoice, documentId: 'invoice-1003', expectedVersion: 0, input: { ...invoice.input, date: '2026-07-30' } })).body.code).toBe('ACCOUNT_RECONCILED')
  })
})
