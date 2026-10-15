import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { exchangeCode, getTransactions, updateTransactionLines } from './quickbooks.js'
import { TransactionUpdateError, type LineChangeRequest, type QbTransaction } from './transactionLines.js'

const ACCESS_TOKEN = 'access-token-should-never-leak'

const line = (id: string, amount: number, accountId: string, accountName: string, description: string) => ({
  Id: id, Amount: amount, Description: description, DetailType: 'AccountBasedExpenseLineDetail',
  AccountBasedExpenseLineDetail: { AccountRef: { value: accountId, name: accountName } },
})

const purchase = (): QbTransaction => ({
  Id: '42', SyncToken: '5', TxnDate: '2026-08-21', TotalAmt: 286.4, AccountRef: { value: '99', name: 'Card' }, EntityRef: { name: 'Costco' },
  Line: [line('1', 120.4, '10', 'Office Supplies', 'Paper'), line('2', 64, '20', 'Meals', 'Snacks'), line('3', 102, '30', 'Uncategorized Expense', 'Cleaning')],
})

const accounts = [
  { Id: '10', Name: 'Office Supplies', AccountType: 'Expense', Active: true },
  { Id: '20', Name: 'Meals', AccountType: 'Expense', Active: true },
  { Id: '30', Name: 'Uncategorized Expense', AccountType: 'Expense', Active: true },
  { Id: '40', Name: 'Job Materials', AccountType: 'Cost of Goods Sold', Active: true },
]

const request = (overrides: Partial<LineChangeRequest> = {}): LineChangeRequest => ({
  transactionType: 'Purchase', transactionId: '42', syncToken: '5', expectedTotal: 286.4, changes: [{ lineId: '3', accountId: '40' }], ...overrides,
})

type Responder = { read?: () => Response | Promise<Response>; write?: (body: QbTransaction) => Response | Promise<Response> }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Stands in for QuickBooks; records every call so tests can prove what was (not) written. */
function stubQuickBooks(responder: Responder = {}) {
  const calls: { method: string; url: string; body?: QbTransaction }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body && !url.includes('/oauth2/') ? (JSON.parse(String(init.body)) as QbTransaction) : undefined
    calls.push({ method, url, body })
    if (url.includes('/oauth2/')) return json({ access_token: ACCESS_TOKEN, refresh_token: 'refresh', expires_in: 3600 })
    if (url.includes('/query')) return json({ QueryResponse: { Account: accounts } })
    if (method === 'POST') return responder.write ? responder.write(body!) : json({ Purchase: { ...body, SyncToken: '6' } })
    return responder.read ? responder.read() : json({ Purchase: purchase() })
  }))
  return { calls, writes: () => calls.filter((call) => call.method === 'POST' && call.url.includes('/purchase')) }
}

async function connect() {
  vi.stubEnv('QUICKBOOKS_CLIENT_ID', 'client')
  vi.stubEnv('QUICKBOOKS_CLIENT_SECRET', 'secret')
  vi.stubEnv('QUICKBOOKS_REDIRECT_URI', 'https://ledgerops.example.com/api/quickbooks/callback')
  vi.stubEnv('QUICKBOOKS_ENVIRONMENT', 'sandbox')
  stubQuickBooks()
  await exchangeCode('code', '9130350000000001')
}

