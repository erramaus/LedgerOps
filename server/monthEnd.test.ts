import session from 'express-session'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { DEMO_CLIENT_ID } from '../shared/demoBooks.js'
import { buildAdditionalDemoMonthEndRecords, buildAdditionalDemoReconciliations, buildDemoMonthEndRecords, buildDemoReconciliations, demoMonthEndInputs } from '../shared/demoMonthEnd.js'
import { buildChecklist, STEP_ORDER, validateClose, type MonthEndRecord } from '../shared/monthEnd.js'
import { parsePeriodKey } from '../shared/period.js'
import { createApp, type QuickBooksGateway } from './app.js'
import type { AuthProvider } from './authProvider.js'
import type { AppConfig } from './config.js'
import { seedDemoRecords } from './demoSeed.js'
import { MemoryMonthEndStore } from './monthEndStore.js'
import { MemoryReconciliationStore } from './reconciliationStore.js'

const ORIGIN = 'http://localhost:5173'
const NOW = Date.parse('2026-10-01T12:00:00Z')

type Account = { quickBooksId?: string; name: string; accountType: string; active: boolean }
const qbAccounts: Account[] = [
  { quickBooksId: '35', name: 'Checking', accountType: 'Bank', active: true },
  { quickBooksId: '41', name: 'Visa', accountType: 'Credit Card', active: true },
  { quickBooksId: '99', name: 'Old savings', accountType: 'Bank', active: false },
  { quickBooksId: '7', name: 'Office Supplies', accountType: 'Expense', active: true },
]

function build(options: { accounts?: Account[] | Error } = {}) {
  const provider: AuthProvider = {
    beginLogin: async () => ({ url: 'https://idp.test/authorize?state=state-1', transaction: { state: 'state-1', nonce: 'n', codeVerifier: 'v' } }),
    completeLogin: async () => ({ subject: 'idp|1', email: 'bookkeeper@example.com', emailVerified: true, name: 'Pat' }),
  }
  // Only account listing is available: any attempt to read or change anything else in QuickBooks would throw.
  const getAccounts = vi.fn(async () => {
    if (options.accounts instanceof Error) throw options.accounts
    return options.accounts ?? qbAccounts
  })
  const quickbooks = { getAccounts } as unknown as QuickBooksGateway
  const reconciliations = new MemoryReconciliationStore()
  const monthEnd = new MemoryMonthEndStore()
  const config: AppConfig = { production: false, appOrigin: ORIGIN, corsOrigins: new Set([ORIGIN]), allowedEmails: new Set(['bookkeeper@example.com']), sessionSecret: 'x'.repeat(48), webRoot: '/nonexistent' }
  const create = () => createApp({ config, quickbooks, authProvider: provider, sessionStore: new session.MemoryStore(), reconciliationStore: reconciliations, monthEndStore: monthEnd, now: () => NOW })
  return { app: create(), create, reconciliations, monthEnd, getAccounts }
}
type Harness = ReturnType<typeof build>
type Agent = ReturnType<typeof request.agent>

async function signIn(harness: Harness | { app: ReturnType<typeof createApp> }) {
  const agent = request.agent(harness.app)
  const login = await agent.get('/api/auth/login')
  await agent.get('/api/auth/callback').query({ state: new URL(login.headers.location).searchParams.get('state'), code: 'code' })
  const csrf = (await agent.get('/api/auth/session')).body.csrfToken as string
  return { agent, csrf }
}

const id = (period: string, source: 'demo' | 'quickbooks' = 'demo', client = DEMO_CLIENT_ID) => `${source}:${client}:${period}`
const url = (recordId: string, action = '') => `/api/month-end/${encodeURIComponent(recordId)}${action}`
const post = (agent: Agent, csrf: string, recordId: string, action: string, body: object) => agent.post(url(recordId, action)).set('X-CSRF-Token', csrf).send(body)
const signoff = (agent: Agent, csrf: string, recordId: string, step: string, expectedVersion: number, extra: Record<string, unknown> = {}) =>
  post(agent, csrf, recordId, '/signoff', { step, expectedVersion, note: '', fingerprint: `fp:${step}`, figures: 'figures', clientName: 'ABC Plumbing', ...extra })

