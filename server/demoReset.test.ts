import session from 'express-session'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { DEMO_CLIENT_ID } from '../shared/demoBooks.js'
import { createRecord } from '../shared/demoEntries.js'
import { buildAdditionalDemoMonthEndRecords, buildDemoMonthEndRecords } from '../shared/demoMonthEnd.js'
import { DEMO_RESET_CLIENTS } from '../shared/demoReset.js'
import type { DemoPaymentBook } from '../shared/demoPayments.js'
import { createApp, type QuickBooksGateway } from './app.js'
import type { AuthProvider } from './authProvider.js'
import type { AppConfig } from './config.js'
import { MemoryDemoEntryStore } from './demoEntryStore.js'
import { MemoryDemoPaymentStore } from './demoPaymentStore.js'
import { MemoryDemoResetRepository } from './demoReset.js'
import { seedDemoRecords } from './demoSeed.js'
import { MemoryMonthEndStore } from './monthEndStore.js'
import { MemoryReconciliationStore } from './reconciliationStore.js'

const ORIGIN = 'http://localhost:5173'
const SMITH_ID = DEMO_RESET_CLIENTS[2].id
const GREEN_ID = DEMO_RESET_CLIENTS[1].id

function fixture() {
  const stores = {
    entries: new MemoryDemoEntryStore(),
    payments: new MemoryDemoPaymentStore(),
    reconciliations: new MemoryReconciliationStore(),
    monthEnd: new MemoryMonthEndStore(),
  }
  return stores
}

async function addMutationData(stores: ReturnType<typeof fixture>) {
  await seedDemoRecords(stores.reconciliations, stores.monthEnd)
  const entry = createRecord('manual-abc', DEMO_CLIENT_ID, { accountId: 'chase-card', type: 'charge', date: '2026-08-08', payee: 'Shop', amountCents: 1200, categoryId: 'materials', memo: '' }, 'test', '2026-10-01T00:00:00.000Z')
  await stores.entries.put(entry, 0)
  const payment: DemoPaymentBook = { id: 'abc:invoice:fixture', clientId: DEMO_CLIENT_ID, kind: 'invoice', documentId: 'fixture', version: 1, payments: [] }
  await stores.payments.put(payment, 0)
  const smithPayment: DemoPaymentBook = { ...payment, id: 'smith:invoice:fixture', clientId: SMITH_ID }
  await stores.payments.put(smithPayment, 0)
  const original = buildDemoMonthEndRecords()[0]
  await stores.monthEnd.put({ ...original, version: original.version + 1, history: [...original.history, { at: '2026-10-01T00:00:00.000Z', by: 'test', action: 'reopened', reason: 'test change' }] }, original.version)
}

describe('demo reset repository', () => {
  it('resets one client and restores its fixtures without changing other demo clients', async () => {
    const stores = fixture()
    await addMutationData(stores)
    await new MemoryDemoResetRepository(stores).reset([DEMO_CLIENT_ID])
    expect(await stores.entries.list(DEMO_CLIENT_ID)).toEqual([])
    expect(await stores.payments.list(DEMO_CLIENT_ID)).toEqual([])
    expect(await stores.payments.list(SMITH_ID)).toHaveLength(1)
    expect(await stores.monthEnd.list({ source: 'demo', clientId: DEMO_CLIENT_ID })).toEqual(buildDemoMonthEndRecords())
    expect(await stores.monthEnd.list({ source: 'demo', clientId: SMITH_ID })).toEqual(buildAdditionalDemoMonthEndRecords().filter((record) => record.clientId === SMITH_ID))
  })

  it('resets all five demo clients', async () => {
    const stores = fixture()
    await addMutationData(stores)
    await new MemoryDemoResetRepository(stores).reset(DEMO_RESET_CLIENTS.map((client) => client.id))
    for (const { id } of DEMO_RESET_CLIENTS) {
      expect(await stores.entries.list(id)).toEqual([])
      expect(await stores.payments.list(id)).toEqual([])
    }
    expect((await stores.monthEnd.list({ source: 'demo', clientId: DEMO_CLIENT_ID })).map((record) => record.id)).toEqual(buildDemoMonthEndRecords().map((record) => record.id))
    expect((await stores.monthEnd.list({ source: 'demo', clientId: GREEN_ID })).map((record) => record.id)).toEqual(buildAdditionalDemoMonthEndRecords().filter((record) => record.clientId === GREEN_ID).map((record) => record.id))
  })

  it('rolls back all in-memory store families if restoration fails', async () => {
    const stores = fixture()
    await addMutationData(stores)
    const before = {
      entries: await stores.entries.list(DEMO_CLIENT_ID),
      payments: await stores.payments.list(DEMO_CLIENT_ID),
      reconciliations: await stores.reconciliations.list({ source: 'demo', clientId: DEMO_CLIENT_ID }),
      monthEnd: await stores.monthEnd.list({ source: 'demo', clientId: DEMO_CLIENT_ID }),
    }
    const repository = new MemoryDemoResetRepository(stores, () => { throw new Error('injected failure') })
    await expect(repository.reset([DEMO_CLIENT_ID])).rejects.toThrow('injected failure')
    expect(await stores.entries.list(DEMO_CLIENT_ID)).toEqual(before.entries)
    expect(await stores.payments.list(DEMO_CLIENT_ID)).toEqual(before.payments)
    expect(await stores.reconciliations.list({ source: 'demo', clientId: DEMO_CLIENT_ID })).toEqual(before.reconciliations)
    expect(await stores.monthEnd.list({ source: 'demo', clientId: DEMO_CLIENT_ID })).toEqual(before.monthEnd)
  })
})

