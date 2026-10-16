import session from 'express-session'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { balanceAt } from '../shared/accounting.js'
import { DEMO_CLIENT_ID } from '../shared/demoBooks.js'
import { mergedLedger, type DemoEntryInput } from '../shared/demoEntries.js'
import { buildDemoMonthEndRecords } from '../shared/demoMonthEnd.js'
import { createApp, type QuickBooksGateway } from './app.js'
import type { AuthProvider } from './authProvider.js'
import type { AppConfig } from './config.js'
import { MemoryDemoEntryStore } from './demoEntryStore.js'
import { seedDemoRecords } from './demoSeed.js'
import { MemoryMonthEndStore } from './monthEndStore.js'
import { MemoryReconciliationStore } from './reconciliationStore.js'

const ORIGIN = 'http://localhost:5173'
const NOW = Date.parse('2026-10-01T12:00:00Z')
const charge: DemoEntryInput = { accountId: 'chase-card', type: 'charge', date: '2026-08-08', payee: 'Home Depot', amountCents: 22_420, categoryId: 'materials', memo: 'Pipe and fittings' }

async function build() {
  const provider: AuthProvider = {
    beginLogin: async () => ({ url: 'https://idp.test/authorize?state=state-1', transaction: { state: 'state-1', nonce: 'n', codeVerifier: 'v' } }),
    completeLogin: async () => ({ subject: 'idp|1', email: 'bookkeeper@example.com', emailVerified: true, name: 'Pat' }),
  }
  // Nothing from QuickBooks is available: any attempt to read or write there would throw, so a pass proves demo entries never touch it.
  const quickbooks = new Proxy({}, { get: (_target, name) => vi.fn(() => { throw new Error(`QuickBooks must not be called: ${String(name)}`) }) }) as unknown as QuickBooksGateway
  const reconciliations = new MemoryReconciliationStore(), monthEnd = new MemoryMonthEndStore(), entries = new MemoryDemoEntryStore()
  await seedDemoRecords(reconciliations, monthEnd)
  const config: AppConfig = { production: false, appOrigin: ORIGIN, corsOrigins: new Set([ORIGIN]), allowedEmails: new Set(['bookkeeper@example.com']), sessionSecret: 'x'.repeat(48), webRoot: '/nonexistent' }
  const app = createApp({ config, quickbooks, authProvider: provider, sessionStore: new session.MemoryStore(), reconciliationStore: reconciliations, monthEndStore: monthEnd, demoEntryStore: entries, now: () => NOW })
  return { app, reconciliations, monthEnd, entries }
}
type Harness = Awaited<ReturnType<typeof build>>

async function signIn(harness: Harness) {
  const agent = request.agent(harness.app)
  const login = await agent.get('/api/auth/login')
  await agent.get('/api/auth/callback').query({ state: new URL(login.headers.location).searchParams.get('state'), code: 'code' })
  const csrf = (await agent.get('/api/auth/session')).body.csrfToken as string
  return { agent, csrf }
}
type Session = Awaited<ReturnType<typeof signIn>>

const add = (who: Session, input: Partial<DemoEntryInput> | object = charge, extra: object = {}, clientId = DEMO_CLIENT_ID) =>
  who.agent.post('/api/demo-entries').set('X-CSRF-Token', who.csrf).send({ clientId, input, ...extra })
const change = (who: Session, id: string, action: 'edit' | 'reverse', body: object) => who.agent.post(`/api/demo-entries/${id}/${action}`).set('X-CSRF-Token', who.csrf).send(body)

describe('access control', () => {
  it('needs a session and a CSRF token, and stores nothing without them', async () => {
    const harness = await build()
    expect((await request(harness.app).get('/api/demo-entries?clientId=abc-plumbing')).status).toBe(401)
    expect((await request(harness.app).post('/api/demo-entries').send({ clientId: DEMO_CLIENT_ID, input: charge })).status).toBe(401)
    const who = await signIn(harness)
    expect((await who.agent.post('/api/demo-entries').send({ clientId: DEMO_CLIENT_ID, input: charge })).status).toBe(403)
    expect(await harness.entries.list(DEMO_CLIENT_ID)).toEqual([])
  })
})