/** Signs off, through the API, every step the shared checklist asks a person to confirm for a demo month. */
async function signEverything(agent: Agent, csrf: string, harness: Harness, period: string) {
  const recordId = id(period)
  for (let round = 0; round < 8; round += 1) {
    const stored = await harness.monthEnd.get(recordId)
    const inputs = demoMonthEndInputs(parsePeriodKey(period)!, { records: await harness.reconciliations.list({ source: 'demo', clientId: DEMO_CLIENT_ID }), signoffs: stored?.signoffs ?? {} })
    const next = buildChecklist(inputs).items.find((item) => item.signoff?.allowed && item.status !== 'Complete')
    if (!next?.signoff) return
    const response = await signoff(agent, csrf, recordId, next.id, stored?.version ?? 0, { note: 'Reviewed and fine', fingerprint: next.signoff.fingerprint, figures: next.signoff.figures })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
  }
}

const closeBodyFor = async (harness: Harness, period: string) => {
  const stored = await harness.monthEnd.get(id(period))
  const verdict = validateClose(demoMonthEndInputs(parsePeriodKey(period)!, { records: await harness.reconciliations.list({ source: 'demo', clientId: DEMO_CLIENT_ID }), signoffs: stored?.signoffs ?? {} }))
  if (!verdict.ok) throw new Error(verdict.problems.join('; '))
  return { expectedVersion: stored!.version, checklist: verdict.closing.checklist, exceptions: verdict.closing.exceptions }
}

describe('access control', () => {
  it.each([['GET', '/api/month-end/storage'], ['GET', '/api/month-end?source=demo&clientId=abc'], ['GET', '/api/month-end/demo:abc:2026-08'], ['POST', '/api/month-end/demo:abc:2026-08/signoff'], ['POST', '/api/month-end/demo:abc:2026-08/close'], ['POST', '/api/month-end/demo:abc:2026-08/reopen']])('%s %s needs a session', async (method, path) => {
    const response = await request(build().app)[method.toLowerCase() as 'get' | 'post'](path).send({})
    expect(response.status).toBe(401)
  })

  it('requires the CSRF token for every change, and stores nothing without it', async () => {
    const harness = build()
    const { agent } = await signIn(harness)
    const recordId = id('2026-07')
    expect((await agent.post(url(recordId, '/signoff')).send({ step: 'receivables', expectedVersion: 0, note: '', fingerprint: 'a', figures: 'b', clientName: 'ABC' })).status).toBe(403)
    expect((await agent.post(url(recordId, '/close')).send({ expectedVersion: 1 })).status).toBe(403)
    expect((await agent.post(url(recordId, '/reopen')).send({ expectedVersion: 1, reason: 'a reason' })).status).toBe(403)
    expect(await harness.monthEnd.get(recordId)).toBeNull()
  })
})

describe('storage and persistence', () => {
  it('says plainly when records are temporary', async () => {
    const { agent } = await signIn(build())
    const response = await agent.get('/api/month-end/storage')
    expect(response.body.durable).toBe(false)
    expect(response.body.description).toMatch(/Temporary local development records.*lost when the server restarts.*DATABASE_URL/)
  })

  it('records survive a new application instance that shares the store', async () => {
    const harness = build()
    const first = await signIn(harness)
    expect((await signoff(first.agent, first.csrf, id('2026-07'), 'receivables', 0)).status).toBe(200)
    const second = await signIn({ app: harness.create() })
    const response = await second.agent.get(url(id('2026-07')))
    expect(response.status).toBe(200)
    expect(response.body.record.signoffs.receivables).toMatchObject({ by: 'bookkeeper@example.com', figures: 'figures' })
  })

  it('seeding adds the demo scenarios once and never overwrites real work', async () => {
    const harness = build()
    expect(await seedDemoRecords(harness.reconciliations, harness.monthEnd)).toBe(buildDemoReconciliations().length + buildDemoMonthEndRecords().length + buildAdditionalDemoReconciliations().length + buildAdditionalDemoMonthEndRecords().length)
    const may = (await harness.monthEnd.get(id('2026-05')))!
    await harness.monthEnd.put({ ...may, version: may.version + 1, clientName: 'Edited by a person' }, may.version)
    expect(await seedDemoRecords(harness.reconciliations, harness.monthEnd)).toBe(0)
    expect((await harness.monthEnd.get(id('2026-05')))!.clientName).toBe('Edited by a person')
  })
})

