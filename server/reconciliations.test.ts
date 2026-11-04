import session from 'express-session'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { Completeness, ReconTxn, ReconciliationRecord } from '../shared/reconciliation.js'
import { createApp, type QuickBooksGateway } from './app.js'
import type { AuthProvider } from './authProvider.js'
import type { AppConfig } from './config.js'
import { MemoryReconciliationStore } from './reconciliationStore.js'

const ORIGIN = 'http://localhost:5173'
const NOW = Date.parse('2026-10-01T12:00:00Z')

const txn = (id: string, date: string, payee: string, dollars: number, direction: ReconTxn['direction']): ReconTxn => ({ id, date, payee, memo: '', amountCents: Math.round(dollars * 100), direction })

function build() {
  const provider: AuthProvider = {
    beginLogin: async () => ({ url: 'https://idp.test/authorize?state=state-1', transaction: { state: 'state-1', nonce: 'n', codeVerifier: 'v' } }),
    completeLogin: async () => ({ subject: 'idp|1', email: 'bookkeeper@example.com', emailVerified: true, name: 'Pat' }),
  }
  const register = { transactions: [] as ReconTxn[], completeness: { complete: true, reasons: [] } as Completeness, fail: false }
  const getReconciliationData = vi.fn(async (accountId: string, through: string) => {
    if (register.fail) throw new Error('boom')
    return { account: { id: accountId, name: 'Checking', kind: 'bank' as const }, through, transactions: register.transactions, completeness: register.completeness }
  })
  const quickbooks = { getReconciliationData } as unknown as QuickBooksGateway
  const store = new MemoryReconciliationStore()
  const config: AppConfig = { production: false, appOrigin: ORIGIN, corsOrigins: new Set([ORIGIN]), allowedEmails: new Set(['bookkeeper@example.com']), sessionSecret: 'x'.repeat(48), webRoot: '/nonexistent' }
  const app = createApp({ config, quickbooks, authProvider: provider, sessionStore: new session.MemoryStore(), reconciliationStore: store, now: () => NOW })
  return { app, store, register, getReconciliationData }
}
type Harness = ReturnType<typeof build>

async function signIn(harness: Harness) {
  const agent = request.agent(harness.app)
  const login = await agent.get('/api/auth/login')
  await agent.get('/api/auth/callback').query({ state: new URL(login.headers.location).searchParams.get('state'), code: 'code' })
  const csrf = (await agent.get('/api/auth/session')).body.csrfToken as string
  return { agent, csrf }
}

const id = (source: 'demo' | 'quickbooks', end = '2026-08-31', account = '35') => `${source}:abc-plumbing:${account}:${end}`
const transactions = [txn('d1', '2026-08-05', 'Customer', 500, 'increase'), txn('w1', '2026-08-10', 'Supplier', 120, 'decrease')]

const editable = (overrides: Record<string, unknown> = {}) => ({
  clientName: 'ABC Plumbing', accountName: 'Checking', accountKind: 'bank', periodStart: '2026-08-01', statementDate: '2026-08-31',
  beginningCents: 100000, endingCents: 138000, openingConfirmed: true, statementMode: 'manual', statementLines: [], transactions,
  clearedIds: ['d1', 'w1'], matches: [], completeness: { complete: true, reasons: [] }, ...overrides,
})

const save = (agent: ReturnType<typeof request.agent>, csrf: string, recordId: string, record: object, expectedVersion = 0) =>
  agent.put(`/api/reconciliations/${encodeURIComponent(recordId)}`).set('X-CSRF-Token', csrf).send({ record, expectedVersion })
const complete = (agent: ReturnType<typeof request.agent>, csrf: string, recordId: string, expectedVersion: number) =>
  agent.post(`/api/reconciliations/${encodeURIComponent(recordId)}/complete`).set('X-CSRF-Token', csrf).send({ expectedVersion })
const reopen = (agent: ReturnType<typeof request.agent>, csrf: string, recordId: string, expectedVersion: number, reason = 'Statement was corrected') =>
  agent.post(`/api/reconciliations/${encodeURIComponent(recordId)}/reopen`).set('X-CSRF-Token', csrf).send({ expectedVersion, reason })

