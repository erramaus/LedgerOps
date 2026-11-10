import session from 'express-session'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ADDITIONAL_DEMO_CLIENT_IDS } from '../shared/demoCompanyBooks.js'
import { DEMO_CLIENT_ID } from '../shared/demoBooks.js'
import { createApp, type QuickBooksGateway } from './app.js'
import type { AuthProvider, Identity } from './authProvider.js'
import type { AppConfig } from './config.js'
import { MemoryReviewDecisionStore } from './reviewDecisionStore.js'
import { validateReviewDecisionInput } from './reviewDecisions.js'

const ORIGIN = 'http://localhost:5173'
const baseInput = {
  clientId: DEMO_CLIENT_ID,
  findingId: 'uncategorized:transaction-1',
  findingType: 'categorization',
  issue: 'Missing category',
  description: 'Transaction has no category.',
  priority: 'Medium',
  status: 'reviewing',
  fingerprint: 'abc123',
  expectedVersion: 0,
  actor: 'Spoofed Name',
  actorId: 'spoofed-subject',
  id: 'spoofed-id',
  at: '2020-01-01T00:00:00.000Z',
}

function build() {
  const config: AppConfig = {
    production: false,
    appOrigin: ORIGIN,
    corsOrigins: new Set([ORIGIN]),
    allowedEmails: new Set(),
    sessionSecret: 'x'.repeat(48),
    webRoot: '/nonexistent',
    devBypassAuth: true,
  }
  const quickbooks = { getCompanyInfo: vi.fn(async () => ({ CompanyName: 'Sandbox Supply Co' })) } as unknown as QuickBooksGateway
  const reviewDecisionStore = new MemoryReviewDecisionStore()
  const app = createApp({ config, quickbooks, sessionStore: new session.MemoryStore(), reviewDecisionStore })
  return { app, reviewDecisionStore }
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('review decision input validation', () => {
  it('accepts a valid demo decision while ignoring identity and server fields', () => {
    expect(validateReviewDecisionInput(baseInput, 'demo')).toMatchObject({ ok: true, value: { clientId: DEMO_CLIENT_ID } })
  })

  it.each([
    [{ ...baseInput, clientId: 'unknown-company' }, 'The review client is not available'],
    [{ ...baseInput, findingType: 'made-up' }, 'Review decision details are invalid'],
    [{ ...baseInput, expectedVersion: -1 }, 'Review decision details are invalid'],
    [{ ...baseInput, fingerprint: '' }, 'Review decision details are invalid'],
    [{ ...baseInput, status: 'dismissed', reason: '' }, 'A reason is required'],
    [{ ...baseInput, reason: 'x'.repeat(2001) }, 'note is too long'],
  ])('rejects invalid input %#', (input, message) => {
    expect(validateReviewDecisionInput(input, 'demo')).toMatchObject({ ok: false, error: expect.stringContaining(message) })
  })

  it('rejects a demo client ID on a QuickBooks route', () => {
    expect(validateReviewDecisionInput(baseInput, 'quickbooks')).toMatchObject({ ok: false })
    expect(validateReviewDecisionInput({ ...baseInput, clientId: 'quickbooks-sandbox' }, 'quickbooks')).toMatchObject({ ok: true })
  })
})

describe('authenticated review decision API', () => {
  it('allows only known demo clients under the local development bypass and records server identity', async () => {
    const { app } = build()
    const agent = request.agent(app)
    const sessionResponse = await agent.get('/api/auth/session')
    const response = await agent.post('/api/review-decisions/demo')
      .set('X-CSRF-Token', sessionResponse.body.csrfToken)
      .send(baseInput)
    expect(response.status).toBe(201)
    expect(response.body.decision).toMatchObject({
      source: 'demo',
      clientId: DEMO_CLIENT_ID,
      version: 1,
      actor: 'Local development bypass',
    })
    expect(response.body.decision.id).not.toBe(baseInput.id)
    expect(response.body.decision.at).not.toBe(baseInput.at)
    expect(response.body.decision.actorId).toBeUndefined()
    expect((await agent.get('/api/review-decisions/demo')).body.decisions).toHaveLength(1)
  })

  it('rejects unrecognized clients, cross-source IDs, missing CSRF and stale versions', async () => {
    const { app } = build()
    const agent = request.agent(app)
    const sessionResponse = await agent.get('/api/auth/session')
    const post = (body: unknown) => agent.post('/api/review-decisions/demo').set('X-CSRF-Token', sessionResponse.body.csrfToken).send(body)
    expect((await agent.post('/api/review-decisions/demo').send(baseInput)).status).toBe(403)
    expect((await post({ ...baseInput, clientId: 'unknown-client' })).status).toBe(400)
    expect((await post({ ...baseInput, clientId: 'quickbooks-sandbox' })).status).toBe(400)
    expect((await post(baseInput)).status).toBe(201)
    expect((await post(baseInput)).status).toBe(409)
    expect((await agent.get('/api/review-decisions/demo').query({ clientId: 'unknown-client' })).status).toBe(400)
    expect((await agent.get('/api/review-decisions/demo').query({ clientId: ADDITIONAL_DEMO_CLIENT_IDS[0] })).body.decisions).toEqual([])
  })

  it('never grants QuickBooks review access to the development bypass', async () => {
    const { app } = build()
    const agent = request.agent(app)
    const sessionResponse = await agent.get('/api/auth/session')
    expect((await agent.get('/api/review-decisions/quickbooks')).status).toBe(401)
    expect((await agent.post('/api/review-decisions/quickbooks')
      .set('X-CSRF-Token', sessionResponse.body.csrfToken)
      .send({ ...baseInput, source: 'quickbooks', clientId: 'quickbooks-sandbox' })).status).toBe(401)
  })

  it('requires a real session without the bypass and records the authenticated subject for QuickBooks', async () => {
    const identity: Identity = { subject: 'oidc|reviewer', email: 'reviewer@example.com', emailVerified: true, name: 'Reviewer' }
    const authProvider: AuthProvider = {
      beginLogin: async () => ({
        url: 'https://identity.example/authorize?state=review-state',
        transaction: { state: 'review-state', nonce: 'nonce', codeVerifier: 'verifier' },
      }),
      completeLogin: async () => identity,
    }
    const config: AppConfig = {
      production: false,
      appOrigin: ORIGIN,
      corsOrigins: new Set([ORIGIN]),
      allowedEmails: new Set([identity.email]),
      sessionSecret: 'x'.repeat(48),
      webRoot: '/nonexistent',
      devBypassAuth: false,
    }
    const reviewDecisionStore = new MemoryReviewDecisionStore()
    const app = createApp({
      config,
      quickbooks: {} as QuickBooksGateway,
      authProvider,
      sessionStore: new session.MemoryStore(),
      reviewDecisionStore,
    })
    const anonymous = request.agent(app)
    expect((await anonymous.get('/api/review-decisions/demo')).status).toBe(401)
    expect((await anonymous.get('/api/review-decisions/quickbooks')).status).toBe(401)

    const agent = request.agent(app)
    const login = await agent.get('/api/auth/login')
    expect(login.status).toBe(302)
    const callback = await agent.get('/api/auth/callback').query({ state: 'review-state', code: 'code' })
    expect(callback.headers.location).toBe(`${ORIGIN}/`)
    const current = await agent.get('/api/auth/session')
    expect(current.body.authenticated).toBe(true)
    const saved = await agent.post('/api/review-decisions/quickbooks')
      .set('X-CSRF-Token', current.body.csrfToken)
      .send({ ...baseInput, clientId: 'quickbooks-sandbox' })
    expect(saved.status).toBe(201)
    expect(saved.body.decision).toMatchObject({ actorId: identity.subject, actor: identity.email, source: 'quickbooks' })
  })
})