describe('isolation by source, client and month', () => {
  it('keeps each record separate and lists only the requested client and source', async () => {
    const harness = build()
    const { agent, csrf } = await signIn(harness)
    for (const recordId of [id('2026-07'), id('2026-08'), id('2026-07', 'quickbooks', 'quickbooks-sandbox'), id('2026-07', 'demo', 'green-leaf-landscaping')]) {
      expect((await signoff(agent, csrf, recordId, 'receivables', 0)).status).toBe(200)
    }
    const demo = await agent.get('/api/month-end').query({ source: 'demo', clientId: DEMO_CLIENT_ID })
    const other = await agent.get('/api/month-end').query({ source: 'demo', clientId: 'green-leaf-landscaping' })
    const quickbooks = await agent.get('/api/month-end').query({ source: 'quickbooks', clientId: 'quickbooks-sandbox' })
    expect(demo.body.records.map((record: MonthEndRecord) => record.period).sort()).toEqual(['2026-07', '2026-08'])
    expect(other.body.records).toHaveLength(1)
    expect(quickbooks.body.records).toHaveLength(1)
    expect([...demo.body.records, ...other.body.records].every((record: MonthEndRecord) => record.source === 'demo')).toBe(true)
    expect((await agent.get(url(id('2026-09')))).status).toBe(404)
  })

  it('rejects malformed ids, sources and periods', async () => {
    const { agent, csrf } = await signIn(build())
    expect((await agent.get(url('abc:abc:2026-13'))).status).toBe(400)
    expect((await agent.get(url('other:abc:2026-08'))).status).toBe(400)
    expect((await agent.get('/api/month-end').query({ source: 'x', clientId: 'a' })).status).toBe(400)
    expect((await signoff(agent, csrf, 'demo:abc:2026-13', 'receivables', 0)).status).toBe(400)
  })
})

