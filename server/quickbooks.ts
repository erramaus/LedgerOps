import crypto from 'node:crypto'
import {
  TransactionUpdateError,
  WRITABLE_TYPES,
  buildLineUpdatePayload,
  describeQuickBooksFailure,
  normalizeTransaction,
  verifyUpdatedTransaction,
  type LineChangeRequest,
  type QbAccount,
  type QbTransaction,
} from './transactionLines.js'
import { READ_ENTITIES, buildAccountRegister, type EntityRead, type QbEntity } from './reconciliationData.js'

const sandboxBaseUrl = 'https://sandbox-quickbooks.api.intuit.com'
const authorizationUrl = 'https://appcenter.intuit.com/connect/oauth2'
const tokenUrl = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const scope = 'com.intuit.quickbooks.accounting'

type QuickBooksTokens = {
  accessToken: string
  refreshToken: string
  realmId: string
  expiresAt: number
}

type QuickBooksCompany = {
  CompanyInfo?: {
    CompanyName?: string
    LegalName?: string
    Country?: string
    FiscalYearStartMonth?: string
  }
}

type QuickBooksEntity = {
  Id?: string
  Name?: string
  CompanyName?: string
  PrimaryEmailAddr?: { Address?: string }
  Balance?: number
  AccountType?: string
  AccountSubType?: string
  CurrentBalance?: number
  Active?: boolean
  CurrencyRef?: { value?: string }
  CustomerRef?: { name?: string }
  VendorRef?: { name?: string }
  DocNumber?: string
  DueDate?: string
  TxnDate?: string
  Amount?: number
  TotalAmt?: number
  PaymentType?: string
  PrivateNote?: string
  Memo?: string
  AccountRef?: { name?: string }
  EntityRef?: { name?: string }
  SyncToken?: string
}

type QuickBooksQueryResponse = {
  QueryResponse?: Record<string, QuickBooksEntity[] | undefined>
}

type QuickBooksReportColumn = { value?: string }
type QuickBooksReportRow = {
  Header?: { ColData?: QuickBooksReportColumn[] }
  ColData?: QuickBooksReportColumn[]
  Summary?: { ColData?: QuickBooksReportColumn[] }
  Rows?: { Row?: QuickBooksReportRow[] }
}

type QuickBooksReportResponse = {
  Header?: { ReportName?: string }
  Rows?: { Row?: QuickBooksReportRow[] }
}

let tokens: QuickBooksTokens | null = null