describe('access control', () => {
  it.each([['GET', '/api/reconciliations/storage'], ['GET', '/api/reconciliations?source=demo&clientId=abc'], ['PUT', '/api/reconciliations/demo:abc:1:2026-08-31'], ['POST', '/api/reconciliations/demo:abc:1:2026-08-31/complete'], ['POST', '/api/reconciliations/demo:abc:1:2026-08-31/reopen']])('%s %s needs a session', async (method, path) => {
    const response = await request(build().app)[method.toLowerCase() as 'get' | 'put' | 'post'](path).send({})
    expect(response.status).toBe(401)
  })

  it('requires the CSRF token for every change', async () => {
    const harness = build()
    const { agent } = await signIn(harness)
    const recordId = id('demo')
    expect((await agent.put(`/api/reconciliations/${encodeURIComponent(recordId)}`).send({ record: editable(), expectedVersion: 0 })).status).toBe(403)
    expect((await agent.post(`/api/reconciliations/${encodeURIComponent(recordId)}/complete`).send({ expectedVersion: 1 })).status).toBe(403)
    expect((await agent.post(`/api/reconciliations/${encodeURIComponent(recordId)}/reopen`).send({ expectedVersion: 1, reason: 'a reason' })).status).toBe(403)
    expect(await harness.store.get(recordId)).toBeNull()
  })
})

describe('storage', () => {
  it('says plainly when records are temporary', async () => {
    const { agent } = await signIn(build())
    const response = await agent.get('/api/reconciliations/storage')
    expect(response.body.durable).toBe(false)
    expect(response.body.description).toMatch(/Temporary local development records.*lost when the server restarts.*DATABASE_URL/)
  })
})

describe('saving drafts', () => {
  it('stores a draft separately for each source, client, account and period', async () => {
    const harness = build()
    const { agent, csrf } = await signIn(harness)
    for (const recordId of [id('demo'), id('quickbooks'), id('demo', '2026-09-30'), id('demo', '2026-08-31', '36')]) {
      expect((await save(agent, csrf, recordId, editable({ periodStart: recordId.endsWith('09-30') ? '2026-09-01' : '2026-08-01' }))).status).toBe(200)
    }
    const demo = await agent.get('/api/reconciliations').query({ source: 'demo', clientId: 'abc-plumbing' })
    const quickbooks = await agent.get('/api/reconciliations').query({ source: 'quickbooks', clientId: 'abc-plumbing' })
    expect(demo.body.records).toHaveLength(3)
    expect(quickbooks.body.records).toHaveLength(1)
    expect(demo.body.records.every((record: ReconciliationRecord) => record.source === 'demo')).toBe(true)
    expect(demo.body.records[0].transactions).toBeUndefined()
  })

  it('sets server-owned fields itself and ignores ones the client sends', async () => {
    const harness = build()
    const { agent, csrf } = await signIn(harness)
    const response = await save(agent, csrf, id('demo'), { ...editable(), status: 'completed', completedBy: 'someone', history: [{ action: 'completed' }], version: 99, result: { differenceCents: 0 } })
    expect(response.status).toBe(200)
    expect(response.body.record).toMatchObject({ status: 'draft', version: 1, history: [] })
    expect(response.body.record.completedBy).toBeUndefined()
    expect(response.body.record.result).toBeUndefined()
  })

  it('uses the version to stop one browser overwriting another', async () => {
    const harness = build()
    const { agent, csrf } = await signIn(harness)
    await save(agent, csrf, id('demo'), editable(), 0)
    expect((await save(agent, csrf, id('demo'), editable(), 0)).body.code).toBe('CONFLICT')
    expect((await save(agent, csrf, id('demo'), editable({ endingCents: 1 }), 1)).body.record.version).toBe(2)
  })

  it('rejects malformed ids and bodies', async () => {
    const { agent, csrf } = await signIn(build())
    expect((await save(agent, csrf, 'demo:abc:1:2026-02-30', editable())).status).toBe(400)
    expect((await save(agent, csrf, 'other:abc:1:2026-08-31', editable())).status).toBe(400)
    expect((await save(agent, csrf, id('demo'), { ...editable(), endingCents: 1.5 })).status).toBe(400)
    expect((await save(agent, csrf, id('demo'), { ...editable(), accountKind: 'savings' })).status).toBe(400)
    expect((await save(agent, csrf, id('demo'), { ...editable(), transactions: [{ id: 'x' }] })).status).toBe(400)
    expect((await save(agent, csrf, id('demo'), { ...editable(), periodStart: '2026-09-15' })).status).toBe(400)
  })
})