describe('recording reviews', () => {
  it('records who confirmed it, when and against which figures, and appends to the history', async () => {
    const harness = build()
    const { agent, csrf } = await signIn(harness)
    const response = await signoff(agent, csrf, id('2026-07'), 'receivables', 0, { figures: '4 open items totalling $8,420.00', fingerprint: 'receivables:842000:4:1' })
    expect(response.body.record).toMatchObject({ status: 'open', version: 1, clientName: 'ABC Plumbing' })
    expect(response.body.record.signoffs.receivables).toMatchObject({ by: 'bookkeeper@example.com', fingerprint: 'receivables:842000:4:1', figures: '4 open items totalling $8,420.00' })
    expect(response.body.record.signoffs.receivables.at).toBe('2026-10-01T12:00:00.000Z')
    expect(response.body.record.history).toEqual([expect.objectContaining({ action: 'signed_off', step: 'receivables', by: 'bookkeeper@example.com' })])
  })

  it('requires a note when a known problem is being accepted', async () => {
    const { agent, csrf } = await signIn(build())
    for (const step of ['duplicates', 'missing-info', 'unusual-balances']) {
      const missing = await signoff(agent, csrf, id('2026-07'), step, 0, { note: ' hm ' })
      expect(missing.status, step).toBe(400)
      expect(missing.body.code).toBe('NOTE_REQUIRED')
    }
    expect((await signoff(agent, csrf, id('2026-07'), 'duplicates', 0, { note: 'Two real truck loads' })).status).toBe(200)
  })

  it('rejects unknown steps and uses the version so two browsers cannot overwrite each other', async () => {
    const { agent, csrf } = await signIn(build())
    expect((await signoff(agent, csrf, id('2026-07'), 'approval', 0)).status).toBe(400)
    expect((await signoff(agent, csrf, id('2026-07'), 'receivables', 0)).status).toBe(200)
    const stale = await signoff(agent, csrf, id('2026-07'), 'payables', 0)
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('CONFLICT')
    expect((await signoff(agent, csrf, id('2026-07'), 'payables', 1)).status).toBe(200)
  })

  it('a review can be withdrawn, and that is recorded too', async () => {
    const { agent, csrf } = await signIn(build())
    await signoff(agent, csrf, id('2026-07'), 'receivables', 0)
    const cleared = await post(agent, csrf, id('2026-07'), '/clear-signoff', { step: 'receivables', expectedVersion: 1 })
    expect(cleared.status).toBe(200)
    expect(cleared.body.record.signoffs.receivables).toBeUndefined()
    expect(cleared.body.record.history.map((event: { action: string }) => event.action)).toEqual(['signed_off', 'signoff_cleared'])
    expect((await post(agent, csrf, id('2026-07'), '/clear-signoff', { step: 'receivables', expectedVersion: 2 })).status).toBe(404)
  })
})