function getConfig() {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET
  const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI
  const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox'

  const missing = getMissingConfigurationNames()
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable: ${missing.join(', ')}`)
  }

  if (environment !== 'sandbox') {
    throw new Error('Only the QuickBooks sandbox environment is enabled.')
  }

  return { clientId: clientId!, clientSecret: clientSecret!, redirectUri: redirectUri! }
}

function isConfigured(value: string | undefined) {
  return Boolean(value && value.trim() && value.trim().toLowerCase() !== 'undefined' && value.trim().toLowerCase() !== 'null')
}

export function getMissingConfigurationNames() {
  const required: [string, string | undefined][] = [
    ['QUICKBOOKS_CLIENT_ID', process.env.QUICKBOOKS_CLIENT_ID],
    ['QUICKBOOKS_CLIENT_SECRET', process.env.QUICKBOOKS_CLIENT_SECRET],
    ['QUICKBOOKS_REDIRECT_URI', process.env.QUICKBOOKS_REDIRECT_URI],
    ['QUICKBOOKS_ENVIRONMENT', process.env.QUICKBOOKS_ENVIRONMENT],
  ]
  return required.filter(([, value]) => !isConfigured(value)).map(([name]) => name)
}

export function getConfigurationDiagnostics() {
  return {
    clientIdExists: isConfigured(process.env.QUICKBOOKS_CLIENT_ID),
    redirectUriExists: isConfigured(process.env.QUICKBOOKS_REDIRECT_URI),
    environment: process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox',
  }
}

export function validateConfigurationAtStartup() {
  getMissingConfigurationNames().forEach((name) => console.warn(`Missing required environment variable: ${name}`))
  if (process.env.QUICKBOOKS_ENVIRONMENT && process.env.QUICKBOOKS_ENVIRONMENT !== 'sandbox') {
    console.warn('QuickBooks production access is disabled; QUICKBOOKS_ENVIRONMENT must be sandbox.')
  }
}

export function createAuthorizationUrl(state: string) {
  const config = getConfig()

  const url = new URL(authorizationUrl)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scope)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('state', state)
  const generatedUrl = url.toString()
  validateAuthorizationUrl(generatedUrl)
  return generatedUrl
}

function validateAuthorizationUrl(value: string) {
  const url = new URL(value)
  const required = {
    client_id: url.searchParams.get('client_id'),
    redirect_uri: url.searchParams.get('redirect_uri'),
    response_type: url.searchParams.get('response_type'),
    scope: url.searchParams.get('scope'),
    state: url.searchParams.get('state'),
  }
  if (url.origin !== 'https://appcenter.intuit.com' || url.pathname !== '/connect/oauth2') throw new Error('QuickBooks authorization URL has an unexpected host or path.')
  if (!isConfigured(required.client_id || undefined) || !isConfigured(required.redirect_uri || undefined) || required.response_type !== 'code' || required.scope !== scope || !isConfigured(required.state || undefined)) {
    throw new Error('QuickBooks authorization URL is missing or has an invalid required parameter.')
  }
}

export function getAuthorizationUrlDiagnostics(value: string) {
  const url = new URL(value)
  return {
    authorizationHost: url.host,
    authorizationPathname: url.pathname,
    clientIdPresent: isConfigured(url.searchParams.get('client_id') || undefined),
    redirectUri: url.searchParams.get('redirect_uri'),
    responseType: url.searchParams.get('response_type'),
    scope: url.searchParams.get('scope'),
    statePresent: isConfigured(url.searchParams.get('state') || undefined),
  }
}

/** The caller must already have validated and consumed the session-bound OAuth state. */
export async function exchangeCode(code: string, realmId: string) {
  const config = getConfig()
  if (!/^\d{1,20}$/.test(realmId)) throw new Error('Invalid QuickBooks company identifier.')

  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri }),
  })

  if (!response.ok) throw new Error(`QuickBooks token exchange failed (${response.status}).`)
  const result = await response.json() as { access_token: string; refresh_token: string; expires_in: number }
  tokens = { accessToken: result.access_token, refreshToken: result.refresh_token, realmId, expiresAt: Date.now() + result.expires_in * 1000 }
}

export function getConnectionStatus() {
  return { connected: tokens !== null, environment: 'sandbox' as const }
}

export async function getCompanyInfo() {
  if (!tokens) throw new Error('QuickBooks is not connected.')
  if (tokens.expiresAt <= Date.now()) throw new Error('QuickBooks access token has expired. Reconnect to continue.')

  const response = await fetch(`${sandboxBaseUrl}/v3/company/${tokens.realmId}/companyinfo/${tokens.realmId}?minorversion=75`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`QuickBooks company request failed (${response.status}).`)
  const result = await response.json() as QuickBooksCompany
  return result.CompanyInfo || {}
}

function reportDates(period: string) {
  const today = new Date()
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  let start: Date
  if (period === 'Last Month') {
    start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1))
    end.setUTCDate(0)
  } else if (period === 'This Quarter') {
    start = new Date(Date.UTC(end.getUTCFullYear(), Math.floor(end.getUTCMonth() / 3) * 3, 1))
  } else if (period === 'This Year') {
    start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1))
  } else {
    start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))
  }
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) }
}

function reportAmount(columns?: QuickBooksReportColumn[]) {
  const value = columns?.at(-1)?.value?.replace(/[$,]/g, '')
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : 0
}

function normalizeReport(reportName: string, result: QuickBooksReportResponse) {
  const sections: { label: string; lines: { label: string; amount: number }[] }[] = []
  const totals: { label: string; amount: number }[] = []
  const walk = (rows: QuickBooksReportRow[] = [], parentLabel = '') => {
    rows.forEach((row) => {
      const headerLabel = row.Header?.ColData?.[0]?.value || parentLabel
      const children = row.Rows?.Row || []
      if (children.length > 0) {
        const lines: { label: string; amount: number }[] = []
        children.forEach((child) => {
          const label = child.ColData?.[0]?.value
          if (label && child.ColData) lines.push({ label, amount: reportAmount(child.ColData) })
          walk(child.Rows?.Row || [], label || headerLabel)
          if (child.Summary?.ColData?.[0]?.value) totals.push({ label: child.Summary.ColData[0].value, amount: reportAmount(child.Summary.ColData) })
        })
        if (headerLabel && lines.length > 0) sections.push({ label: headerLabel, lines })
      } else if (row.ColData?.[0]?.value) {
        const label = row.ColData[0].value
        if (label.toLowerCase().includes('total') || label.toLowerCase().includes('net change') || label.toLowerCase().includes('ending cash')) totals.push({ label, amount: reportAmount(row.ColData) })
      }
      if (row.Summary?.ColData?.[0]?.value) totals.push({ label: row.Summary.ColData[0].value, amount: reportAmount(row.Summary.ColData) })
    })
  }
  walk(result.Rows?.Row)
  return { reportName, sections, totals }
}

export async function getFinancialReport(report: 'profit-loss' | 'balance-sheet' | 'cash-flow', period: string) {
  if (!tokens) throw new Error('QuickBooks is not connected.')
  if (tokens.expiresAt <= Date.now()) throw new Error('QuickBooks access token has expired. Reconnect to continue.')
  const reportPath = report === 'profit-loss' ? 'ProfitAndLoss' : report === 'balance-sheet' ? 'BalanceSheet' : 'CashFlow'
  const dates = reportDates(period)
  const url = new URL(`${sandboxBaseUrl}/v3/company/${tokens.realmId}/reports/${reportPath}`)
  url.searchParams.set('start_date', dates.startDate)
  url.searchParams.set('end_date', dates.endDate)
  url.searchParams.set('minorversion', '75')
  const response = await fetch(url, { headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json' } })
  if (!response.ok) throw new Error(`QuickBooks ${reportPath} report failed (${response.status}).`)
  return normalizeReport(reportPath, await response.json() as QuickBooksReportResponse)
}

async function queryTransactions(entity: string) {
  if (!tokens) throw new Error('QuickBooks is not connected.')
  if (tokens.expiresAt <= Date.now()) throw new Error('QuickBooks access token has expired. Reconnect to continue.')

  const query = `SELECT * FROM ${entity} STARTPOSITION 1 MAXRESULTS 100`
  const url = new URL(`${sandboxBaseUrl}/v3/company/${tokens.realmId}/query`)
  url.searchParams.set('query', query)
  url.searchParams.set('minorversion', '75')
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`QuickBooks ${entity} request failed (${response.status}).`)
  const result = await response.json() as QuickBooksQueryResponse
  return (result.QueryResponse?.[entity] || []).map((item) => ({ ...item, transactionType: entity }))
}

export async function getTransactions() {
  const entities = ['Purchase', 'Check', 'CreditCardPayment', 'Deposit', 'Payment', 'Transfer']
  const results = await Promise.all(entities.map((entity) => queryTransactions(entity)))
  const transactions = results.flat().map((item) => normalizeTransaction(item.transactionType, item as QbTransaction))

  return transactions.sort((left, right) => right.date.localeCompare(left.date))
}

function requireConnection() {
  if (!tokens) throw new TransactionUpdateError('NOT_CONNECTED', 503, 'QuickBooks is not connected. Connect in Settings first.')
  if (tokens.expiresAt <= Date.now()) throw new TransactionUpdateError('NOT_CONNECTED', 503, 'The QuickBooks connection has expired. Reconnect in Settings to continue.')
  return tokens
}

async function quickBooksRequest(url: string, init: RequestInit, unreachable: string) {
  try {
    return await fetch(url, init)
  } catch {
    throw new TransactionUpdateError('UNAVAILABLE', 502, unreachable)
  }
}

async function readFailure(response: Response) {
  return describeQuickBooksFailure(response.status, await response.json().catch(() => undefined))
}

async function fetchTransaction(transactionType: string, transactionId: string) {
  const connection = requireConnection()
  const url = `${sandboxBaseUrl}/v3/company/${connection.realmId}/${transactionType.toLowerCase()}/${transactionId}?minorversion=75`
  const response = await quickBooksRequest(url, { headers: { Authorization: `Bearer ${connection.accessToken}`, Accept: 'application/json' } }, 'Could not reach QuickBooks. Nothing was changed.')
  if (response.status === 404) throw new TransactionUpdateError('NOT_FOUND', 404, 'The QuickBooks transaction could not be found.')
  if (!response.ok) throw await readFailure(response)
  const entity = ((await response.json()) as Record<string, QbTransaction | undefined>)[transactionType]
  if (!entity) throw new TransactionUpdateError('NOT_FOUND', 404, 'The QuickBooks transaction could not be found.')
  return entity
}

/**
 * Changes the account on specific lines only. The latest copy is re-read first, its SyncToken and
 * total must match what the user reviewed, and the stored result is verified afterwards.
 */
export async function updateTransactionLines(request: LineChangeRequest) {
  if (!WRITABLE_TYPES.includes(request.transactionType)) {
    throw new TransactionUpdateError('UNSUPPORTED', 422, 'This transaction type is read-only.')
  }
  if (!/^\d{1,20}$/.test(request.transactionId)) throw new TransactionUpdateError('INVALID', 400, 'Invalid transaction id.')
  const connection = requireConnection()

  const latest = await fetchTransaction(request.transactionType, request.transactionId)
  const accounts = (await getEntityList('Account').catch(() => {
    throw new TransactionUpdateError('UNAVAILABLE', 502, 'Could not load QuickBooks accounts. Nothing was changed.')
  })) as QbAccount[]
  const payload = buildLineUpdatePayload(latest, request, accounts)

  // Never retried automatically: a repeated write could be applied twice.
  const response = await quickBooksRequest(
    `${sandboxBaseUrl}/v3/company/${connection.realmId}/${request.transactionType.toLowerCase()}?minorversion=75`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${connection.accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    'Could not confirm the update with QuickBooks. Reload the transaction to see whether it was applied.',
  )
  if (!response.ok) throw await readFailure(response)
  const updated = ((await response.json()) as Record<string, QbTransaction | undefined>)[request.transactionType]
  if (!updated) throw new TransactionUpdateError('VERIFY_FAILED', 502, 'QuickBooks did not return the updated transaction. Reload it and check it.')
  verifyUpdatedTransaction(latest, updated, request.changes)
  return normalizeTransaction(request.transactionType, updated)
}

export async function getAccounts() {
  const result = await queryAccounts()
  return result.map((account) => ({
    quickBooksId: account.Id,
    name: account.Name || 'Unnamed account',
    accountType: account.AccountType || 'Other',
    accountSubType: account.AccountSubType,
    currentBalance: Number(account.CurrentBalance || 0),
    active: account.Active !== false,
    currency: account.CurrencyRef?.value,
  }))
}

const RECONCILIATION_PAGE_SIZE = 1000
const RECONCILIATION_MAX_PAGES = 20

async function readEntityForReconciliation(entity: string, through: string): Promise<EntityRead> {
  const connection = requireConnection()
  const run = async (query: string) => {
    const url = new URL(`${sandboxBaseUrl}/v3/company/${connection.realmId}/query`)
    url.searchParams.set('query', query)
    url.searchParams.set('minorversion', '75')
    const response = await fetch(url, { headers: { Authorization: `Bearer ${connection.accessToken}`, Accept: 'application/json' } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return (await response.json()) as { QueryResponse?: Record<string, unknown> & { totalCount?: number } }
  }
  const items: QbEntity[] = []
  try {
    const where = `WHERE TxnDate <= '${through}'`
    const expected = (await run(`SELECT COUNT(*) FROM ${entity} ${where}`)).QueryResponse?.totalCount
    for (let page = 0; page < RECONCILIATION_MAX_PAGES; page += 1) {
      const result = await run(`SELECT * FROM ${entity} ${where} STARTPOSITION ${page * RECONCILIATION_PAGE_SIZE + 1} MAXRESULTS ${RECONCILIATION_PAGE_SIZE}`)
      const batch = (result.QueryResponse?.[entity] as QbEntity[] | undefined) ?? []
      items.push(...batch)
      if (batch.length < RECONCILIATION_PAGE_SIZE) return { entity, items, expected: typeof expected === 'number' ? expected : undefined, ...(typeof expected === 'number' ? {} : { error: 'the record count was not returned' }) }
    }
    return { entity, items, truncated: true }
  } catch (error) {
    return { entity, items, error: error instanceof Error ? error.message : 'request failed' }
  }
}

/** Read-only: the register of one bank or credit-card account through a date, with a completeness verdict. */
export async function getReconciliationData(accountId: string, through: string) {
  if (!/^\d{1,20}$/.test(accountId)) throw new Error('Invalid account id.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(through) || Number.isNaN(Date.parse(through))) throw new Error('Invalid date.')
  requireConnection()
  const account = ((await getEntityList('Account')) as QbAccount[]).find((candidate) => candidate.Id === accountId)
  if (!account) throw new Error('The QuickBooks account could not be found.')
  const kind = account.AccountType === 'Bank' ? 'bank' : account.AccountType === 'Credit Card' ? 'credit_card' : null
  if (!kind || account.Active === false) throw new Error('Only active bank and credit card accounts can be reconciled.')
  const reads = await Promise.all(READ_ENTITIES.map((entity) => readEntityForReconciliation(entity, through)))
  const { transactions, completeness } = buildAccountRegister({ id: accountId, kind }, reads, through)
  return { account: { id: accountId, name: account.Name ?? 'Unnamed account', kind }, through, transactions, completeness, readAt: new Date().toISOString() }
}

function daysOverdue(dueDate?: string) {
  if (!dueDate) return 0
  const days = Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000)
  return Math.max(0, days)
}

async function getEntityList(entity: string) {
  if (!tokens) throw new Error('QuickBooks is not connected.')
  if (tokens.expiresAt <= Date.now()) throw new Error('QuickBooks access token has expired. Reconnect to continue.')

  const url = new URL(`${sandboxBaseUrl}/v3/company/${tokens.realmId}/query`)
  url.searchParams.set('query', `SELECT * FROM ${entity} STARTPOSITION 1 MAXRESULTS 1000`)
  url.searchParams.set('minorversion', '75')
  const response = await fetch(url, { headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json' } })
  if (!response.ok) throw new Error(`QuickBooks ${entity} request failed (${response.status}).`)
  const result = await response.json() as QuickBooksQueryResponse
  return result.QueryResponse?.[entity] || []
}

export async function getCustomers() {
  return (await getEntityList('Customer')).map((customer) => ({
    quickBooksId: customer.Id,
    name: customer.Name || 'Unnamed customer',
    companyName: customer.CompanyName,
    email: customer.PrimaryEmailAddr?.Address,
    balance: Number(customer.Balance || 0),
    active: customer.Active !== false,
  }))
}

export async function getVendors() {
  return (await getEntityList('Vendor')).map((vendor) => ({
    quickBooksId: vendor.Id,
    name: vendor.Name || 'Unnamed vendor',
    companyName: vendor.CompanyName,
    email: vendor.PrimaryEmailAddr?.Address,
    balance: Number(vendor.Balance || 0),
    active: vendor.Active !== false,
  }))
}

export async function getInvoices() {
  return (await getEntityList('Invoice')).map((invoice) => {
    const amount = Number(invoice.TotalAmt || 0)
    const amountRemaining = Number(invoice.Balance ?? amount)
    const amountPaid = Math.max(0, amount - amountRemaining)
    const overdue = daysOverdue(invoice.DueDate)
    const status = amountRemaining <= 0 ? 'Paid' : amountPaid > 0 ? 'Partially Paid' : overdue > 0 ? 'Overdue' : 'Open'
    return {
      id: `quickbooks-invoice-${invoice.Id}`,
      quickBooksId: invoice.Id,
      customer: invoice.CustomerRef?.name || 'Unknown customer',
      number: invoice.DocNumber || invoice.Id || 'Unknown invoice',
      invoiceDate: invoice.TxnDate || 'Unknown date',
      dueDate: invoice.DueDate || 'Unknown date',
      amount,
      amountPaid,
      status,
      daysOverdue: overdue,
      source: 'quickbooks' as const,
    }
  })
}

export async function getBills() {
  return (await getEntityList('Bill')).map((bill) => {
    const amount = Number(bill.TotalAmt || 0)
    const amountRemaining = Number(bill.Balance ?? amount)
    const overdue = daysOverdue(bill.DueDate)
    const status = amountRemaining <= 0 ? 'Paid' : overdue > 0 ? 'Overdue' : overdue === 0 && bill.DueDate && new Date(bill.DueDate).getTime() - Date.now() <= 7 * 86400000 ? 'Due Soon' : 'Open'
    return {
      id: `quickbooks-bill-${bill.Id}`,
      quickBooksId: bill.Id,
      vendor: bill.VendorRef?.name || 'Unknown vendor',
      number: bill.DocNumber || bill.Id || 'Unknown bill',
      billDate: bill.TxnDate || 'Unknown date',
      dueDate: bill.DueDate || 'Unknown date',
      amount,
      amountPaid: Math.max(0, amount - amountRemaining),
      category: bill.AccountRef?.name || 'Uncategorized',
      status,
      daysOverdue: overdue,
      source: 'quickbooks' as const,
    }
  })
}

async function queryAccounts() {
  if (!tokens) throw new Error('QuickBooks is not connected.')
  if (tokens.expiresAt <= Date.now()) throw new Error('QuickBooks access token has expired. Reconnect to continue.')

  const url = new URL(`${sandboxBaseUrl}/v3/company/${tokens.realmId}/query`)
  url.searchParams.set('query', 'SELECT * FROM Account STARTPOSITION 1 MAXRESULTS 1000')
  url.searchParams.set('minorversion', '75')
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`QuickBooks Account request failed (${response.status}).`)
  const result = await response.json() as QuickBooksQueryResponse
  return result.QueryResponse?.Account || []
}