describe('completion rules enforced by the server', () => {
  it('completes a balanced demo reconciliation and records who and when', async () => {
    const harness = build()
    const { agent, csrf } = await signIn(harness)
    const saved = await save(agent, csrf, id('demo'), editable())
    const response = await complete(agent, csrf, id('demo'), saved.body.record.version)
    expect(response.status).toBe(200)
    expect(response.body.record).toMatchObject({ status: 'completed', completedBy: 'bookkeeper@example.com', completedAt: '2026-10-01T12:00:00.000Z' })
    expect(response.body.record.result).toMatchObject({ differenceCents: 0, clearedBalanceCents: 138000, clearedCount: 2 })
    expect(response.body.record.history).toEqual([{ at: '2026-10-01T12:00:00.000Z', by: 'bookkeeper@example.com', action: 'completed', differenceCents: 0 }])
  })

  it('refuses a difference of even one cent and explains why', async () => {
    const { agent, csrf } = await signIn(build())
    const saved = await save(agent, csrf, id('demo'), editable({ endingCents: 138001 }))
    const response = await complete(agent, csrf, id('demo'), saved.body.record.version)
    expect(response.status).toBe(422)
    expect(response.body.code).toBe('NOT_COMPLETABLE')
    expect(response.body.issues[0].message).toMatch(/difference is \$0\.01/)
  })

  it('refuses a zero difference when a statement line is unmatched, and reports the blockers', async () => {
    const { agent, csrf } = await signIn(build())
    const saved = await save(agent, csrf, id('demo'), csv([{ lineId: 'l1', txnId: 'd1' }]))
    const response = await complete(agent, csrf, id('demo'), saved.body.record.version)
    expect(response.status).toBe(422)
    const codes = response.body.issues.map((issue: { code: string }) => issue.code)
    expect(codes).toContain('statement_lines_unmatched')
    expect(codes).toContain('cleared_without_line')
    expect(codes).not.toContain('not_balanced')
  })

  it('refuses zero difference when the data is flagged incomplete', async () => {
    const { agent, csrf } = await signIn(build())
    const saved = await save(agent, csrf, id('demo'), editable({ completeness: { complete: false, reasons: ['cut off'] } }))
    const response = await complete(agent, csrf, id('demo'), saved.body.record.version)
    expect(response.status).toBe(422)
    expect(response.body.issues.map((issue: { code: string }) => issue.code)).toContain('data_incomplete')
  })

  const csv = (matches: { lineId: string; txnId: string }[], lines = [
    { id: 'l1', date: '2026-08-05', description: 'CUSTOMER', amountCents: 50000, direction: 'increase' },
    { id: 'l2', date: '2026-08-10', description: 'SUPPLIER', amountCents: 12000, direction: 'decrease' },
  ]) => editable({ statementMode: 'csv', statementLines: lines, matches })

  it('completes a valid one-to-one csv matching', async () => {
    const { agent, csrf } = await signIn(build())
    const saved = await save(agent, csrf, id('demo'), csv([{ lineId: 'l1', txnId: 'd1' }, { lineId: 'l2', txnId: 'w1' }]))
    expect((await complete(agent, csrf, id('demo'), saved.body.record.version)).status).toBe(200)
  })

  it('refuses one statement line matched to two transactions', async () => {
    const { agent, csrf } = await signIn(build())
    const saved = await save(agent, csrf, id('demo'), csv([{ lineId: 'l1', txnId: 'd1' }, { lineId: 'l1', txnId: 'w1' }]))
    const response = await complete(agent, csrf, id('demo'), saved.body.record.version)
    expect(response.status).toBe(422)
    expect(response.body.issues.map((issue: { code: string }) => issue.code)).toContain('statement_line_reused')
  })

  it('refuses a match with the wrong amount or opposite direction', async () => {
    const { agent, csrf } = await signIn(build())
    const lines = [
      { id: 'l1', date: '2026-08-05', description: 'CUSTOMER', amountCents: 50000, direction: 'decrease' },
      { id: 'l2', date: '2026-08-10', description: 'SUPPLIER', amountCents: 12500, direction: 'decrease' },
    ]
    const saved = await save(agent, csrf, id('demo'), csv([{ lineId: 'l1', txnId: 'd1' }, { lineId: 'l2', txnId: 'w1' }], lines))
    const response = await complete(agent, csrf, id('demo'), saved.body.record.version)
    expect(response.status).toBe(422)
    expect(response.body.issues.map((issue: { code: string }) => issue.code)).toContain('amount_discrepancy')
  })

  it('refuses without a saved record, with a stale version, or twice', async () => {
    const { agent, csrf } = await signIn(build())
    expect((await complete(agent, csrf, id('demo'), 1)).status).toBe(404)
    const saved = await save(agent, csrf, id('demo'), editable())
    expect((await complete(agent, csrf, id('demo'), saved.body.record.version + 5)).body.code).toBe('CONFLICT')
    const done = await complete(agent, csrf, id('demo'), saved.body.record.version)
    expect((await complete(agent, csrf, id('demo'), done.body.record.version)).body.code).toBe('COMPLETED')
  })

  it('does not allow a completed record to be edited', async () => {
    const { agent, csrf } = await signIn(build())
    const saved = await save(agent, csrf, id('demo'), editable())
    const done = await complete(agent, csrf, id('demo'), saved.body.record.version)
    const response = await save(agent, csrf, id('demo'), editable({ endingCents: 1 }), done.body.record.version)
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('COMPLETED')
  })

  it('enforces the opening balance chain and period order', async () => {
    const harness = build()
    const { agent, csrf } = await signIn(harness)
    const july = editable({ periodStart: '2026-07-01', statementDate: '2026-07-31', beginningCents: 90000, endingCents: 100000, transactions: [txn('j1', '2026-07-10', 'Customer', 100, 'increase')], clearedIds: ['j1'] })
    const savedJuly = await save(agent, csrf, id('demo', '2026-07-31'), july)
    expect((await complete(agent, csrf, id('demo', '2026-07-31'), savedJuly.body.record.version)).status).toBe(200)

    const wrongOpening = await save(agent, csrf, id('demo'), editable({ beginningCents: 99000, endingCents: 137000 }))
    const blocked = await complete(agent, csrf, id('demo'), wrongOpening.body.record.version)
    expect(blocked.status).toBe(422)
    expect(blocked.body.issues.map((issue: { code: string }) => issue.code)).toContain('opening_mismatch')

    const fixed = await save(agent, csrf, id('demo'), editable(), wrongOpening.body.record.version)
    expect((await complete(agent, csrf, id('demo'), fixed.body.record.version)).status).toBe(200)

    const earlier = await save(agent, csrf, id('demo', '2026-06-30'), editable({ periodStart: '2026-06-01', statementDate: '2026-06-30' }))
    expect((await complete(agent, csrf, id('demo', '2026-06-30'), earlier.body.record.version)).body.code).toBe('OUT_OF_ORDER')
  })
})