describe('closing a month', () => {
  const seeded = async () => {
    const harness = build()
    await seedDemoRecords(harness.reconciliations, harness.monthEnd)
    const session = await signIn(harness)
    return { harness, ...session }
  }

  it('closes a ready demo month and keeps who, when, the checklist, evidence, exceptions and the reconciliations relied on', async () => {
    const { harness, agent, csrf } = await seeded()
    await signEverything(agent, csrf, harness, '2026-07')
    const response = await post(agent, csrf, id('2026-07'), '/close', await closeBodyFor(harness, '2026-07'))
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    const { record } = response.body
    expect(record.status).toBe('closed')
    expect(record.closing).toMatchObject({ closedBy: 'bookkeeper@example.com', closedAt: '2026-10-01T12:00:00.000Z', exceptions: [] })
    expect(record.closing.checklist).toHaveLength(9)
    expect(record.closing.checklist.every((item: { status: string; evidence: string[] }) => item.status === 'Complete' && item.evidence.length > 0)).toBe(true)
    expect(record.closing.reconciliations.map((item: { accountId: string }) => item.accountId).sort()).toEqual(['chase-card', 'chase-checking'])
    expect(record.history.at(-1)).toMatchObject({ action: 'closed', by: 'bookkeeper@example.com' })
  })

  it('ignores reconciliations named by the browser: the stored ones are what count', async () => {
    const { harness, agent, csrf } = await seeded()
    await signEverything(agent, csrf, harness, '2026-07')
    const body = { ...(await closeBodyFor(harness, '2026-07')), reconciliations: [{ accountId: 'forged', accountName: 'Forged', recordId: 'forged', version: 9 }] }
    const response = await post(agent, csrf, id('2026-07'), '/close', body)
    expect(response.body.record.closing.reconciliations.map((item: { accountId: string }) => item.accountId)).not.toContain('forged')
  })

  it('refuses when an account has no completed reconciliation for the month, whatever the browser claims', async () => {
    const { harness, agent, csrf } = await seeded()
    await signEverything(agent, csrf, harness, '2026-08')
    const claimed = await closeBodyFor(harness, '2026-08').catch(() => null)
    expect(claimed).toBeNull() // The shared rules already refuse; now force the request through anyway.
    const forced = { expectedVersion: (await harness.monthEnd.get(id('2026-08')))!.version, exceptions: [], checklist: forgedChecklist() }
    const response = await post(agent, csrf, id('2026-08'), '/close', forced)
    expect(response.status).toBe(422)
    expect(response.body.error).toContain('does not have a completed reconciliation ending 2026-08-31')
    expect((await harness.monthEnd.get(id('2026-08')))!.status).toBe('open')
  })

  it('refuses when a reconciliation was reopened after the checklist was built', async () => {
    const { harness, agent, csrf } = await seeded()
    await signEverything(agent, csrf, harness, '2026-07')
    const body = await closeBodyFor(harness, '2026-07')
    const checking = (await harness.reconciliations.get(`demo:${DEMO_CLIENT_ID}:chase-checking:2026-07-31`))!
    await harness.reconciliations.put({ ...checking, status: 'draft', version: checking.version + 1, completedAt: undefined, completedBy: undefined, result: undefined }, checking.version)
    const response = await post(agent, csrf, id('2026-07'), '/close', body)
    expect(response.status).toBe(422)
    expect(response.body.error).toContain('Chase Business Checking')
  })

  it('refuses incomplete checklists, missing evidence and reviews that were never recorded', async () => {
    const { harness, agent, csrf } = await seeded()
    await signEverything(agent, csrf, harness, '2026-07')
    const good = await closeBodyFor(harness, '2026-07')
    const mutate = (change: (checklist: Record<string, unknown>[]) => void) => { const checklist = structuredClone(good.checklist) as unknown as Record<string, unknown>[]; change(checklist); return { ...good, checklist } }
    expect((await post(agent, csrf, id('2026-07'), '/close', mutate((list) => { list[3].status = 'In Progress' }))).status).toBe(422)
    expect((await post(agent, csrf, id('2026-07'), '/close', mutate((list) => { list[0].evidence = [] }))).status).toBe(422)
    expect((await post(agent, csrf, id('2026-07'), '/close', mutate((list) => { list.pop() }))).status).toBe(422)
    const stored = (await harness.monthEnd.get(id('2026-07')))!
    await harness.monthEnd.put({ ...stored, version: stored.version + 1, signoffs: { ...stored.signoffs, statements: undefined } }, stored.version)
    const noReview = await post(agent, csrf, id('2026-07'), '/close', { ...good, expectedVersion: stored.version + 1 })
    expect(noReview.status).toBe(422)
    expect(noReview.body.error).toContain('Review financial statements')
    expect((await harness.monthEnd.get(id('2026-07')))!.status).toBe('open')
  })

  it('cannot close a month that has not ended, a month with no demo books, or a generated month without checklist completion', async () => {
    const { harness, agent, csrf } = await seeded()
    const body = { expectedVersion: 1, exceptions: [], checklist: [] }
    await signoff(agent, csrf, id('2026-10'), 'receivables', 0)
    expect((await post(agent, csrf, id('2026-10'), '/close', body)).body.code).toBe('PERIOD_NOT_ENDED')
    await signoff(agent, csrf, id('2026-09'), 'receivables', 0)
    const noBooks = await post(agent, csrf, id('2026-09'), '/close', { ...(await closeBodyForFake()), expectedVersion: 1 })
    expect(noBooks.status).toBe(422)
    expect(noBooks.body.code).toBe('NO_BOOKS')
    await signoff(agent, csrf, id('2026-07', 'demo', 'green-leaf-landscaping'), 'receivables', 0)
    const otherClient = await post(agent, csrf, id('2026-07', 'demo', 'green-leaf-landscaping'), '/close', { ...(await closeBodyForFake()), expectedVersion: 1 })
    expect(otherClient.body.code).toBe('NOT_COMPLETABLE')
    expect(harness.getAccounts).not.toHaveBeenCalled()
  })

  it('refuses to close a month that was never reviewed, or twice', async () => {
    const { harness, agent, csrf } = await seeded()
    expect((await post(agent, csrf, id('2026-07'), '/close', { expectedVersion: 0, checklist: [], exceptions: [] })).status).toBe(404)
    await signEverything(agent, csrf, harness, '2026-07')
    const body = await closeBodyFor(harness, '2026-07')
    expect((await post(agent, csrf, id('2026-07'), '/close', body)).status).toBe(200)
    expect((await post(agent, csrf, id('2026-07'), '/close', { ...body, expectedVersion: body.expectedVersion + 1 })).body.code).toBe('CLOSED')
  })
})