async function failure(action: Promise<unknown>) {
  try {
    await action
  } catch (error) {
    expect(error).toBeInstanceOf(TransactionUpdateError)
    return error as TransactionUpdateError
  }
  throw new Error('expected the update to fail')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('without a QuickBooks connection', () => {
  it('refuses to write', async () => {
    const stub = stubQuickBooks()
    expect((await failure(updateTransactionLines(request()))).code).toBe('NOT_CONNECTED')
    expect(stub.calls).toHaveLength(0)
  })
})

describe('writing line changes to QuickBooks Sandbox', () => {
  beforeAll(async () => {
    await connect()
  })

  it('sends only the requested line change and returns the refreshed transaction', async () => {
    const stub = stubQuickBooks()
    const result = await updateTransactionLines(request())
    const [write] = stub.writes()
    expect(stub.writes()).toHaveLength(1)
    expect(write.body!.SyncToken).toBe('5')
    expect(write.body!.Line!.map((item) => item.AccountBasedExpenseLineDetail!.AccountRef!.value)).toEqual(['10', '20', '40'])
    expect(result.lines.map((item) => item.category)).toEqual(['Office Supplies', 'Meals', 'Job Materials'])
    expect(result.lines.map((item) => item.amount)).toEqual([120.4, 64, 102])
    expect(result.status).toBe('Categorized')
  })

  it('always reads the latest copy before writing', async () => {
    const stub = stubQuickBooks()
    await updateTransactionLines(request())
    const methods = stub.calls.map((call) => `${call.method} ${new URL(call.url).pathname.split('/').slice(-2).join('/')}`)
    expect(methods.indexOf('GET purchase/42')).toBeLessThan(methods.findIndex((entry) => entry.startsWith('POST')))
  })

  it('does not write a transaction with unsupported lines', async () => {
    const itemBased = purchase()
    itemBased.Line!.push({ Id: '9', Amount: 0, DetailType: 'ItemBasedExpenseLineDetail' })
    const stub = stubQuickBooks({ read: () => json({ Purchase: itemBased }) })
    expect((await failure(updateTransactionLines(request()))).code).toBe('UNSUPPORTED')
    expect(stub.writes()).toHaveLength(0)
  })

  it('does not write when the user’s copy is out of date', async () => {
    const stub = stubQuickBooks()
    expect((await failure(updateTransactionLines(request({ syncToken: '4' })))).code).toBe('STALE')
    expect(stub.writes()).toHaveLength(0)
  })

  it('does not write a transaction type that is not supported', async () => {
    const stub = stubQuickBooks()
    expect((await failure(updateTransactionLines(request({ transactionType: 'Deposit' })))).code).toBe('UNSUPPORTED')
    expect(stub.calls).toHaveLength(0)
  })

  it('rejects a malformed transaction id before any network call', async () => {
    const stub = stubQuickBooks()
    expect((await failure(updateTransactionLines(request({ transactionId: '42/../../company' })))).code).toBe('INVALID')
    expect(stub.calls).toHaveLength(0)
  })

  it('reports a missing transaction', async () => {
    const stub = stubQuickBooks({ read: () => json({}, 404) })
    expect((await failure(updateTransactionLines(request()))).code).toBe('NOT_FOUND')
    expect(stub.writes()).toHaveLength(0)
  })

  it('reports a stale-object rejection from QuickBooks', async () => {
    const stub = stubQuickBooks({ write: () => json({ Fault: { Error: [{ Message: 'Stale Object Error', code: '5010' }] } }, 400) })
    expect((await failure(updateTransactionLines(request()))).code).toBe('STALE')
    expect(stub.writes()).toHaveLength(1)
  })

  it('reports a validation rejection without retrying the write', async () => {
    const stub = stubQuickBooks({ write: () => json({ Fault: { Error: [{ Message: 'Invalid Reference Id' }] } }, 400) })
    const error = await failure(updateTransactionLines(request()))
    expect(error.code).toBe('REJECTED')
    expect(stub.writes()).toHaveLength(1)
  })

  it('reports an outage without retrying the write', async () => {
    const stub = stubQuickBooks({ write: () => json({}, 503) })
    expect((await failure(updateTransactionLines(request()))).code).toBe('UNAVAILABLE')
    expect(stub.writes()).toHaveLength(1)
  })

  it('tells the user to check the transaction when the write’s outcome is unknown', async () => {
    const stub = stubQuickBooks({ write: () => Promise.reject(new TypeError('socket hang up')) })
    const error = await failure(updateTransactionLines(request()))
    expect(error.code).toBe('UNAVAILABLE')
    expect(error.message).toMatch(/reload/i)
    expect(stub.writes()).toHaveLength(1)
  })

  it('writes nothing when QuickBooks cannot be reached for the read', async () => {
    const stub = stubQuickBooks({ read: () => Promise.reject(new TypeError('offline')) })
    expect((await failure(updateTransactionLines(request()))).code).toBe('UNAVAILABLE')
    expect(stub.writes()).toHaveLength(0)
  })

  it('flags a result that does not match what was requested', async () => {
    stubQuickBooks({ write: (body) => json({ Purchase: { ...body, Line: body.Line!.map((item) => ({ ...item, Amount: 1 })) } }) })
    expect((await failure(updateTransactionLines(request()))).code).toBe('VERIFY_FAILED')
  })

  it('never exposes the access token in an error', async () => {
    stubQuickBooks({ write: () => json({ Fault: { Error: [{ Message: `bad ${ACCESS_TOKEN}` }] } }, 400) })
    const error = await failure(updateTransactionLines(request()))
    expect(`${error.message} ${error.code}`).not.toContain('refresh')
  })

  it('lists transactions with their lines and read-only reasons', async () => {
    stubQuickBooks()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const query = new URL(String(input)).searchParams.get('query') ?? ''
      const entity = /FROM (\w+)/.exec(query)?.[1]
      return json({ QueryResponse: entity === 'Purchase' ? { Purchase: [purchase()] } : entity === 'Deposit' ? { Deposit: [{ Id: '5', TotalAmt: 50, AccountRef: { name: 'Checking' } }] } : {} })
    }))
    const all = await getTransactions()
    const split = all.find((item) => item.transactionType === 'Purchase')!
    expect(split.lines).toHaveLength(3)
    expect(split.syncToken).toBe('5')
    expect(split.readOnlyReason).toBeUndefined()
    expect(all.find((item) => item.transactionType === 'Deposit')!.readOnlyReason).toBeTruthy()
  })
})
