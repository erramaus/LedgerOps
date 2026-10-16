import type { Page, Route } from '@playwright/test'
import express from 'express'
import request from 'supertest'
import { buildDemoMonthEndRecords, buildDemoReconciliations } from '../shared/demoMonthEnd'
import type { QbReportJson } from '../shared/qbReports'
import { createMonthEndRouter } from '../server/monthEnd'
import { MemoryMonthEndStore } from '../server/monthEndStore'
import type { ReconciliationStore } from '../server/reconciliationStore'
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
  { quickBooksId: '70', name: 'Owner Equity', accountType: 'Equity', currentBalance: 0, active: true },
  { quickBooksId: '80', name: 'Accounts Payable', accountType: 'Accounts Payable', currentBalance: 0, active: true },
  { quickBooksId: '90', name: 'Accounts Receivable', accountType: 'Accounts Receivable', currentBalance: 0, active: true },
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
  /** QuickBooks report responses by report key; a missing key answers like an unsupported report. */
  reports: Record<string, QbReportJson> = qbSampleReports()
  reportReads: { report: string; start: string; end: string }[] = []
  listCompleteness = { transactions: { complete: true, reasons: [] as string[] }, invoices: { complete: true, reasons: [] as string[] }, bills: { complete: true, reasons: [] as string[] }, accounts: { complete: true, reasons: [] as string[] } }
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

  /** The demo scenario reconciliations (May to July 2026) that the real server seeds at startup. */
  seedDemo() {
    for (const record of buildDemoReconciliations()) this.records.set(record.id, record)
  }

  /** Lets the real month-end router read exactly the records this fake serves. */
  asStore(): ReconciliationStore {
    return {
      get durable() { return false },
      list: async ({ source, clientId }) => [...this.records.values()].filter((record) => record.source === source && record.clientId === clientId),
      get: async (id) => this.records.get(id) ?? null,
      put: async (record, expectedVersion) => {
        if ((this.records.get(record.id)?.version ?? 0) !== expectedVersion) return false
        this.records.set(record.id, record)
        return true
      },
    }
  }
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