const forgedChecklist = () => STEP_ORDER.filter((step) => step !== 'approval').map((step) => ({ id: step, status: 'Complete', evidence: ['receivables', 'payables', 'statements'].includes(step) ? ['Reviewed by someone.'] : ['Checked.'] }))
const closeBodyForFake = async () => ({ exceptions: [], checklist: forgedChecklist() })

describe('closing a QuickBooks month verifies every active bank and card account, read-only', () => {
  const reconciled = (accountId: string, name: string, kind: 'bank' | 'credit_card', over: Record<string, unknown> = {}) => ({
    id: `quickbooks:quickbooks-sandbox:${accountId}:2026-08-31`, source: 'quickbooks', clientId: 'quickbooks-sandbox', clientName: 'Sandbox', accountId, accountName: name, accountKind: kind,
    periodStart: '2026-08-01', periodEnd: '2026-08-31', statementDate: '2026-08-31', beginningCents: 0, endingCents: 0, openingConfirmed: true, statementMode: 'manual', statementLines: [], transactions: [], clearedIds: [], matches: [],
    completeness: { complete: true, reasons: [] }, status: 'completed', version: 2, createdAt: 'x', updatedAt: 'x', completedAt: '2026-09-02T00:00:00.000Z', completedBy: 'pat', history: [], result: { differenceCents: 0 }, ...over,
  })
  const recordId = id('2026-08', 'quickbooks', 'quickbooks-sandbox')
  const prepare = async (harness: Harness) => {
    const { agent, csrf } = await signIn(harness)
    let version = 0
    for (const step of ['receivables', 'payables', 'statements']) version = (await signoff(agent, csrf, recordId, step, version, { clientName: 'Sandbox' })).body.record.version
    return { agent, csrf, version }
  }
  const body = (version: number) => ({ expectedVersion: version, exceptions: ['1 overdue bill.'], checklist: STEP_ORDER.filter((step) => step !== 'approval').map((step) => ({ id: step, status: 'Complete', evidence: ['receivables', 'payables', 'statements'].includes(step) ? ['Reviewed by bookkeeper@example.com on 2026-09-03.'] : ['Checked.'] })) })

  it('closes when every active bank and card account has a completed reconciliation; inactive and non-bank accounts are not required', async () => {
    const harness = build()
    await harness.reconciliations.put(reconciled('35', 'Checking', 'bank') as never, 0)
    await harness.reconciliations.put(reconciled('41', 'Visa', 'credit_card') as never, 0)
    const { agent, csrf, version } = await prepare(harness)
    const response = await post(agent, csrf, recordId, '/close', body(version))
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.record.closing.reconciliations.map((item: { accountId: string }) => item.accountId)).toEqual(['35', '41'])
    expect(response.body.record.closing.exceptions).toEqual(['1 overdue bill.'])
    expect(harness.getAccounts).toHaveBeenCalledTimes(1)
  })

  it('refuses when one account is missing, and when a reconciliation has a leftover difference', async () => {
    const harness = build()
    await harness.reconciliations.put(reconciled('35', 'Checking', 'bank') as never, 0)
    const { agent, csrf, version } = await prepare(harness)
    const missing = await post(agent, csrf, recordId, '/close', body(version))
    expect(missing.status).toBe(422)
    expect(missing.body.error).toContain('Visa')
    await harness.reconciliations.put(reconciled('41', 'Visa', 'credit_card', { result: { differenceCents: 224_20 } }) as never, 0)
    expect((await post(agent, csrf, recordId, '/close', body(version))).status).toBe(422)
  })

  it('does not close when QuickBooks cannot be read, and says so', async () => {
    const harness = build({ accounts: new Error('network down') })
    const { agent, csrf, version } = await prepare(harness)
    const response = await post(agent, csrf, recordId, '/close', body(version))
    expect(response.status).toBe(502)
    expect(response.body.code).toBe('SOURCE_UNAVAILABLE')
    expect((await harness.monthEnd.get(recordId))!.status).toBe('open')
  })
})

