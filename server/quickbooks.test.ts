import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from './config.js'
import { createAuthorizationUrl, exchangeCode } from './quickbooks.js'

const completeEnv = {
  FRONTEND_URL: 'https://ledgerops.example.com',
  SESSION_SECRET: 's'.repeat(40),
  OIDC_ISSUER_URL: 'https://idp.example.com/',
  OIDC_CLIENT_ID: 'client',
  OIDC_CLIENT_SECRET: 'secret',
  AUTH_ALLOWED_EMAILS: ' Pat@Example.com , sam@example.com ',
  DATABASE_URL: 'postgres://user:pass@db.example.com/ledgerops',
} as unknown as NodeJS.ProcessEnv

describe('loadConfig', () => {
  it('accepts a complete production configuration and derives the OIDC redirect URI', () => {
    const loaded = loadConfig(completeEnv)
    expect(loaded.missing).toEqual([])
    expect(loaded.app.production).toBe(true)
    expect(loaded.app.allowedEmails).toEqual(new Set(['pat@example.com', 'sam@example.com']))
    expect(loaded.oidc?.redirectUri).toBe('https://ledgerops.example.com/api/auth/callback')
  })

  it('reports every missing setting so authentication fails closed', () => {
    const { missing } = loadConfig({ FRONTEND_URL: 'https://ledgerops.example.com' } as unknown as NodeJS.ProcessEnv)
    expect(missing.join(' ')).toMatch(/SESSION_SECRET/)
    expect(missing).toEqual(expect.arrayContaining(['OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'AUTH_ALLOWED_EMAILS', 'DATABASE_URL']))
  })

  it('rejects a short session secret', () => {
    const { missing } = loadConfig({ ...completeEnv, SESSION_SECRET: 'too-short' } as unknown as NodeJS.ProcessEnv)
    expect(missing.join(' ')).toMatch(/SESSION_SECRET/)
  })

  it('requires an allowlist rather than admitting every account the identity provider knows', () => {
    const { missing } = loadConfig({ ...completeEnv, AUTH_ALLOWED_EMAILS: ' , ' } as unknown as NodeJS.ProcessEnv)
    expect(missing).toContain('AUTH_ALLOWED_EMAILS')
  })

  it('does not require a database outside production', () => {
    const loaded = loadConfig({ ...completeEnv, FRONTEND_URL: 'http://localhost:5173', DATABASE_URL: '' } as unknown as NodeJS.ProcessEnv)
    expect(loaded.app.production).toBe(false)
    expect(loaded.missing).toEqual([])
  })
})

describe('QuickBooks sandbox restriction', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const stubQuickBooksEnv = (environment: string) => {
    vi.stubEnv('QUICKBOOKS_CLIENT_ID', 'client-id')
    vi.stubEnv('QUICKBOOKS_CLIENT_SECRET', 'client-secret')
    vi.stubEnv('QUICKBOOKS_REDIRECT_URI', 'https://ledgerops.example.com/api/quickbooks/callback')
    vi.stubEnv('QUICKBOOKS_ENVIRONMENT', environment)
  }

  it('builds the authorization URL with the caller-supplied state', () => {
    stubQuickBooksEnv('sandbox')
    const url = new URL(createAuthorizationUrl('opaque-state'))
    expect(url.searchParams.get('state')).toBe('opaque-state')
    expect(url.origin).toBe('https://appcenter.intuit.com')
  })

  it('refuses to start OAuth for any environment other than sandbox', () => {
    stubQuickBooksEnv('production')
    expect(() => createAuthorizationUrl('opaque-state')).toThrow(/sandbox/i)
  })

  it('rejects a malformed company id before contacting QuickBooks', async () => {
    stubQuickBooksEnv('sandbox')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(exchangeCode('code', '../../evil')).rejects.toThrow(/company identifier/i)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
