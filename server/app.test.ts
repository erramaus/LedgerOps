import session from 'express-session'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, type QuickBooksGateway } from './app.js'
import type { AuthProvider, Identity } from './authProvider.js'
import type { AppConfig } from './config.js'
import { TransactionUpdateError } from './transactionLines.js'

const ORIGIN = 'http://localhost:5173'
const START = 1_700_000_000_000
const MINUTE = 60_000
const HOUR = 60 * MINUTE

const bookkeeper: Identity = { subject: 'idp|1', email: 'bookkeeper@example.com', emailVerified: true, name: 'Pat Bookkeeper' }

function fakeProvider(outcome: Identity | Error = bookkeeper) {
  let counter = 0
  return {
    beginLogin: vi.fn(async () => {
      counter += 1
      return {
        url: `https://idp.test/authorize?state=state-${counter}`,
        transaction: { state: `state-${counter}`, nonce: `nonce-${counter}`, codeVerifier: `verifier-${counter}` },
      }
    }),
    completeLogin: vi.fn(async () => {
      if (outcome instanceof Error) throw outcome
      return outcome
    }),
  } satisfies AuthProvider
}

function fakeQuickBooks() {
  const mocks = {
    createAuthorizationUrl: vi.fn((state: string) => `https://appcenter.intuit.com/connect/oauth2?client_id=test&state=${state}`),
    exchangeCode: vi.fn(async (_code: string, _realmId: string) => undefined),
    getAuthorizationUrlDiagnostics: vi.fn(() => ({})),
    getConfigurationDiagnostics: vi.fn(() => ({})),
    getConnectionStatus: vi.fn(() => ({ connected: true, environment: 'sandbox' })),
    getCompanyInfo: vi.fn(async () => ({ CompanyName: 'Sensitive Company LLC' })),
    getTransactions: vi.fn(async () => [{ id: 'tx-1' }]),
    updateTransactionLines: vi.fn(async (_request: unknown) => ({ id: 'quickbooks-Purchase-42', lines: [] })),
    getAccounts: vi.fn(async () => []),
    getCustomers: vi.fn(async () => []),
    getVendors: vi.fn(async () => []),
    getInvoices: vi.fn(async () => []),
    getBills: vi.fn(async () => []),
    getFinancialReport: vi.fn(async () => ({ reportName: 'ProfitAndLoss', sections: [], totals: [] })),
  }
  return { mocks, gateway: mocks as unknown as QuickBooksGateway }
}

function build(options: { production?: boolean; outcome?: Identity | Error; authEnabled?: boolean } = {}) {
  const clock = { time: START }
  const provider = fakeProvider(options.outcome)
  const { mocks, gateway } = fakeQuickBooks()
  const store = new session.MemoryStore()
  const production = options.production ?? false
  const config: AppConfig = {
    production,
    appOrigin: production ? 'https://ledgerops.test' : ORIGIN,
    corsOrigins: new Set([ORIGIN]),
    allowedEmails: new Set(['bookkeeper@example.com']),
    sessionSecret: 'x'.repeat(48),
    webRoot: '/nonexistent',
  }
  const authEnabled = options.authEnabled ?? true
  const app = createApp({
    config,
    quickbooks: gateway,
    authProvider: authEnabled ? provider : undefined,
    sessionStore: authEnabled ? store : undefined,
    now: () => clock.time,
  })
  return { app, provider, mocks, store, clock, config }
}

type Harness = ReturnType<typeof build>

const stateFrom = (location: string) => new URL(location).searchParams.get('state') as string
const cookieValue = (setCookie: string[] | undefined) => setCookie?.find((cookie) => cookie.startsWith('ledgerops.sid='))?.split(';')[0]
const sessionCount = (store: session.MemoryStore) => new Promise<number>((resolve) => store.length!((_error, length) => resolve(length ?? 0)))

