import session from 'express-session'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, type QuickBooksGateway } from './app.js'
import { loadConfig, type AppConfig } from './config.js'

const ORIGIN = 'http://localhost:5173'

function build(overrides: Partial<AppConfig> = {}, withAuth = false) {
  const getCompanyInfo = vi.fn(async () => ({ CompanyName: 'Sensitive Company LLC' }))
  const quickbooks = { getCompanyInfo, getConnectionStatus: vi.fn(() => ({ connected: true })) } as unknown as QuickBooksGateway
  const config: AppConfig = {
    production: false,
    appOrigin: ORIGIN,
    corsOrigins: new Set([ORIGIN]),
    allowedEmails: new Set(),
    sessionSecret: 'x'.repeat(48),
    webRoot: '/nonexistent',
    ...overrides,
  }
  const provider = { beginLogin: vi.fn(), completeLogin: vi.fn() }
  const app = createApp({ config, quickbooks, authProvider: withAuth ? provider : undefined, sessionStore: withAuth ? new session.MemoryStore() : undefined })
  return { app, getCompanyInfo }
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

const demoRoutes = ['/api/demo-entries', '/api/demo-journals', '/api/demo-payments', '/api/demo-workpapers', '/api/reconciliations', '/api/month-end']

describe('local demo mode (bypass enabled)', () => {
  it('reports an authenticated dev session with a CSRF token, without signing in', async () => {
    const { app } = build({ devBypassAuth: true })
    const response = await request(app).get('/api/auth/session')
    expect(response.body).toMatchObject({ configured: true, authenticated: true, devBypass: true })
    expect(response.body.csrfToken).toMatch(/^[0-9a-f]{64}$/)
  })

  it.each(demoRoutes)('%s is reachable without signing in', async (path) => {
    const { app } = build({ devBypassAuth: true })
    const response = await request(app).get(path)
    expect(response.status).not.toBe(401)
    expect(response.status).not.toBe(403)
  })

  it('still enforces CSRF on state-changing demo requests', async () => {
    const agent = request.agent(build({ devBypassAuth: true }).app)
    const { body } = await agent.get('/api/auth/session')
    expect((await agent.post('/api/demo-reset').send({})).status).toBe(403)
    expect((await agent.post('/api/demo-reset').set('Origin', 'https://evil.example').set('X-CSRF-Token', body.csrfToken).send({})).status).toBe(403)
    const allowed = await agent.post('/api/demo-reset').set('X-CSRF-Token', body.csrfToken).send({})
    expect([401, 403]).not.toContain(allowed.status)
  })

  it.each([
    ['GET', '/api/quickbooks/status'],
    ['GET', '/api/quickbooks/company'],
    ['POST', '/api/quickbooks/connect'],
    ['POST', '/api/quickbooks/transactions/Purchase/1/lines'],
    ['GET', '/api/quickbooks/a-route-added-in-the-future'],
  ])('QuickBooks route %s %s stays protected, even with a bypass session and CSRF token', async (method, path) => {
    const { app, getCompanyInfo } = build({ devBypassAuth: true })
    const agent = request.agent(app)
    const { body } = await agent.get('/api/auth/session')
    const response = await agent[method.toLowerCase() as 'get' | 'post'](path).set('X-CSRF-Token', body.csrfToken).send({})
    expect(response.status).toBe(401)
    expect(getCompanyInfo).not.toHaveBeenCalled()
  })

  it('does not give the bypass session QuickBooks access through reconciliation routes', async () => {
    const agent = request.agent(build({ devBypassAuth: true }).app)
    const { body } = await agent.get('/api/auth/session')
    const response = await agent.post('/api/reconciliations/quickbooks:1:2026-01-31/complete').set('X-CSRF-Token', body.csrfToken).send({ expectedVersion: 1 })
    expect(response.status).not.toBe(200)
  })

  it('refuses requests that are not addressed to localhost', async () => {
    const { app } = build({ devBypassAuth: true })
    const response = await request(app).get('/api/auth/session').set('Host', 'ledgerops.onrender.com')
    expect(response.body.authenticated).toBe(false)
    expect((await request(app).get('/api/demo-entries').set('Host', 'ledgerops.onrender.com')).status).toBe(401)
    expect((await request(app).get('/api/demo-entries').set('X-Forwarded-For', '203.0.113.5')).status).toBe(401)
  })

  it('does not log anyone in as a real user', async () => {
    const { app } = build({ devBypassAuth: true })
    const agent = request.agent(app)
    await agent.get('/api/auth/session')
    expect((await agent.post('/api/auth/logout').set('X-CSRF-Token', 'x')).status).toBe(401)
  })
})

describe('production and ambiguous environments cannot activate the bypass', () => {
  it('ignores the flag when the app config is production', async () => {
    const { app } = build({ devBypassAuth: true, production: true, appOrigin: 'https://ledgerops.onrender.com' })
    expect((await request(app).get('/api/demo-entries')).status).toBe(401)
    expect((await request(app).get('/api/auth/session').set('Host', 'localhost')).body.authenticated).not.toBe(true)
  })

  it('ignores the flag when the origin is not local', async () => {
    const { app } = build({ devBypassAuth: true, appOrigin: 'http://example.com' })
    expect((await request(app).get('/api/demo-entries')).status).toBe(401)
  })

  const base = { LEDGEROPS_DEV_BYPASS_AUTH: 'true', NODE_ENV: 'development', FRONTEND_URL: ORIGIN }
  it('is enabled by loadConfig only for an explicit local development environment', () => {
    expect(loadConfig(base).app.devBypassAuth).toBe(true)
  })

  it.each<[string, NodeJS.ProcessEnv]>([
    ['NODE_ENV=production', { ...base, NODE_ENV: 'production' }],
    ['NODE_ENV unset', { ...base, NODE_ENV: undefined }],
    ['NODE_ENV=test', { ...base, NODE_ENV: 'test' }],
    ['flag is "TRUE"', { ...base, LEDGEROPS_DEV_BYPASS_AUTH: 'TRUE' }],
    ['flag is "1"', { ...base, LEDGEROPS_DEV_BYPASS_AUTH: '1' }],
    ['https FRONTEND_URL', { ...base, FRONTEND_URL: 'https://ledgerops.onrender.com' }],
    ['GitHub Pages origin', { ...base, FRONTEND_URL: 'https://erramaus.github.io/LedgerOps' }],
    ['remote http origin', { ...base, FRONTEND_URL: 'http://192.168.1.20:5173' }],
    ['invalid FRONTEND_URL', { ...base, FRONTEND_URL: 'not a url' }],
    ['Render detected', { ...base, RENDER: 'true' }],
    ['Render service id', { ...base, RENDER_SERVICE_ID: 'srv-1' }],
    ['GitHub Actions', { ...base, GITHUB_ACTIONS: 'true' }],
    ['CI', { ...base, CI: 'true' }],
  ])('loadConfig refuses the bypass: %s', (_name, env) => {
    const loaded = loadConfig(env)
    expect(loaded.app.devBypassAuth).toBe(false)
    expect(loaded.devBypassRefusal).toBeTruthy()
  })

  it('is off when the variable is not set', () => {
    const loaded = loadConfig({ NODE_ENV: 'development' })
    expect(loaded.app.devBypassAuth).toBe(false)
    expect(loaded.devBypassRefusal).toBeUndefined()
  })
})

describe('authentication behaves normally when the bypass is disabled', () => {
  it('requires sign-in for demo and QuickBooks routes', async () => {
    const { app } = build({ devBypassAuth: false }, true)
    for (const path of ['/api/demo-entries', '/api/reconciliations', '/api/quickbooks/company']) {
      expect((await request(app).get(path)).status).toBe(401)
    }
    expect((await request(app).get('/api/auth/session')).body).toEqual({ configured: true, authenticated: false })
  })

  it('fails closed with no auth configured and no bypass', async () => {
    const { app } = build({})
    expect((await request(app).get('/api/demo-entries')).status).toBe(401)
    expect((await request(app).get('/api/auth/session')).body).toEqual({ configured: false, authenticated: false })
  })
})
