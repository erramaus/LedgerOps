import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import session from 'express-session'
import { createApp, type QuickBooksGateway } from './app.js'
import type { AuthProvider } from './authProvider.js'
import type { AppConfig } from './config.js'
import * as quickbooks from './quickbooks.js'
import { exchangeCode, getListCompleteness, getReportData } from './quickbooks.js'

const ACCESS_TOKEN = 'access-token-should-never-leak'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type Call = { method: string; url: URL }
/** Stands in for QuickBooks and records every call, so the tests can prove nothing but reads happened. */
function stubQuickBooks(respond: (url: URL) => Response | Promise<Response>) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ method: init?.method ?? 'GET', url })
    if (url.pathname.includes('/oauth2/')) return json({ access_token: ACCESS_TOKEN, refresh_token: 'refresh', expires_in: 3600 })
    return respond(url)
  }))
  return calls
}

async function connect() {
  vi.stubEnv('QUICKBOOKS_CLIENT_ID', 'client')
  vi.stubEnv('QUICKBOOKS_CLIENT_SECRET', 'secret')
  vi.stubEnv('QUICKBOOKS_REDIRECT_URI', 'https://ledgerops.example.com/api/quickbooks/callback')
  vi.stubEnv('QUICKBOOKS_ENVIRONMENT', 'sandbox')
  stubQuickBooks(() => json({}))
  await exchangeCode('code', '9130350000000001')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('getReportData', () => {
  beforeAll(connect)

  const reportBody = { Header: { ReportName: 'ProfitAndLoss', StartPeriod: '2026-08-01', EndPeriod: '2026-08-31' }, Columns: { Column: [{ ColType: 'Account' }, { ColType: 'Money' }] }, Rows: { Row: [] }, Secret: 'not forwarded' }

  it.each([
    ['profit-loss', 'ProfitAndLoss'], ['balance-sheet', 'BalanceSheet'], ['cash-flow', 'CashFlow'], ['trial-balance', 'TrialBalance'], ['general-ledger', 'GeneralLedger'],
  ] as const)('%s reads %s for the exact dates, and only reads', async (key, path) => {
    const calls = stubQuickBooks(() => json(reportBody))
    await getReportData(key, '2026-08-01', '2026-08-31')
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('GET')
    expect(calls[0].url.pathname).toBe(`/v3/company/9130350000000001/reports/${path}`)
    expect(calls[0].url.searchParams.get('start_date')).toBe('2026-08-01')
    expect(calls[0].url.searchParams.get('end_date')).toBe('2026-08-31')
  })

  it('statements use the accrual method; the others do not set one', async () => {
    const calls = stubQuickBooks(() => json(reportBody))
    await getReportData('profit-loss', '2026-08-01', '2026-08-31')
    await getReportData('trial-balance', '2026-08-01', '2026-08-31')
    expect(calls[0].url.searchParams.get('accounting_method')).toBe('Accrual')
    expect(calls[1].url.searchParams.get('accounting_method')).toBeNull()
  })

  it.each([['ar-aging', 'AgedReceivables'], ['ap-aging', 'AgedPayables']] as const)('%s is dated by the month end, not by today', async (key, path) => {
    const calls = stubQuickBooks(() => json(reportBody))
    await getReportData(key, '2026-08-01', '2026-08-31')
    expect(calls[0].url.pathname).toContain(path)
    expect(calls[0].url.searchParams.get('report_date')).toBe('2026-08-31')
    expect(calls[0].url.searchParams.has('start_date')).toBe(false)
  })

  it('passes on only the header, columns and rows', async () => {
    stubQuickBooks(() => json(reportBody))
    const result = await getReportData('profit-loss', '2026-08-01', '2026-08-31')
    expect(Object.keys(result).sort()).toEqual(['Columns', 'Header', 'Rows'])
    expect(JSON.stringify(result)).not.toContain('not forwarded')
  })

  it('reports a QuickBooks failure without leaking the access token', async () => {
    stubQuickBooks(() => json({ Fault: { Error: [{ Message: `bad ${ACCESS_TOKEN}` }] } }, 400))
    const error = await getReportData('profit-loss', '2026-08-01', '2026-08-31').catch((caught: Error) => caught)
    expect((error as Error).message).toBe('QuickBooks ProfitAndLoss report failed (400).')
    expect((error as Error).message).not.toContain(ACCESS_TOKEN)
  })
})

describe('getListCompleteness', () => {
  beforeAll(connect)
  const counts = (byEntity: Record<string, number | 'error' | 'missing'>) => (url: URL) => {
    const entity = /FROM (\w+)/.exec(url.searchParams.get('query') ?? '')?.[1] ?? ''
    const value = byEntity[entity] ?? 0
    if (value === 'error') return json({}, 500)
    if (value === 'missing') return json({ QueryResponse: {} })
    return json({ QueryResponse: { totalCount: value } })
  }

  it('says everything is complete only when every record type fits in the page that is loaded', async () => {
    const calls = stubQuickBooks(counts({ Purchase: 100, Check: 3, Invoice: 1000, Bill: 12, Account: 40 }))
    const result = await getListCompleteness()
    expect(result.transactions).toEqual({ complete: true, reasons: [] })
    expect(result.invoices.complete && result.bills.complete && result.accounts.complete).toBe(true)
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
    expect(calls.every((call) => /^SELECT COUNT\(\*\) FROM \w+$/.test(call.url.searchParams.get('query') ?? ''))).toBe(true)
  })

  it('reports exactly which type is cut off and by how much', async () => {
    stubQuickBooks(counts({ Purchase: 101, Invoice: 1001 }))
    const result = await getListCompleteness()
    expect(result.transactions.complete).toBe(false)
    expect(result.transactions.reasons).toEqual(['QuickBooks has 101 Purchase records but only the first 100 are loaded.'])
    expect(result.invoices.reasons).toEqual(['QuickBooks has 1001 Invoice records but only the first 1000 are loaded.'])
    expect(result.bills.complete).toBe(true)
  })

  it('a count that cannot be obtained is never treated as complete', async () => {
    stubQuickBooks(counts({ Deposit: 'error', Bill: 'missing' }))
    const result = await getListCompleteness()
    expect(result.transactions.complete).toBe(false)
    expect(result.transactions.reasons).toEqual(['The number of Deposit records could not be confirmed.'])
    expect(result.bills).toEqual({ complete: false, reasons: ['The number of Bill records could not be confirmed.'] })
  })

  it('a network failure on one count is also unconfirmed, not zero', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('FROM%20Account') || String(input).includes('FROM+Account')) throw new Error('socket hang up')
      return json({ QueryResponse: { totalCount: 1 } })
    }))
    expect((await getListCompleteness()).accounts.complete).toBe(false)
  })
})

