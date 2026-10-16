import session from 'express-session'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { DEMO_CLIENT_ID } from '../shared/demoBooks.js'
import { monthEndId } from '../shared/monthEnd.js'
import { createApp, type QuickBooksGateway } from './app.js'
import type { AuthProvider } from './authProvider.js'
import type { AppConfig } from './config.js'
import { MemoryDemoJournalStore } from './demoJournalStore.js'
import { seedDemoRecords } from './demoSeed.js'
import { MemoryMonthEndStore } from './monthEndStore.js'
import { MemoryReconciliationStore } from './reconciliationStore.js'

const ORIGIN = 'http://localhost:5173'
const NOW = Date.parse('2026-10-15T12:00:00Z')
const draft = {
  date: '2026-08-31',
  description: 'Monthly depreciation',
  referenceNumber: 'ADJ-001',
  adjustmentType: 'Depreciation',
  explanation: 'Month-end depreciation.',
  lines: [
    { accountId: 'depreciation-expense', debitCents: 25_000, creditCents: 0, memo: 'Expense' },
    { accountId: 'accumulated-depreciation', debitCents: 0, creditCents: 25_000, memo: 'Contra asset' },
  ],
}

async function build() {
  const provider: AuthProvider = {
    beginLogin: async () => ({ url: 'https://idp.test/authorize?state=state-1', transaction: { state: 'state-1', nonce: 'n', codeVerifier: 'v' } }),
    completeLogin: async () => ({ subject: 'idp|1', email: 'bookkeeper@example.com', emailVerified: true, name: 'Pat' }),
  }
  const quickbooks = new Proxy({}, { get: (_target, name) => vi.fn(() => { throw new Error(`QuickBooks must not be called: ${String(name)}`) }) }) as unknown as QuickBooksGateway
  const reconciliations = new MemoryReconciliationStore()
  const monthEnd = new MemoryMonthEndStore()
  const journals = new MemoryDemoJournalStore()
  await seedDemoRecords(reconciliations, monthEnd)
  const config: AppConfig = { production: false, appOrigin: ORIGIN, corsOrigins: new Set([ORIGIN]), allowedEmails: new Set(['bookkeeper@example.com']), sessionSecret: 'x'.repeat(48), webRoot: '/nonexistent' }
  const app = createApp({ config, quickbooks, authProvider: provider, sessionStore: new session.MemoryStore(), reconciliationStore: reconciliations, monthEndStore: monthEnd, demoJournalStore: journals, now: () => NOW })
  return { app, monthEnd, journals }
}

async function signIn(app: ReturnType<typeof build> extends Promise<infer T> ? T['app'] : never) {
  const agent = request.agent(app)
  const login = await agent.get('/api/auth/login')
  await agent.get('/api/auth/callback').query({ state: new URL(login.headers.location).searchParams.get('state'), code: 'code' })
  const csrf = (await agent.get('/api/auth/session')).body.csrfToken as string
  return { agent, csrf }
}

describe('demo journals API', () => {
  it('creates drafts, posts them, and records who acted', async () => {
    const harness = await build()
    const who = await signIn(harness.app)
    const created = await who.agent.post('/api/demo-journals').set('X-CSRF-Token', who.csrf).send({ clientId: DEMO_CLIENT_ID, input: draft })
    expect(created.status).toBe(201)
    expect(created.body.record).toMatchObject({ status: 'Draft', createdBy: 'bookkeeper@example.com' })
    const posted = await who.agent.post(`/api/demo-journals/${created.body.record.id}/post`).set('X-CSRF-Token', who.csrf).send({ expectedVersion: created.body.record.version })
    expect(posted.status).toBe(200)
    expect(posted.body.record).toMatchObject({ status: 'Posted', postedBy: 'bookkeeper@example.com' })
  })

  it('blocks posting into a closed period and allows reversing only posted entries', async () => {
    const harness = await build()
    await harness.monthEnd.put({ id: monthEndId('demo', DEMO_CLIENT_ID, '2026-08'), source: 'demo', clientId: DEMO_CLIENT_ID, period: '2026-08', status: 'closed', version: 1, updatedAt: '2026-10-15T12:00:00.000Z', history: [], signoffs: {}, closing: { at: '2026-10-15T12:00:00.000Z', by: 'bookkeeper@example.com' } }, 0)
    const who = await signIn(harness.app)
    const created = await who.agent.post('/api/demo-journals').set('X-CSRF-Token', who.csrf).send({ clientId: DEMO_CLIENT_ID, input: draft })
    const posted = await who.agent.post(`/api/demo-journals/${created.body.record.id}/post`).set('X-CSRF-Token', who.csrf).send({ expectedVersion: created.body.record.version })
    expect(posted.status).toBe(409)
    expect(posted.body.code).toBe('PERIOD_CLOSED')
    const reversedDraft = await who.agent.post(`/api/demo-journals/${created.body.record.id}/reverse`).set('X-CSRF-Token', who.csrf).send({ expectedVersion: created.body.record.version, reason: 'test' })
    expect(reversedDraft.status).toBe(409)
  })
})
