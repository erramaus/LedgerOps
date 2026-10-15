import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { exchangeCode, getReconciliationData } from './quickbooks.js'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const deposit = (id: number, account = '35') => ({ Id: String(id), TxnDate: '2026-08-05', TotalAmt: 10, DepositToAccountRef: { value: account } })

type Plan = { counts?: Record<string, number>; pages?: Record<string, unknown[][]>; failing?: string[]; accountType?: string; active?: boolean; noAccount?: boolean }

function stub(plan: Plan = {}) {
  const queries: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname.includes('/oauth2/')) return json({ access_token: 'token', refresh_token: 'refresh', expires_in: 3600 })
    if (init?.method === 'POST') throw new Error('reconciliation must never write to QuickBooks')
    const query = url.searchParams.get('query') ?? ''
    queries.push(query)
    if (/FROM Account/.test(query)) return json({ QueryResponse: { Account: plan.noAccount ? [] : [{ Id: '35', Name: 'Checking', AccountType: plan.accountType ?? 'Bank', Active: plan.active ?? true }] } })
    const entity = /FROM (\w+)/.exec(query)![1]
    if (plan.failing?.includes(entity)) return json({}, 500)
    if (/COUNT\(\*\)/.test(query)) return json({ QueryResponse: { totalCount: plan.counts?.[entity] ?? (plan.pages?.[entity] ?? []).flat().length } })
    const start = Number(/STARTPOSITION (\d+)/.exec(query)![1])
    const page = Math.floor((start - 1) / 1000)
    return json({ QueryResponse: { [entity]: plan.pages?.[entity]?.[page] ?? [] } })
  }))
  return { queries }
}

beforeAll(async () => {
  vi.stubEnv('QUICKBOOKS_CLIENT_ID', 'client')
  vi.stubEnv('QUICKBOOKS_CLIENT_SECRET', 'secret')
  vi.stubEnv('QUICKBOOKS_REDIRECT_URI', 'https://ledgerops.example.com/api/quickbooks/callback')
  vi.stubEnv('QUICKBOOKS_ENVIRONMENT', 'sandbox')
  stub()
  await exchangeCode('code', '9130350000000001')
})
afterEach(() => vi.unstubAllGlobals())

describe('reading an account register from QuickBooks (read-only)', () => {
  it('reads every page and reports a complete result when the count matches', async () => {
    const first = Array.from({ length: 1000 }, (_, index) => deposit(index + 1))
    const second = Array.from({ length: 250 }, (_, index) => deposit(index + 1001))
    const { queries } = stub({ pages: { Deposit: [first, second] } })
    const result = await getReconciliationData('35', '2026-08-31')
    expect(result.transactions).toHaveLength(1250)
    expect(result.completeness).toEqual({ complete: true, reasons: [] })
    expect(queries.filter((query) => /SELECT \* FROM Deposit/.test(query))).toHaveLength(2)
    expect(queries.find((query) => /SELECT \* FROM Deposit/.test(query))).toContain("TxnDate <= '2026-08-31'")
  })

  it('reports an exact multiple of the page size correctly (no phantom page lost)', async () => {
    stub({ pages: { Deposit: [Array.from({ length: 1000 }, (_, index) => deposit(index + 1)), []] } })
    const result = await getReconciliationData('35', '2026-08-31')
    expect(result.transactions).toHaveLength(1000)
    expect(result.completeness.complete).toBe(true)
  })

  it('is incomplete when QuickBooks reports more records than were returned', async () => {
    stub({ pages: { Deposit: [[deposit(1)]] }, counts: { Deposit: 4 } })
    const result = await getReconciliationData('35', '2026-08-31')
    expect(result.completeness.complete).toBe(false)
    expect(result.completeness.reasons.join(' ')).toMatch(/Read 1 of 4 Deposit records/)
  })

  it('is incomplete when one entity cannot be read, and still returns what it could', async () => {
    stub({ pages: { Deposit: [[deposit(1)]] }, failing: ['Purchase'] })
    const result = await getReconciliationData('35', '2026-08-31')
    expect(result.completeness.complete).toBe(false)
    expect(result.completeness.reasons.join(' ')).toMatch(/Could not read Purchase records/)
    expect(result.transactions).toHaveLength(1)
  })

  it('is incomplete when the page cap is reached', async () => {
    const full = Array.from({ length: 1000 }, (_, index) => deposit(index + 1))
    stub({ pages: { Deposit: Array.from({ length: 25 }, () => full) }, counts: { Deposit: 25000 } })
    const result = await getReconciliationData('35', '2026-08-31')
    expect(result.completeness.complete).toBe(false)
    expect(result.completeness.reasons.join(' ')).toMatch(/cut off at the page limit/)
  })

  it('never writes to QuickBooks', async () => {
    const { queries } = stub({ pages: { Deposit: [[deposit(1)]] } })
    await getReconciliationData('35', '2026-08-31')
    expect(queries.length).toBeGreaterThan(0)
  })

  it('refuses accounts that cannot be reconciled and malformed input', async () => {
    stub({ accountType: 'Expense' })
    await expect(getReconciliationData('35', '2026-08-31')).rejects.toThrow(/bank and credit card/)
    stub({ active: false })
    await expect(getReconciliationData('35', '2026-08-31')).rejects.toThrow(/bank and credit card/)
    stub({ noAccount: true })
    await expect(getReconciliationData('35', '2026-08-31')).rejects.toThrow(/could not be found/)
    stub()
    await expect(getReconciliationData('35; DROP', '2026-08-31')).rejects.toThrow(/Invalid account/)
    await expect(getReconciliationData('35', "2026-08-31' OR '1'='1")).rejects.toThrow(/Invalid date/)
  })
})