describe('creating a missing transaction', () => {
  it('saves it with who entered it and when, never touching QuickBooks', async () => {
    const harness = await build()
    const who = await signIn(harness)
    const response = await add(who)
    expect(response.status).toBe(201)
    expect(response.body.record).toMatchObject({ clientId: DEMO_CLIENT_ID, status: 'active', version: 1, createdBy: 'bookkeeper@example.com', createdAt: '2026-10-01T12:00:00.000Z' })
    expect(response.body.record.history[0]).toMatchObject({ action: 'created', by: 'bookkeeper@example.com' })
    const listed = await who.agent.get(`/api/demo-entries?clientId=${DEMO_CLIENT_ID}`)
    expect(listed.body.records).toHaveLength(1)
    expect(listed.body.durable).toBe(false)
  })

  it('the saved record produces a balanced ledger and moves the card to the statement balance', async () => {
    const harness = await build()
    const who = await signIn(harness)
    await add(who)
    const merged = mergedLedger(await harness.entries.list(DEMO_CLIENT_ID))
    expect(balanceAt(merged.accounts, merged.entries, 'card', '2026-08-31')).toBe(623_450)
  })

  it('rejects invalid input with the reason, and saves nothing', async () => {
    const harness = await build()
    const who = await signIn(harness)
    for (const input of [{ ...charge, amountCents: 0 }, { ...charge, payee: '' }, { ...charge, date: '2026-09-15' }, { ...charge, type: 'deposit' }, { ...charge, categoryId: 'income' }, {}]) {
      const response = await add(who, input)
      expect(response.status).toBe(400)
      expect(response.body.error).toBeTruthy()
    }
    expect(await harness.entries.list(DEMO_CLIENT_ID)).toEqual([])
  })

  it('ignores any fields beyond the ones a person supplies', async () => {
    const harness = await build()
    const who = await signIn(harness)
    const response = await add(who, { ...charge, id: 'hacked', status: 'reversed', createdBy: 'someone-else' }, { actor: 'x', record: { id: 'y' } })
    expect(response.status).toBe(201)
    expect(response.body.record.id).not.toBe('hacked')
    expect(response.body.record).toMatchObject({ status: 'active', createdBy: 'bookkeeper@example.com' })
  })
})

describe('duplicate prevention', () => {
  it('stops a second entry of the same charge until it is confirmed as separate', async () => {
    const harness = await build()
    const who = await signIn(harness)
    await add(who)
    const second = await add(who)
    expect(second.status).toBe(409)
    expect(second.body.code).toBe('POSSIBLE_DUPLICATE')
    expect(await harness.entries.list(DEMO_CLIENT_ID)).toHaveLength(1)
    expect((await add(who, charge, { confirmedNotDuplicate: true })).status).toBe(201)
    expect(await harness.entries.list(DEMO_CLIENT_ID)).toHaveLength(2)
  })

  it('stops entering something that is already in the books', async () => {
    const harness = await build()
    const who = await signIn(harness)
    const response = await add(who, { ...charge, payee: 'Adobe', amountCents: 5_999, date: '2026-08-14', categoryId: 'software' })
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('POSSIBLE_DUPLICATE')
  })

  it('does not call a reversed entry a duplicate', async () => {
    const harness = await build()
    const who = await signIn(harness)
    const first = await add(who)
    expect((await change(who, first.body.record.id, 'reverse', { expectedVersion: 1, reason: 'Entered by mistake' })).status).toBe(200)
    expect((await add(who)).status).toBe(201)
  })
})

describe('period rules', () => {
  it('refuses dates inside a reconciliation that is already completed', async () => {
    const harness = await build()
    const who = await signIn(harness)
    const response = await add(who, { ...charge, date: '2026-07-15' })
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('ACCOUNT_RECONCILED')
    expect(response.body.error).toMatch(/reconciled through 2026-07-31/)
  })

  it('refuses a month that is closed', async () => {
    const harness = await build()
    const who = await signIn(harness)
    const seed = buildDemoMonthEndRecords()[0]
    await harness.monthEnd.put({ ...seed, id: `demo:${DEMO_CLIENT_ID}:2026-08`, period: '2026-08', status: 'closed', version: 1 }, 0)
    const response = await add(who)
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('PERIOD_CLOSED')
    expect(response.body.error).toMatch(/August 2026 is closed/)
  })

  it('refuses changes to an entry once its month is closed', async () => {
    const harness = await build()
    const who = await signIn(harness)
    const created = await add(who)
    const seed = buildDemoMonthEndRecords()[0]
    await harness.monthEnd.put({ ...seed, id: `demo:${DEMO_CLIENT_ID}:2026-08`, period: '2026-08', status: 'closed', version: 1 }, 0)
    expect((await change(who, created.body.record.id, 'reverse', { expectedVersion: 1, reason: 'Entered by mistake' })).status).toBe(409)
    expect((await harness.entries.get(created.body.record.id))?.status).toBe('active')
  })
})