export async function mockApp(page: Page, options: { authenticated?: boolean; quickBooks?: FakeQuickBooks; reconciliations?: FakeReconciliations; monthEnd?: FakeMonthEnd } = {}) {
  const quickBooks = options.quickBooks ?? new FakeQuickBooks()
  const reconciliations = options.reconciliations ?? new FakeReconciliations()
  reconciliations.register = () => quickBooks.register
  const monthEnd = options.monthEnd ?? new FakeMonthEnd(reconciliations)
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
  await page.route('**/api/quickbooks/list-completeness', (route) => json(route, quickBooks.listCompleteness))
  await page.route('**/api/quickbooks/report-data/*', (route) => {
    const url = new URL(route.request().url())
    const key = url.pathname.split('/').pop() as string
    quickBooks.reportReads.push({ report: key, start: url.searchParams.get('start') ?? '', end: url.searchParams.get('end') ?? '' })
    const found = quickBooks.reports[key]
    const dated = found && { ...found, Header: { ...found.Header, StartPeriod: url.searchParams.get('start') ?? undefined, EndPeriod: url.searchParams.get('end') ?? undefined } }
    return dated ? json(route, { report: dated }) : json(route, { error: `QuickBooks ${key} report failed (400).` }, 400)
  })
  await page.route(/\/api\/month-end/, async (route) => {
    const incoming = route.request()
    const result = await monthEnd.handle(incoming.method(), new URL(incoming.url()), incoming.method() === 'GET' ? undefined : incoming.postDataJSON(), incoming.headers()['x-csrf-token'])
    return json(route, result.json, result.status)
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
  return { quickBooks, reconciliations, monthEnd, unexpected }
}

/** The real month-end router, run in-process on memory stores, so browser tests exercise the actual closing and verification rules. */
export class FakeMonthEnd {
  readonly store = new MemoryMonthEndStore()
  badCsrf = 0
  mutations = 0
  private app: express.Express

  constructor(reconciliations: FakeReconciliations) {
    const quickbooks = { getAccounts: async () => accounts.map((account) => ({ quickBooksId: account.quickBooksId, name: account.name, accountType: account.accountType, active: account.active })) }
    this.app = express()
    this.app.use(express.json())
    this.app.use((incoming, _response, next) => {
      ;(incoming as unknown as { session: unknown }).session = { user: { email: 'e2e@example.com' } }
      next()
    })
    this.app.use('/api/month-end', createMonthEndRouter({ store: this.store, reconciliations: reconciliations.asStore(), quickbooks, now: () => Date.parse(`${TODAY}T12:00:00Z`) }))
  }

  async seedDemo() {
    for (const record of buildDemoMonthEndRecords()) await this.store.put(record, 0)
  }

  async handle(method: string, url: URL, body: unknown, csrf?: string): Promise<{ status: number; json: unknown }> {
    if (method !== 'GET' && csrf !== CSRF_TOKEN) {
      this.badCsrf += 1
      return { status: 403, json: { error: 'Invalid CSRF token.' } }
    }
    if (method !== 'GET') this.mutations += 1
    const target = `${url.pathname}${url.search}`
    const agent = request(this.app)
    const response = method === 'GET' ? await agent.get(target) : await agent.post(target).send((body ?? {}) as object)
    return { status: response.status, json: response.body }
  }
}

/** A completed QuickBooks-source reconciliation for one account, as the reconciliation API would have stored it. */
export function completedQuickBooksReconciliation(accountId: string, name: string, periodEnd: string, kind: 'bank' | 'credit_card' = 'bank') {
  return {
    id: `quickbooks:quickbooks-sandbox:${accountId}:${periodEnd}`, source: 'quickbooks', clientId: 'quickbooks-sandbox', clientName: 'QuickBooks Sandbox', accountId, accountName: name, accountKind: kind,
    periodStart: `${periodEnd.slice(0, 7)}-01`, periodEnd, statementDate: periodEnd, beginningCents: 0, endingCents: 0, openingConfirmed: true, statementMode: 'manual', statementLines: [], transactions: [], clearedIds: [], matches: [],
    completeness: { complete: true, reasons: [] }, status: 'completed', version: 2, createdAt: `${TODAY}T00:00:00.000Z`, updatedAt: `${TODAY}T00:00:00.000Z`, completedAt: `${TODAY}T00:00:00.000Z`, completedBy: 'e2e@example.com',
    history: [], result: { differenceCents: 0, clearedBalanceCents: 0, clearedCount: 0, outstandingIncreaseCents: 0, outstandingDecreaseCents: 0, adjustedBankBalanceCents: 0, bookBalanceCents: 0, warnings: [] },
  }
}

const cols = (...values: string[]) => values.map((value) => ({ value }))
const moneyColumns = { Column: [{ ColTitle: '', ColType: 'Account' }, { ColTitle: 'Total', ColType: 'Money' }] }

/** Internally consistent QuickBooks-style reports (the figures add up), used unless a test replaces them. */
export function qbSampleReports(): Record<string, QbReportJson> {
  return {
    'profit-loss': {
      Header: { ReportName: 'ProfitAndLoss', ReportBasis: 'Accrual', Currency: 'USD', Time: '2026-10-15T12:00:00-07:00' }, Columns: moneyColumns,
      Rows: { Row: [
        { group: 'Income', Header: { ColData: cols('Income', '') }, Rows: { Row: [{ type: 'Data', ColData: cols('Sandbox Service Income', '7,500.00') }, { type: 'Data', ColData: cols('Sandbox Parts', '500.00') }] }, Summary: { ColData: cols('Total Income', '8,000.00') } },
        { group: 'GrossProfit', Summary: { ColData: cols('Gross Profit', '8,000.00') } },
        { group: 'Expenses', Header: { ColData: cols('Expenses', '') }, Rows: { Row: [{ type: 'Data', ColData: cols('Sandbox Fuel', '1,200.00') }, { type: 'Data', ColData: cols('Sandbox Payroll', '2,300.50') }] }, Summary: { ColData: cols('Total Expenses', '3,500.50') } },
        { group: 'NetOperatingIncome', Summary: { ColData: cols('Net Operating Income', '4,499.50') } },
        { group: 'NetIncome', Summary: { ColData: cols('Net Income', '4,499.50') } },
      ] },
    },
    'balance-sheet': {
      Header: { ReportName: 'BalanceSheet', ReportBasis: 'Accrual', Currency: 'USD' }, Columns: moneyColumns,
      Rows: { Row: [
        { group: 'Assets', Header: { ColData: cols('ASSETS', '') }, Rows: { Row: [{ type: 'Data', ColData: cols('Checking', '20,000.00') }, { type: 'Data', ColData: cols('Accounts Receivable', '4,820.00') }] }, Summary: { ColData: cols('Total Assets', '24,820.00') } },
        { group: 'LiabilitiesAndEquity', Header: { ColData: cols('LIABILITIES AND EQUITY', '') }, Rows: { Row: [{ type: 'Data', ColData: cols('Accounts Payable', '412.44') }, { type: 'Data', ColData: cols('Owner Equity', '24,407.56') }] }, Summary: { ColData: cols('Total Liabilities and Equity', '24,820.00') } },
      ] },
    },
    'trial-balance': {
      Header: { ReportName: 'TrialBalance', ReportBasis: 'Accrual' }, Columns: { Column: [{ ColTitle: '', ColType: 'Account' }, { ColTitle: 'Debit', ColType: 'Money' }, { ColTitle: 'Credit', ColType: 'Money' }] },
      Rows: { Row: [
        { type: 'Data', ColData: cols('Checking', '20,000.00', '') }, { type: 'Data', ColData: cols('Accounts Receivable', '4,820.00', '') },
        { type: 'Data', ColData: cols('Accounts Payable', '', '412.44') }, { type: 'Data', ColData: cols('Owner Equity', '', '24,407.56') },
        { group: 'GrandTotal', Summary: { ColData: cols('TOTAL', '24,820.00', '24,820.00') } },
      ] },
    },
    'ar-aging': {
      Header: { ReportName: 'AgedReceivables' }, Columns: { Column: [{ ColTitle: '', ColType: 'Customer' }, { ColTitle: 'Current', ColType: 'Money' }, { ColTitle: '1 - 30', ColType: 'Money' }, { ColTitle: 'Total', ColType: 'Money' }] },
      Rows: { Row: [{ type: 'Data', ColData: cols('Sandbox Riverside', '0.00', '2,840.00', '2,840.00') }, { type: 'Data', ColData: cols('Sandbox Pinecrest', '1,980.00', '0.00', '1,980.00') }, { group: 'GrandTotal', Summary: { ColData: cols('TOTAL', '1,980.00', '2,840.00', '4,820.00') } }] },
    },
    'ap-aging': {
      Header: { ReportName: 'AgedPayables' }, Columns: { Column: [{ ColTitle: '', ColType: 'Vendor' }, { ColTitle: 'Current', ColType: 'Money' }, { ColTitle: '1 - 30', ColType: 'Money' }, { ColTitle: 'Total', ColType: 'Money' }] },
      Rows: { Row: [{ type: 'Data', ColData: cols('Sandbox Verizon', '126.44', '0.00', '126.44') }, { type: 'Data', ColData: cols('Sandbox State Farm', '0.00', '286.00', '286.00') }, { group: 'GrandTotal', Summary: { ColData: cols('TOTAL', '126.44', '286.00', '412.44') } }] },
    },
    'cash-flow': {
      Header: { ReportName: 'CashFlow' }, Columns: moneyColumns,
      Rows: { Row: [
        { group: 'OperatingActivities', Summary: { ColData: cols('Net cash provided by operating activities', '1,000.00') } },
        { group: 'InvestingActivities', Summary: { ColData: cols('Net cash provided by investing activities', '0.00') } },
        { group: 'FinancingActivities', Summary: { ColData: cols('Net cash provided by financing activities', '0.00') } },
        { group: 'CashIncrease', Summary: { ColData: cols('Net cash increase for period', '1,000.00') } },
      ] },
    },
    'general-ledger': {
      Header: { ReportName: 'GeneralLedger' }, Columns: { Column: [{ ColTitle: 'Date', ColType: 'Date' }, { ColTitle: 'Memo', ColType: 'String' }, { ColTitle: 'Amount', ColType: 'Money' }, { ColTitle: 'Balance', ColType: 'Money' }] },
      Rows: { Row: [{ type: 'Data', ColData: cols('2026-09-05', 'Sandbox sale', '100.00', '100.00') }] },
    },
  }
}