describe('reopening', () => {
  async function closedMonth() {
    const harness = build()
    await seedDemoRecords(harness.reconciliations, harness.monthEnd)
    const { agent, csrf } = await signIn(harness)
    await signEverything(agent, csrf, harness, '2026-07')
    const closed = await post(agent, csrf, id('2026-07'), '/close', await closeBodyFor(harness, '2026-07'))
    return { harness, agent, csrf, version: closed.body.record.version as number }
  }

  it('needs a reason, then records who, when and why, and removes the closing', async () => {
    const { agent, csrf, version } = await closedMonth()
    const noReason = await post(agent, csrf, id('2026-07'), '/reopen', { expectedVersion: version, reason: '   ' })
    expect(noReason.status).toBe(400)
    expect(noReason.body.code).toBe('REASON_REQUIRED')
    const response = await post(agent, csrf, id('2026-07'), '/reopen', { expectedVersion: version, reason: 'Client sent a corrected statement' })
    expect(response.status).toBe(200)
    expect(response.body.record.status).toBe('open')
    expect(response.body.record.closing).toBeUndefined()
    expect(response.body.record.history.at(-1)).toMatchObject({ action: 'reopened', reason: 'Client sent a corrected statement', by: 'bookkeeper@example.com' })
    expect(response.body.record.history.map((event: { action: string }) => event.action)).toContain('closed')
  })

  it('a closed month cannot be edited until it is reopened, and an open month cannot be reopened', async () => {
    const { agent, csrf, version } = await closedMonth()
    expect((await signoff(agent, csrf, id('2026-07'), 'receivables', version)).body.code).toBe('CLOSED')
    expect((await post(agent, csrf, id('2026-07'), '/clear-signoff', { step: 'receivables', expectedVersion: version })).body.code).toBe('CLOSED')
    const reopened = await post(agent, csrf, id('2026-07'), '/reopen', { expectedVersion: version, reason: 'Needs another look' })
    expect((await post(agent, csrf, id('2026-07'), '/reopen', { expectedVersion: reopened.body.record.version, reason: 'Again please' })).body.code).toBe('NOT_CLOSED')
  })

  it('after a reconciliation is reopened, the month cannot be closed again until that is completed again', async () => {
    const { harness, agent, csrf, version } = await closedMonth()
    const reopened = await post(agent, csrf, id('2026-07'), '/reopen', { expectedVersion: version, reason: 'Bank corrected a charge' })
    const body = await closeBodyFor(harness, '2026-07')
    const checking = (await harness.reconciliations.get(`demo:${DEMO_CLIENT_ID}:chase-checking:2026-07-31`))!
    await harness.reconciliations.put({ ...checking, status: 'draft', version: checking.version + 1, completedAt: undefined, result: undefined }, checking.version)
    const refused = await post(agent, csrf, id('2026-07'), '/close', { ...body, expectedVersion: reopened.body.record.version })
    expect(refused.status).toBe(422)
    expect((await harness.monthEnd.get(id('2026-07')))!.status).toBe('open')
  })

  it('the sign-offs survive a reopen so unchanged figures need no repeat review', async () => {
    const { agent, csrf, version } = await closedMonth()
    const response = await post(agent, csrf, id('2026-07'), '/reopen', { expectedVersion: version, reason: 'Needs another look' })
    expect(Object.keys(response.body.record.signoffs).sort()).toEqual(expect.arrayContaining(['payables', 'receivables', 'statements']))
  })
})