describe('not connected', () => {
  it('both functions refuse rather than guess', async () => {
    vi.resetModules()
    const fresh = await import('./quickbooks.js')
    await expect(fresh.getReportData('profit-loss', '2026-08-01', '2026-08-31')).rejects.toThrow('not connected')
    await expect(fresh.getListCompleteness()).rejects.toThrow('not connected')
  })
})

describe('HTTP routes', () => {
  const build = (gateway: Partial<QuickBooksGateway>) => {
    const provider: AuthProvider = {
      beginLogin: async () => ({ url: 'https://idp.test/authorize?state=state-1', transaction: { state: 'state-1', nonce: 'n', codeVerifier: 'v' } }),
      completeLogin: async () => ({ subject: 'idp|1', email: 'bookkeeper@example.com', emailVerified: true, name: 'Pat' }),
    }
    const config: AppConfig = { production: false, appOrigin: 'http://localhost:5173', corsOrigins: new Set(['http://localhost:5173']), allowedEmails: new Set(['bookkeeper@example.com']), sessionSecret: 'x'.repeat(48), webRoot: '/nonexistent' }
    return createApp({ config, quickbooks: gateway as QuickBooksGateway, authProvider: provider, sessionStore: new session.MemoryStore() })
  }
  const signIn = async (app: ReturnType<typeof build>) => {
    const agent = request.agent(app)
    const login = await agent.get('/api/auth/login')
    await agent.get('/api/auth/callback').query({ state: new URL(login.headers.location).searchParams.get('state'), code: 'code' })
    return agent
  }

  it('need a session', async () => {
    const app = build({})
    expect((await request(app).get('/api/quickbooks/report-data/profit-loss?start=2026-08-01&end=2026-08-31')).status).toBe(401)
    expect((await request(app).get('/api/quickbooks/list-completeness')).status).toBe(401)
  })

  it('validate the report name and the dates before asking QuickBooks anything', async () => {
    const getReportData = vi.fn(async () => ({ Rows: {} }))
    const agent = await signIn(build({ getReportData } as unknown as Partial<QuickBooksGateway>))
    expect((await agent.get('/api/quickbooks/report-data/payroll?start=2026-08-01&end=2026-08-31')).status).toBe(404)
    expect((await agent.get('/api/quickbooks/report-data/profit-loss?start=2026-08-01')).status).toBe(400)
    expect((await agent.get('/api/quickbooks/report-data/profit-loss?start=2026-09-01&end=2026-08-31')).status).toBe(400)
    expect((await agent.get('/api/quickbooks/report-data/profit-loss?start=2026-02-30&end=2026-08-31')).status).toBe(400)
    expect((await agent.get('/api/quickbooks/report-data/profit-loss?start=x&end=2026-08-31')).status).toBe(400)
    expect(getReportData).not.toHaveBeenCalled()
  })

  it('pass the request through, and an aging report needs only the as-of date', async () => {
    const getReportData = vi.fn(async () => ({ Rows: { Row: [] } }))
    const agent = await signIn(build({ getReportData } as unknown as Partial<QuickBooksGateway>))
    expect((await agent.get('/api/quickbooks/report-data/profit-loss?start=2026-08-01&end=2026-08-31')).body).toEqual({ report: { Rows: { Row: [] } } })
    expect(getReportData).toHaveBeenLastCalledWith('profit-loss', '2026-08-01', '2026-08-31')
    expect((await agent.get('/api/quickbooks/report-data/ar-aging?end=2026-08-31')).status).toBe(200)
    expect(getReportData).toHaveBeenLastCalledWith('ar-aging', '', '2026-08-31')
  })

  it('report a failure as an error instead of an empty report', async () => {
    const agent = await signIn(build({ getReportData: vi.fn(async () => { throw new Error('QuickBooks ProfitAndLoss report failed (500).') }), getListCompleteness: vi.fn(async () => { throw new Error('QuickBooks is not connected.') }) } as unknown as Partial<QuickBooksGateway>))
    const report = await agent.get('/api/quickbooks/report-data/profit-loss?start=2026-08-01&end=2026-08-31')
    expect(report.status).toBe(400)
    expect(report.body).toEqual({ error: 'QuickBooks ProfitAndLoss report failed (500).' })
    expect((await agent.get('/api/quickbooks/list-completeness')).body.error).toContain('not connected')
  })

  it('the module exports only read functions for these features', () => {
    expect(Object.keys(quickbooks).filter((name) => /^(getReportData|getListCompleteness)$/.test(name))).toHaveLength(2)
  })
})