describe('edit and reverse keep the history', () => {
  it('needs a reason and the current version', async () => {
    const harness = await build()
    const who = await signIn(harness)
    const created = await add(who)
    const id = created.body.record.id
    expect((await change(who, id, 'reverse', { expectedVersion: 1, reason: '  ' })).body.code).toBe('REASON_REQUIRED')
    expect((await change(who, id, 'edit', { expectedVersion: 1, reason: 'no', input: charge })).body.code).toBe('REASON_REQUIRED')
    expect((await change(who, id, 'reverse', { expectedVersion: 7, reason: 'Entered by mistake' })).body.code).toBe('CONFLICT')
    expect((await change(who, 'nope', 'reverse', { expectedVersion: 1, reason: 'Entered by mistake' })).status).toBe(404)
  })

  it('an edit adds a corrected entry and keeps the original and its reversal', async () => {
    const harness = await build()
    const who = await signIn(harness)
    const created = await add(who)
    const edited = await change(who, created.body.record.id, 'edit', { expectedVersion: 1, reason: 'Amount was transposed', input: { ...charge, amountCents: 22_240 } })
    expect(edited.status).toBe(200)
    expect(edited.body.record.version).toBe(2)
    expect(edited.body.record.history.map((event: { action: string }) => event.action)).toEqual(['created', 'edited'])
    const merged = mergedLedger(await harness.entries.list(DEMO_CLIENT_ID))
    expect(merged.entries.filter((entry) => entry.id.startsWith(created.body.record.id))).toHaveLength(3)
    expect(balanceAt(merged.accounts, merged.entries, 'card', '2026-08-31')).toBe(601_030 + 22_240)
  })

  it('reversing nets it to zero, keeps every entry, and cannot be done twice', async () => {
    const harness = await build()
    const who = await signIn(harness)
    const created = await add(who)
    const reversed = await change(who, created.body.record.id, 'reverse', { expectedVersion: 1, reason: 'Entered by mistake' })
    expect(reversed.status).toBe(200)
    expect(reversed.body.record.status).toBe('reversed')
    const merged = mergedLedger(await harness.entries.list(DEMO_CLIENT_ID))
    expect(balanceAt(merged.accounts, merged.entries, 'card', '2026-08-31')).toBe(601_030)
    expect(merged.entries).toHaveLength(mergedLedger([]).entries.length + 2)
    const again = await change(who, created.body.record.id, 'reverse', { expectedVersion: 2, reason: 'Entered by mistake' })
    expect(again.body.code).toBe('ALREADY_REVERSED')
  })
})

describe('client isolation', () => {
  it('posts a generated-company entry only to that company ledger', async () => {
    const harness = await build()
    const who = await signIn(harness)
    const greenCharge = { ...charge, accountId: 'green-leaf-landscaping-card', date: '2026-08-08', payee: 'Riverbend Nursery', categoryId: 'supplies' }
    const response = await add(who, greenCharge, {}, 'green-leaf-landscaping')
    expect(response.status).toBe(201)
    expect(response.body.record.clientId).toBe('green-leaf-landscaping')
    expect(await harness.entries.list('green-leaf-landscaping')).toHaveLength(1)
    expect(await harness.entries.list(DEMO_CLIENT_ID)).toEqual([])
  })

  it('lists only the requested client, and the other client sees none of the entries', async () => {
    const harness = await build()
    const who = await signIn(harness)
    await add(who)
    expect((await who.agent.get('/api/demo-entries?clientId=green-leaf-landscaping')).body.records).toEqual([])
    expect((await who.agent.get('/api/demo-entries')).status).toBe(400)
  })
})
