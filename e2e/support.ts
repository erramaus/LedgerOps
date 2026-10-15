import type { Page, Route } from '@playwright/test'
import { previousFrom, summarizeResult, validateCompletion, type Completeness, type ReconTxn } from '../shared/reconciliation'

/**
 * Network-level fakes for the browser tests. The app's own code runs unmodified: sign-in is
 * satisfied by answering the session request the real AuthGate makes, and QuickBooks is a
 * recorded in-memory stand-in. No real credentials or accounting data are involved.
 */
export const CSRF_TOKEN = 'csrf-e2e-token'
const user = { sub: 'e2e|user', email: 'e2e@example.com', name: 'E2E Tester' }

export type FakeLine = { id: string; description: string; amount: number; category: string; categoryId?: string }
export type FakeTransaction = {
  id: string; quickBooksId: string; transactionType: string; date: string; payee: string; description: string; amount: string
  totalAmount: number; category: string; status: 'Needs Review' | 'Categorized'; account?: string; lines: FakeLine[]
  syncToken: string; readOnlyReason?: string; source: 'quickbooks'
}

export const accounts = [
  { quickBooksId: '10', name: 'Office Supplies', accountType: 'Expense', currentBalance: 0, active: true },
  { quickBooksId: '20', name: 'Meals', accountType: 'Expense', currentBalance: 0, active: true },
  { quickBooksId: '30', name: 'Uncategorized Expense', accountType: 'Expense', currentBalance: 0, active: true },
  { quickBooksId: '40', name: 'Job Materials', accountType: 'Cost of Goods Sold', currentBalance: 0, active: true },
  { quickBooksId: '60', name: 'Checking', accountType: 'Bank', currentBalance: 1000, active: true },
]

export const splitPurchase = (): FakeTransaction => ({
  id: 'quickbooks-Purchase-42', quickBooksId: '42', transactionType: 'Purchase', date: '2026-08-21', payee: 'Sandbox Supply Co', description: 'Shop restock',
  amount: '$286.40', totalAmount: 286.4, category: 'Split', status: 'Needs Review', account: 'Sandbox Credit Card', syncToken: '5', source: 'quickbooks',
  lines: [
    { id: '1', description: 'Printer paper', amount: 120.4, category: 'Office Supplies', categoryId: '10' },
    { id: '2', description: 'Coffee and snacks', amount: 64, category: 'Meals', categoryId: '20' },
    { id: '3', description: 'Cleaning supplies', amount: 102, category: 'Uncategorized Expense', categoryId: '30' },
  ],
})

export const depositReadOnly = (): FakeTransaction => ({
  id: 'quickbooks-Deposit-7', quickBooksId: '7', transactionType: 'Deposit', date: '2026-08-20', payee: 'Sandbox Customer', description: 'Deposit from QuickBooks',
  amount: '$50.00', totalAmount: 50, category: 'Checking', status: 'Categorized', lines: [], syncToken: '1', source: 'quickbooks',
  readOnlyReason: 'Deposits, transfers and payments are read-only here.',
})

export const itemBasedReadOnly = (): FakeTransaction => ({
  id: 'quickbooks-Purchase-43', quickBooksId: '43', transactionType: 'Purchase', date: '2026-08-19', payee: 'Parts Warehouse', description: 'Stock purchase',
  amount: '$80.00', totalAmount: 80, category: 'Inventory', status: 'Categorized', account: 'Sandbox Credit Card', syncToken: '2', source: 'quickbooks',
  lines: [{ id: '1', description: 'Widgets', amount: 80, category: 'Inventory', categoryId: '99' }],
  readOnlyReason: 'This transaction has item-based or other line types, which are read-only here.',
})

export type UpdateBody = { syncToken: string; expectedTotal: number; changes: { lineId: string; accountId: string }[] }
export type Handler = (body: UpdateBody, state: FakeQuickBooks) => { status: number; json: unknown }