/** Completes a full login and returns the agent (holding the session cookie) plus its CSRF token. */
async function signIn(harness: Harness) {
  const agent = request.agent(harness.app)
  const login = await agent.get('/api/auth/login')
  expect(login.status).toBe(302)
  const callback = await agent.get('/api/auth/callback').query({ state: stateFrom(login.headers.location), code: 'code' })
  expect(callback.headers.location).toBe(`${harness.config.appOrigin}/`)
  const current = await agent.get('/api/auth/session')
  return { agent, csrfToken: current.body.csrfToken as string }
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

const protectedRoutes: [string, string][] = [
  ['GET', '/api/quickbooks/status'],
  ['GET', '/api/quickbooks/company'],
  ['GET', '/api/quickbooks/transactions'],
  ['GET', '/api/quickbooks/accounts'],
  ['GET', '/api/quickbooks/customers'],
  ['GET', '/api/quickbooks/vendors'],
  ['GET', '/api/quickbooks/invoices'],
  ['GET', '/api/quickbooks/bills'],
  ['GET', '/api/quickbooks/reports/profit-loss'],
  ['GET', '/api/quickbooks/callback?code=c&state=s&realmId=1'],
  ['POST', '/api/quickbooks/connect'],
  ['POST', '/api/quickbooks/transactions/Purchase/1/lines'],
  ['GET', '/api/quickbooks/a-route-added-in-the-future'],
]

describe('QuickBooks routes require authentication', () => {
  it.each(protectedRoutes)('%s %s returns 401 without a session', async (method, path) => {
    const { app, mocks } = build()
    const response = await request(app)[method.toLowerCase() as 'get' | 'post'](path).send({ accountName: 'Materials' })
    expect(response.status).toBe(401)
    expect(JSON.stringify(response.body)).not.toContain('Sensitive Company')
    Object.values(mocks).forEach((mock) => expect(mock).not.toHaveBeenCalled())
  })

  it('rejects a forged or unknown session cookie', async () => {
    const { app, mocks } = build()
    const response = await request(app).get('/api/quickbooks/company').set('Cookie', 'ledgerops.sid=s%3Aforged.invalid')
    expect(response.status).toBe(401)
    expect(mocks.getCompanyInfo).not.toHaveBeenCalled()
  })

  it('fails closed with 401 when authentication is not configured', async () => {
    const { app, mocks } = build({ authEnabled: false })
    expect((await request(app).get('/api/quickbooks/company')).status).toBe(401)
    expect((await request(app).post('/api/quickbooks/connect')).status).toBe(401)
    expect((await request(app).get('/api/auth/login')).status).toBe(503)
    expect((await request(app).get('/api/auth/session')).body).toEqual({ configured: false, authenticated: false })
    expect(mocks.getCompanyInfo).not.toHaveBeenCalled()
  })

  it('serves data to a signed-in user and marks it uncacheable', async () => {
    const harness = build()
    const { agent } = await signIn(harness)
    const response = await agent.get('/api/quickbooks/company')
    expect(response.status).toBe(200)
    expect(response.body.CompanyName).toBe('Sensitive Company LLC')
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('keeps the health check public', async () => {
    expect((await request(build().app).get('/api/health')).status).toBe(200)
  })

  it('returns 404 JSON for unknown public API paths', async () => {
    expect((await request(build().app).get('/api/unknown')).status).toBe(404)
  })
})

describe('login and sessions', () => {
  it('starts login by redirecting to the identity provider and stores only a temporary transaction', async () => {
    const harness = build()
    const response = await request(harness.app).get('/api/auth/login')
    expect(response.status).toBe(302)
    expect(response.headers.location).toMatch(/^https:\/\/idp\.test\/authorize\?state=state-1$/)
    expect(await sessionCount(harness.store)).toBe(1)
  })

  it('sets an HttpOnly, SameSite=Lax session cookie', async () => {
    const response = await request(build().app).get('/api/auth/login')
    const cookie = response.headers['set-cookie'][0]
    expect(cookie).toMatch(/^ledgerops\.sid=/)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
  })

  it('uses a __Host- prefixed Secure cookie in production', async () => {
    const response = await request(build({ production: true }).app).get('/api/auth/login').set('X-Forwarded-Proto', 'https')
    const cookie = response.headers['set-cookie'][0]
    expect(cookie).toMatch(/^__Host-ledgerops\.sid=/)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).toMatch(/Path=\//i)
    expect(cookie).not.toMatch(/Domain=/i)
  })

  it('never sets a session cookie for anonymous session checks', async () => {
    const response = await request(build().app).get('/api/auth/session')
    expect(response.body).toEqual({ configured: true, authenticated: false })
    expect(response.headers['set-cookie']).toBeUndefined()
  })

  it('issues a new session id when login completes', async () => {
    const harness = build()
    const agent = request.agent(harness.app)
    const login = await agent.get('/api/auth/login')
    const before = cookieValue(login.headers['set-cookie'])
    const callback = await agent.get('/api/auth/callback').query({ state: stateFrom(login.headers.location), code: 'code' })
    const after = cookieValue(callback.headers['set-cookie'])
    expect(before).toBeDefined()
    expect(after).toBeDefined()
    expect(after).not.toBe(before)
  })

  it('exposes only the user profile and a CSRF token for a signed-in session', async () => {
    const { agent } = await signIn(build())
    const response = await agent.get('/api/auth/session')
    expect(response.body).toMatchObject({ configured: true, authenticated: true, user: { email: 'bookkeeper@example.com', name: 'Pat Bookkeeper' } })
    expect(response.body.csrfToken).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(response.body)).not.toMatch(/token":"(?!\w{64})/)
  })

  it('accepts an allowlisted email regardless of letter case', async () => {
    const { agent } = await signIn(build({ outcome: { ...bookkeeper, email: 'Bookkeeper@Example.COM' } }))
    expect((await agent.get('/api/auth/session')).body.authenticated).toBe(true)
  })

  it('denies a verified account that is not on the allowlist', async () => {
    const harness = build({ outcome: { ...bookkeeper, email: 'stranger@example.com' } })
    const agent = request.agent(harness.app)
    const login = await agent.get('/api/auth/login')
    const callback = await agent.get('/api/auth/callback').query({ state: stateFrom(login.headers.location), code: 'code' })
    expect(callback.headers.location).toContain('auth_error=not_authorized')
    expect((await agent.get('/api/quickbooks/company')).status).toBe(401)
  })

  it('denies an allowlisted email that the identity provider has not verified', async () => {
    const harness = build({ outcome: { ...bookkeeper, emailVerified: false } })
    const agent = request.agent(harness.app)
    const login = await agent.get('/api/auth/login')
    const callback = await agent.get('/api/auth/callback').query({ state: stateFrom(login.headers.location), code: 'code' })
    expect(callback.headers.location).toContain('auth_error=not_authorized')
    expect((await agent.get('/api/auth/session')).body.authenticated).toBe(false)
  })

  it('rejects a callback whose state does not match the login transaction', async () => {
    const harness = build()
    const agent = request.agent(harness.app)
    await agent.get('/api/auth/login')
    const callback = await agent.get('/api/auth/callback').query({ state: 'attacker-state', code: 'code' })
    expect(callback.headers.location).toContain('auth_error=invalid_request')
    expect(harness.provider.completeLogin).not.toHaveBeenCalled()
  })

  it('rejects a callback that was not started from this browser session', async () => {
    const harness = build()
    const login = await request(harness.app).get('/api/auth/login')
    const callback = await request(harness.app).get('/api/auth/callback').query({ state: stateFrom(login.headers.location), code: 'code' })
    expect(callback.headers.location).toContain('auth_error=invalid_request')
    expect(harness.provider.completeLogin).not.toHaveBeenCalled()
  })

  it('rejects a replayed login callback', async () => {
    const harness = build()
    const agent = request.agent(harness.app)
    const login = await agent.get('/api/auth/login')
    const state = stateFrom(login.headers.location)
    await agent.get('/api/auth/callback').query({ state, code: 'code' })
    const replay = await agent.get('/api/auth/callback').query({ state, code: 'code' })
    expect(replay.headers.location).toContain('auth_error=invalid_request')
    expect(harness.provider.completeLogin).toHaveBeenCalledTimes(1)
  })

  it('rejects an expired login transaction', async () => {
    const harness = build()
    const agent = request.agent(harness.app)
    const login = await agent.get('/api/auth/login')
    harness.clock.time += 11 * MINUTE
    const callback = await agent.get('/api/auth/callback').query({ state: stateFrom(login.headers.location), code: 'code' })
    expect(callback.headers.location).toContain('auth_error=invalid_request')
    expect(harness.provider.completeLogin).not.toHaveBeenCalled()
  })

  it('does not sign in when the identity provider rejects the callback', async () => {
    const harness = build({ outcome: new Error('nonce mismatch') })
    const agent = request.agent(harness.app)
    const login = await agent.get('/api/auth/login')
    const callback = await agent.get('/api/auth/callback').query({ state: stateFrom(login.headers.location), code: 'code' })
    expect(callback.headers.location).toContain('auth_error=sign_in_failed')
    expect((await agent.get('/api/auth/session')).body.authenticated).toBe(false)
  })

  it('ends the session after the absolute lifetime and removes it from the store', async () => {
    const harness = build()
    const { agent } = await signIn(harness)
    expect((await agent.get('/api/quickbooks/status')).status).toBe(200)
    harness.clock.time += 13 * HOUR
    expect((await agent.get('/api/quickbooks/status')).status).toBe(401)
    expect(await sessionCount(harness.store)).toBe(0)
  })

  it('logs out only with a valid CSRF token, destroying the server-side session', async () => {
    const harness = build()
    const { agent, csrfToken } = await signIn(harness)
    expect((await agent.post('/api/auth/logout')).status).toBe(403)
    expect((await agent.get('/api/quickbooks/status')).status).toBe(200)

    const logout = await agent.post('/api/auth/logout').set('X-CSRF-Token', csrfToken)
    expect(logout.status).toBe(204)
    expect(logout.headers['set-cookie'][0]).toMatch(/^ledgerops\.sid=;/)
    expect((await agent.get('/api/quickbooks/status')).status).toBe(401)
    expect(await sessionCount(harness.store)).toBe(0)
  })

  it('treats logout without a session as unauthorized', async () => {
    expect((await request(build().app).post('/api/auth/logout')).status).toBe(401)
  })
})

describe('CSRF protection', () => {
  const url = '/api/quickbooks/transactions/Purchase/42/lines'
  const body = { syncToken: '3', expectedTotal: 150, changes: [{ lineId: '1', accountId: '77' }] }

  it('rejects state-changing requests without a token', async () => {
    const harness = build()
    const { agent } = await signIn(harness)
    const response = await agent.post(url).send(body)
    expect(response.status).toBe(403)
    expect(harness.mocks.updateTransactionLines).not.toHaveBeenCalled()
  })

  it('rejects an incorrect token', async () => {
    const harness = build()
    const { agent } = await signIn(harness)
    const response = await agent.post(url).set('X-CSRF-Token', 'f'.repeat(64)).send(body)
    expect(response.status).toBe(403)
    expect(harness.mocks.updateTransactionLines).not.toHaveBeenCalled()
  })

  it('rejects a valid token sent from a foreign origin', async () => {
    const harness = build()
    const { agent, csrfToken } = await signIn(harness)
    const response = await agent.post(url).set('Origin', 'https://evil.example').set('X-CSRF-Token', csrfToken).send(body)
    expect(response.status).toBe(403)
    expect(harness.mocks.updateTransactionLines).not.toHaveBeenCalled()
  })

  it('does not accept one session’s token for another session', async () => {
    const harness = build()
    const first = await signIn(harness)
    const second = await signIn(harness)
    expect(first.csrfToken).not.toBe(second.csrfToken)
    const response = await second.agent.post(url).set('X-CSRF-Token', first.csrfToken).send(body)
    expect(response.status).toBe(403)
  })

  it('allows the write with a valid token and same origin', async () => {
    const harness = build()
    const { agent, csrfToken } = await signIn(harness)
    const response = await agent.post(url).set('Origin', ORIGIN).set('X-CSRF-Token', csrfToken).send(body)
    expect(response.status).toBe(200)
    expect(harness.mocks.updateTransactionLines).toHaveBeenCalledWith({ transactionType: 'Purchase', transactionId: '42', syncToken: '3', expectedTotal: 150, changes: [{ lineId: '1', accountId: '77' }] })
  })

  it('rejects malformed line changes before reaching QuickBooks', async () => {
    const harness = build()
    const { agent, csrfToken } = await signIn(harness)
    const post = (payload: unknown) => agent.post(url).set('X-CSRF-Token', csrfToken).send(payload as object)
    expect((await post({})).status).toBe(400)
    expect((await post({ ...body, changes: [] })).status).toBe(400)
    expect((await post({ ...body, syncToken: '' })).status).toBe(400)
    expect((await post({ ...body, expectedTotal: '150' })).status).toBe(400)
    expect((await post({ ...body, changes: [{ lineId: '1', accountId: 'Materials' }] })).status).toBe(400)
    expect((await post({ ...body, changes: [{ lineId: '../1', accountId: '77' }] })).status).toBe(400)
    expect(harness.mocks.updateTransactionLines).not.toHaveBeenCalled()
  })

  it('maps update failures to the right status without leaking internals', async () => {
    const harness = build()
    const { agent, csrfToken } = await signIn(harness)
    const send = () => agent.post(url).set('X-CSRF-Token', csrfToken).send(body)
    harness.mocks.updateTransactionLines.mockRejectedValueOnce(new TransactionUpdateError('STALE', 409, 'changed'))
    expect(await send().then((response) => [response.status, response.body.code])).toEqual([409, 'STALE'])
    harness.mocks.updateTransactionLines.mockRejectedValueOnce(new TransactionUpdateError('UNSUPPORTED', 422, 'read-only'))
    expect(await send().then((response) => [response.status, response.body.code])).toEqual([422, 'UNSUPPORTED'])
    harness.mocks.updateTransactionLines.mockRejectedValueOnce(new Error('Bearer secret-token leaked'))
    const unexpected = await send()
    expect(unexpected.status).toBe(500)
    expect(JSON.stringify(unexpected.body)).not.toContain('secret-token')
  })

  it('no longer exposes the old overwrite-every-line route', async () => {
    const { agent, csrfToken } = await signIn(build())
    const response = await agent.post('/api/quickbooks/transactions/Purchase/42/account').set('X-CSRF-Token', csrfToken).send({ accountName: 'Materials' })
    expect(response.status).toBe(404)
  })

  it('still validates input once the token is accepted', async () => {
    const { agent, csrfToken } = await signIn(build())
    const response = await agent.post(url).set('X-CSRF-Token', csrfToken).send({})
    expect(response.status).toBe(400)
  })

  it('does not require a token for read-only requests', async () => {
    const { agent } = await signIn(build())
    expect((await agent.get('/api/quickbooks/transactions')).status).toBe(200)
  })
})

describe('QuickBooks OAuth state', () => {
  const callbackQuery = (state: string | null, extra: Record<string, string> = {}) => ({ code: 'auth-code', realmId: '9130350000000001', ...(state ? { state } : {}), ...extra })

  async function startConnection(agent: ReturnType<typeof request.agent>, csrfToken: string) {
    const response = await agent.post('/api/quickbooks/connect').set('X-CSRF-Token', csrfToken)
    expect(response.status).toBe(200)
    return stateFrom(response.body.authorizationUrl)
  }

  it('requires a CSRF token to start the connection', async () => {
    const harness = build()
    const { agent } = await signIn(harness)
    expect((await agent.post('/api/quickbooks/connect')).status).toBe(403)
    expect(harness.mocks.createAuthorizationUrl).not.toHaveBeenCalled()
  })

  it('issues an unpredictable state and returns the authorization URL as JSON', async () => {
    const harness = build()
    const { agent, csrfToken } = await signIn(harness)
    const first = await startConnection(agent, csrfToken)
    const second = await startConnection(agent, csrfToken)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(second).not.toBe(first)
  })

  it('completes the exchange when the state matches the session that started it', async () => {
    const harness = build()
    const { agent, csrfToken } = await signIn(harness)
    const state = await startConnection(agent, csrfToken)
    const response = await agent.get('/api/quickbooks/callback').query(callbackQuery(state))
    expect(response.headers.location).toBe(`${ORIGIN}/?quickbooks=connected`)
    expect(harness.mocks.exchangeCode).toHaveBeenCalledWith('auth-code', '9130350000000001')
  })

  it('rejects a replayed callback', async () => {
    const harness = build()
    const { agent, csrfToken } = await signIn(harness)
    const state = await startConnection(agent, csrfToken)
    await agent.get('/api/quickbooks/callback').query(callbackQuery(state))
    const replay = await agent.get('/api/quickbooks/callback').query(callbackQuery(state))
    expect(replay.headers.location).toBe(`${ORIGIN}/?quickbooks=error`)
    expect(harness.mocks.exchangeCode).toHaveBeenCalledTimes(1)
  })

  it('rejects a wrong state and consumes the pending state so it cannot be retried', async () => {
    const harness = build()
    const { agent, csrfToken } = await signIn(harness)
    const state = await startConnection(agent, csrfToken)
    const wrong = await agent.get('/api/quickbooks/callback').query(callbackQuery('0'.repeat(64)))
    expect(wrong.headers.location).toBe(`${ORIGIN}/?quickbooks=error`)
    const retry = await agent.get('/api/quickbooks/callback').query(callbackQuery(state))
    expect(retry.headers.location).toBe(`${ORIGIN}/?quickbooks=error`)
    expect(harness.mocks.exchangeCode).not.toHaveBeenCalled()
  })

  it('rejects a callback when no connection was started', async () => {
    const harness = build()
    const { agent } = await signIn(harness)
    const response = await agent.get('/api/quickbooks/callback').query(callbackQuery('a'.repeat(64)))
    expect(response.headers.location).toBe(`${ORIGIN}/?quickbooks=error`)
    expect(harness.mocks.exchangeCode).not.toHaveBeenCalled()
  })

  it('rejects an expired state', async () => {
    const harness = build()
    const { agent, csrfToken } = await signIn(harness)
    const state = await startConnection(agent, csrfToken)
    harness.clock.time += 11 * MINUTE
    const response = await agent.get('/api/quickbooks/callback').query(callbackQuery(state))
    expect(response.headers.location).toBe(`${ORIGIN}/?quickbooks=error`)
    expect(harness.mocks.exchangeCode).not.toHaveBeenCalled()
  })

  it('binds the state to the session that created it', async () => {
    const harness = build()
    const owner = await signIn(harness)
    const other = await signIn(harness)
    const state = await startConnection(owner.agent, owner.csrfToken)
    const stolen = await other.agent.get('/api/quickbooks/callback').query(callbackQuery(state))
    expect(stolen.headers.location).toBe(`${ORIGIN}/?quickbooks=error`)
    expect(harness.mocks.exchangeCode).not.toHaveBeenCalled()
  })

  it('does not accept a callback that carries no session at all', async () => {
    const harness = build()
    const { agent, csrfToken } = await signIn(harness)
    const state = await startConnection(agent, csrfToken)
    const response = await request(harness.app).get('/api/quickbooks/callback').query(callbackQuery(state))
    expect(response.status).toBe(401)
    expect(harness.mocks.exchangeCode).not.toHaveBeenCalled()
  })

  it('does not reflect provider-supplied error text and does not exchange a code', async () => {
    const harness = build()
    const { agent, csrfToken } = await signIn(harness)
    const state = await startConnection(agent, csrfToken)
    const response = await agent.get('/api/quickbooks/callback').query(callbackQuery(state, { error: '<script>alert(1)</script>' }))
    expect(response.headers.location).toBe(`${ORIGIN}/?quickbooks=error`)
    expect(response.text).not.toContain('<script>')
    expect(harness.mocks.exchangeCode).not.toHaveBeenCalled()
  })

  it('reports a failed token exchange without leaking details', async () => {
    const harness = build()
    harness.mocks.exchangeCode.mockRejectedValueOnce(new Error('client secret rejected: abc123'))
    const { agent, csrfToken } = await signIn(harness)
    const state = await startConnection(agent, csrfToken)
    const response = await agent.get('/api/quickbooks/callback').query(callbackQuery(state))
    expect(response.headers.location).toBe(`${ORIGIN}/?quickbooks=error`)
    expect(response.text).not.toContain('abc123')
  })
})