describe('review evidence and exceptions', () => {
  it('accepting an exception needs a note on the server, and the evidence, as-of date and exceptions are stored with the review and in the history', async () => {
    const { agent, csrf } = await signIn(build())
    const exceptions = ['1 overdue invoice totalling $2,840.00 as of 2026-08-31.']
    const refused = await signoff(agent, csrf, id('2026-08'), 'receivables', 0, { exceptions, asOf: '2026-08-31', note: '' })
    expect(refused.status).toBe(400)
    expect(refused.body.code).toBe('NOTE_REQUIRED')
    const accepted = await signoff(agent, csrf, id('2026-08'), 'receivables', 0, { exceptions, asOf: '2026-08-31', note: 'Customer promised payment on the 5th' })
    expect(accepted.status).toBe(200)
    expect(accepted.body.record.signoffs.receivables).toMatchObject({ by: 'bookkeeper@example.com', at: '2026-10-01T12:00:00.000Z', exceptions, asOf: '2026-08-31', note: 'Customer promised payment on the 5th' })
    expect(accepted.body.record.history.at(-1)).toMatchObject({ action: 'signed_off', step: 'receivables', figures: 'figures', exceptions, note: 'Customer promised payment on the 5th' })
  })

  it('a review with no exceptions still needs no note, and records none', async () => {
    const { agent, csrf } = await signIn(build())
    const response = await signoff(agent, csrf, id('2026-07'), 'statements', 0, { exceptions: [], note: '' })
    expect(response.status).toBe(200)
    expect(response.body.record.signoffs.statements.exceptions).toBeUndefined()
  })

  it('rejects malformed exceptions and as-of dates', async () => {
    const { agent, csrf } = await signIn(build())
    expect((await signoff(agent, csrf, id('2026-07'), 'payables', 0, { exceptions: 'all of them' })).status).toBe(400)
    expect((await signoff(agent, csrf, id('2026-07'), 'payables', 0, { exceptions: [1, 2], note: 'ok ok' })).status).toBe(400)
    expect((await signoff(agent, csrf, id('2026-07'), 'payables', 0, { asOf: 'yesterday' })).status).toBe(400)
  })

  it('closing refuses a stored review that accepted an exception without a note, whatever the browser sends', async () => {
    const harness = build()
    await seedDemoRecords(harness.reconciliations, harness.monthEnd)
    const { agent, csrf } = await signIn(harness)
    await signEverything(agent, csrf, harness, '2026-07')
    const stored = (await harness.monthEnd.get(id('2026-07')))!
    await harness.monthEnd.put({ ...stored, version: stored.version + 1, signoffs: { ...stored.signoffs, receivables: { ...stored.signoffs.receivables!, note: '', exceptions: ['1 overdue invoice.'] } } }, stored.version)
    const response = await post(agent, csrf, id('2026-07'), '/close', { ...(await closeBodyFor(harness, '2026-07')), expectedVersion: stored.version + 1 })
    expect(response.status).toBe(422)
    expect(response.body.error).toContain('without a note')
    expect((await harness.monthEnd.get(id('2026-07')))!.status).toBe('open')
  })

  it('the closing event keeps the exceptions that were accepted, next to who and when', async () => {
    const harness = build()
    await seedDemoRecords(harness.reconciliations, harness.monthEnd)
    const { agent, csrf } = await signIn(harness)
    await signEverything(agent, csrf, harness, '2026-07')
    const closed = await post(agent, csrf, id('2026-07'), '/close', { ...(await closeBodyFor(harness, '2026-07')), exceptions: ['1 overdue bill totalling $100.00 as of 2026-07-31.'] })
    expect(closed.status, JSON.stringify(closed.body)).toBe(200)
    expect(closed.body.record.history.at(-1)).toMatchObject({ action: 'closed', by: 'bookkeeper@example.com', at: '2026-10-01T12:00:00.000Z', exceptions: ['1 overdue bill totalling $100.00 as of 2026-07-31.'] })
  })
})