export class FakeQuickBooks {
  transactions: FakeTransaction[] = [splitPurchase(), depositReadOnly(), itemBasedReadOnly()]
  writes: { body: UpdateBody; csrf?: string; path: string }[] = []
  transactionLoads = 0
  register: { transactions: ReconTxn[]; completeness: Completeness } = { transactions: [], completeness: { complete: true, reasons: [] } }
  registerReads: string[] = []
  onWrite: Handler = (body, state) => state.applyChanges(body)

  applyChanges(body: UpdateBody) {
    const transaction = this.transactions.find((item) => item.quickBooksId === '42')!
    for (const change of body.changes) {
      const account = accounts.find((item) => item.quickBooksId === change.accountId)!
      const line = transaction.lines.find((item) => item.id === change.lineId)!
      line.category = account.name
      line.categoryId = account.quickBooksId
    }
    const uncategorized = transaction.lines.some((line) => /^uncategorized/i.test(line.category))
    transaction.status = uncategorized ? 'Needs Review' : 'Categorized'
    transaction.syncToken = String(Number(transaction.syncToken) + 1)
    return { status: 200, json: { transaction } }
  }
}

export const TODAY = '2026-10-15'

/** In-memory stand-in for /api/reconciliations that applies the same shared completion rules as the server. */
export class FakeReconciliations {
  records = new Map<string, any>() // eslint-disable-line @typescript-eslint/no-explicit-any
  durable = false
  mutations = 0
  badCsrf = 0
  /** Set by mockApp: the same fake QuickBooks register the browser loads, re-read at completion like the server does. */
  register?: () => { transactions: ReconTxn[]; completeness: Completeness }
  private at = () => `${TODAY}T12:00:00.000Z`

  handle(method: string, url: URL, body: any, csrf?: string): { status: number; json: unknown } { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (method !== 'GET' && csrf !== CSRF_TOKEN) { this.badCsrf += 1; return { status: 403, json: { error: 'Invalid CSRF token.' } } }
    const path = url.pathname.replace(/^.*\/api\/reconciliations/, '')
    if (path === '/storage') {
      return { status: 200, json: { durable: this.durable, description: this.durable ? 'Records are saved in the LedgerOps database.' : 'Temporary local development records.' } }
    }
    if (path === '' || path === '/') {
      const source = url.searchParams.get('source'), clientId = url.searchParams.get('clientId')
      const records = [...this.records.values()].filter((record) => record.source === source && record.clientId === clientId)
      return { status: 200, json: { durable: this.durable, records: records.map(({ transactions, statementLines, matches, clearedIds, ...rest }) => ({ ...rest, clearedCount: clearedIds.length, transactionCount: transactions.length, lineCount: statementLines.length, matchCount: matches.length })) } }
    }
    const [, rawId, action] = path.split('/')
    const id = decodeURIComponent(rawId)
    const stored = this.records.get(id)
    if (method === 'GET') return stored ? { status: 200, json: { durable: this.durable, record: stored } } : { status: 404, json: { error: 'No saved reconciliation.', code: 'NOT_FOUND' } }
    this.mutations += 1
    const [source, clientId, accountId, periodEnd] = id.split(':')
    if (method === 'PUT') {
      if (stored?.status === 'completed') return { status: 409, json: { error: 'This reconciliation is completed. Reopen it first.', code: 'COMPLETED' } }
      if ((stored?.version ?? 0) !== body.expectedVersion) return { status: 409, json: { error: 'This reconciliation changed elsewhere.', code: 'CONFLICT' } }
      const record = { ...body.record, id, source, clientId, accountId, periodEnd, status: 'draft', version: body.expectedVersion + 1, createdAt: stored?.createdAt ?? this.at(), updatedAt: this.at(), history: stored?.history ?? [] }
      this.records.set(id, record)
      return { status: 200, json: { record } }
    }
    if (!stored) return { status: 404, json: { error: 'Save it first.', code: 'NOT_FOUND' } }
    if (action === 'complete') {
      const earlier = [...this.records.values()].filter((other) => other.accountId === accountId && other.source === source && other.status === 'completed').sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
      const previous = earlier[earlier.length - 1]
      const fresh = source === 'quickbooks' ? this.register?.() : undefined
      const result = validateCompletion({ ...stored, completeness: fresh?.completeness ?? stored.completeness }, { previous: previous ? previousFrom(previous) : undefined, sourceTransactions: fresh?.transactions, today: TODAY })
      if (!result.ok) return { status: 422, json: { error: 'The reconciliation cannot be completed yet.', code: 'NOT_COMPLETABLE', issues: result.blocking } }
      const record = { ...stored, status: 'completed', completedAt: this.at(), completedBy: 'e2e@example.com', version: stored.version + 1, result: summarizeResult(result.computation), history: [...stored.history, { at: this.at(), by: 'e2e@example.com', action: 'completed', differenceCents: result.computation.differenceCents }] }
      this.records.set(id, record)
      return { status: 200, json: { record } }
    }
    if (action === 'reopen') {
      if (typeof body.reason !== 'string' || body.reason.trim().length < 5) return { status: 400, json: { error: 'Give a reason.', code: 'REASON_REQUIRED' } }
      const { completedAt, completedBy, result, ...rest } = stored
      const record = { ...rest, status: 'draft', version: stored.version + 1, history: [...stored.history, { at: this.at(), by: 'e2e@example.com', action: 'reopened', reason: body.reason.trim(), differenceCents: result?.differenceCents }] }
      this.records.set(id, record)
      return { status: 200, json: { record } }
    }
    return { status: 404, json: { error: 'Not found' } }
  }
}