describe('QuickBooks Sandbox reconciliations are re-checked against QuickBooks', () => {
  const qbEditable = (overrides: Record<string, unknown> = {}) => editable({ accountName: 'Sandbox Checking', ...overrides })

  it('completes when the fresh data matches what was reconciled', async () => {
    const harness = build()
    harness.register.transactions = [...transactions]
    const { agent, csrf } = await signIn(harness)
    const saved = await save(agent, csrf, id('quickbooks'), qbEditable())
    const response = await complete(agent, csrf, id('quickbooks'), saved.body.record.version)
    expect(response.status).toBe(200)
    expect(harness.getReconciliationData).toHaveBeenCalledWith('35', '2026-08-31')
  })

  it('refuses when the client says data is complete but QuickBooks says it is not', async () => {
    const harness = build()
    harness.register.transactions = [...transactions]
    harness.register.completeness = { complete: false, reasons: ['Deposit records were cut off at the page limit.'] }
    const { agent, csrf } = await signIn(harness)
    const saved = await save(agent, csrf, id('quickbooks'), qbEditable({ completeness: { complete: true, reasons: [] } }))
    const response = await complete(agent, csrf, id('quickbooks'), saved.body.record.version)
    expect(response.status).toBe(422)
    expect(response.body.issues.map((issue: { code: string }) => issue.code)).toContain('data_incomplete')
  })

  it('refuses when transactions changed in QuickBooks since they were loaded', async () => {
    const harness = build()
    harness.register.transactions = [transactions[0], txn('w1', '2026-08-10', 'Supplier', 125, 'decrease')]
    const { agent, csrf } = await signIn(harness)
    const saved = await save(agent, csrf, id('quickbooks'), qbEditable())
    const response = await complete(agent, csrf, id('quickbooks'), saved.body.record.version)
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('DATA_CHANGED')
  })

  it('refuses when QuickBooks cannot be read, and changes nothing', async () => {
    const harness = build()
    harness.register.fail = true
    const { agent, csrf } = await signIn(harness)
    const saved = await save(agent, csrf, id('quickbooks'), qbEditable())
    const response = await complete(agent, csrf, id('quickbooks'), saved.body.record.version)
    expect(response.status).toBe(502)
    expect((await harness.store.get(id('quickbooks')))?.status).toBe('draft')
  })

  it('never re-reads QuickBooks for demo reconciliations', async () => {
    const harness = build()
    const { agent, csrf } = await signIn(harness)
    const saved = await save(agent, csrf, id('demo'), editable())
    await complete(agent, csrf, id('demo'), saved.body.record.version)
    expect(harness.getReconciliationData).not.toHaveBeenCalled()
  })
})