function appHarness() {
  const stores = fixture()
  const provider: AuthProvider = {
    beginLogin: async () => ({ url: 'https://idp.test/authorize?state=state-1', transaction: { state: 'state-1', nonce: 'n', codeVerifier: 'v' } }),
    completeLogin: async () => ({ subject: 'idp|reset', email: 'bookkeeper@example.com', emailVerified: true }),
  }
  const quickbooks = new Proxy({}, { get: (_target, name) => vi.fn(() => { throw new Error(`QuickBooks must not be called: ${String(name)}`) }) }) as unknown as QuickBooksGateway
  const config: AppConfig = { production: false, appOrigin: ORIGIN, corsOrigins: new Set([ORIGIN]), allowedEmails: new Set(['bookkeeper@example.com']), sessionSecret: 'x'.repeat(48), webRoot: '/nonexistent' }
  const app = createApp({ config, quickbooks, authProvider: provider, sessionStore: new session.MemoryStore(), demoEntryStore: stores.entries, demoPaymentStore: stores.payments, reconciliationStore: stores.reconciliations, monthEndStore: stores.monthEnd, demoResetRepository: new MemoryDemoResetRepository(stores) })
  return { app, stores }
}

async function signIn(app: ReturnType<typeof appHarness>['app']) {
  const agent = request.agent(app)
  const login = await agent.get('/api/auth/login')
  await agent.get('/api/auth/callback').query({ state: new URL(login.headers.location).searchParams.get('state'), code: 'code' })
  const csrfToken = (await agent.get('/api/auth/session')).body.csrfToken as string
  return { agent, csrfToken }
}

describe('demo reset API protection', () => {
  it('requires authentication and CSRF and leaves the session intact after a reset', async () => {
    const harness = appHarness()
    expect((await request(harness.app).post('/api/demo-reset').send({ clientIds: [DEMO_CLIENT_ID] })).status).toBe(401)
    const { agent, csrfToken } = await signIn(harness.app)
    expect((await agent.post('/api/demo-reset').send({ clientIds: [DEMO_CLIENT_ID] })).status).toBe(403)
    const reset = await agent.post('/api/demo-reset').set('X-CSRF-Token', csrfToken).send({ clientIds: [DEMO_CLIENT_ID] })
    expect(reset.status).toBe(200)
    expect((await agent.get('/api/auth/session')).body.authenticated).toBe(true)
  })

  it('rejects unknown, duplicate, or empty targets before invoking reset', async () => {
    const repository = { reset: vi.fn(async () => undefined) }
    const provider: AuthProvider = {
      beginLogin: async () => ({ url: 'https://idp.test/authorize?state=state-1', transaction: { state: 'state-1', nonce: 'n', codeVerifier: 'v' } }),
      completeLogin: async () => ({ subject: 'idp|reset', email: 'bookkeeper@example.com', emailVerified: true }),
    }
    const config: AppConfig = { production: false, appOrigin: ORIGIN, corsOrigins: new Set([ORIGIN]), allowedEmails: new Set(['bookkeeper@example.com']), sessionSecret: 'x'.repeat(48), webRoot: '/nonexistent' }
    const app = createApp({ config, quickbooks: {} as QuickBooksGateway, authProvider: provider, sessionStore: new session.MemoryStore(), demoResetRepository: repository })
    const { agent, csrfToken } = await signIn(app)
    for (const clientIds of [[], ['quickbooks-sandbox'], [DEMO_CLIENT_ID, DEMO_CLIENT_ID]]) {
      expect((await agent.post('/api/demo-reset').set('X-CSRF-Token', csrfToken).send({ clientIds })).status).toBe(400)
    }
    expect(repository.reset).not.toHaveBeenCalled()
  })
})