export async function mockApp(page: Page, options: { authenticated?: boolean; quickBooks?: FakeQuickBooks; reconciliations?: FakeReconciliations } = {}) {
  const quickBooks = options.quickBooks ?? new FakeQuickBooks()
  const reconciliations = options.reconciliations ?? new FakeReconciliations()
  reconciliations.register = () => quickBooks.register
  const unexpected: string[] = []
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00Z`))

  // Anything not explicitly faked is recorded and refused, so tests cannot silently reach a real server.
  await page.route('**/api/**', (route) => {
    unexpected.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
    return route.abort()
  })
  await page.route('**/api/auth/session', (route) =>
    json(route, options.authenticated === false ? { configured: true, authenticated: false } : { configured: true, authenticated: true, user, csrfToken: CSRF_TOKEN }),
  )
  await page.route('**/api/quickbooks/status', (route) => json(route, { connected: true, environment: 'sandbox' }))
  await page.route('**/api/quickbooks/transactions', (route) => {
    quickBooks.transactionLoads += 1
    return json(route, { transactions: quickBooks.transactions })
  })
  await page.route('**/api/quickbooks/accounts', (route) => json(route, { accounts }))
  await page.route('**/api/quickbooks/reconciliation/*', (route) => {
    quickBooks.registerReads.push(new URL(route.request().url()).searchParams.get('through') ?? '')
    return json(route, quickBooks.register)
  })
  await page.route(/\/api\/reconciliations/, (route) => {
    const request = route.request()
    const body = request.method() === 'GET' ? undefined : request.postDataJSON()
    const result = reconciliations.handle(request.method(), new URL(request.url()), body, request.headers()['x-csrf-token'])
    return json(route, result.json, result.status)
  })
  await page.route('**/api/quickbooks/invoices', (route) => json(route, { invoices: [] }))
  await page.route('**/api/quickbooks/bills', (route) => json(route, { bills: [] }))
  await page.route('**/api/quickbooks/transactions/*/*/lines', (route) => {
    const request = route.request()
    const body = request.postDataJSON() as UpdateBody
    quickBooks.writes.push({ body, csrf: request.headers()['x-csrf-token'], path: new URL(request.url()).pathname })
    const result = quickBooks.onWrite(body, quickBooks)
    return json(route, result.json, result.status)
  })
  return { quickBooks, reconciliations, unexpected }
}