describe('reopening and recalculating', () => {
  async function completedDemo(harness: Harness) {
    const session = await signIn(harness)
    const saved = await save(session.agent, session.csrf, id('demo'), editable())
    const done = await complete(session.agent, session.csrf, id('demo'), saved.body.record.version)
    return { ...session, version: done.body.record.version as number }
  }

  it('requires a reason and records the reopening permanently', async () => {
    const harness = build()
    const { agent, csrf, version } = await completedDemo(harness)
    expect((await reopen(agent, csrf, id('demo'), version, 'no')).body.code).toBe('REASON_REQUIRED')
    const response = await reopen(agent, csrf, id('demo'), version, 'Bank corrected the statement')
    expect(response.status).toBe(200)
    expect(response.body.record.status).toBe('draft')
    expect(response.body.record.completedAt).toBeUndefined()
    expect(response.body.record.history.map((event: { action: string }) => event.action)).toEqual(['completed', 'reopened'])
    expect(response.body.record.history[1]).toMatchObject({ by: 'bookkeeper@example.com', reason: 'Bank corrected the statement', differenceCents: 0 })
  })

  it('lets the reopened reconciliation be changed, recalculated and completed again, keeping the full history', async () => {
    const harness = build()
    const { agent, csrf, version } = await completedDemo(harness)
    const reopened = await reopen(agent, csrf, id('demo'), version)
    const changed = await save(agent, csrf, id('demo'), editable({ clearedIds: ['d1'] }), reopened.body.record.version)
    expect(changed.status).toBe(200)
    const blocked = await complete(agent, csrf, id('demo'), changed.body.record.version)
    expect(blocked.status).toBe(422)
    expect(blocked.body.issues[0].message).toMatch(/difference is \$-?120\.00|difference is -\$120\.00/)
    const fixed = await save(agent, csrf, id('demo'), editable(), changed.body.record.version)
    const again = await complete(agent, csrf, id('demo'), fixed.body.record.version)
    expect(again.status).toBe(200)
    expect(again.body.record.history.map((event: { action: string }) => event.action)).toEqual(['completed', 'reopened', 'completed'])
  })

  it('only reopens completed reconciliations, and only the latest period of an account', async () => {
    const harness = build()
    const { agent, csrf, version } = await completedDemo(harness)
    const draft = await save(agent, csrf, id('demo', '2026-09-30'), editable({ periodStart: '2026-09-01', statementDate: '2026-09-30', beginningCents: 138000, endingCents: 138000, transactions: [], clearedIds: [] }))
    expect((await reopen(agent, csrf, id('demo', '2026-09-30'), draft.body.record.version)).body.code).toBe('NOT_COMPLETED')
    const sept = await complete(agent, csrf, id('demo', '2026-09-30'), draft.body.record.version)
    expect(sept.status).toBe(200)
    expect((await reopen(agent, csrf, id('demo'), version)).body.code).toBe('OUT_OF_ORDER')
    expect((await reopen(agent, csrf, id('demo', '2026-09-30'), sept.body.record.version)).status).toBe(200)
  })

  it('does not let a stale browser reopen', async () => {
    const harness = build()
    const { agent, csrf, version } = await completedDemo(harness)
    expect((await reopen(agent, csrf, id('demo'), version - 1)).body.code).toBe('CONFLICT')
  })
})
