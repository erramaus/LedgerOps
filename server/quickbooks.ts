import crypto from 'node:crypto'

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
  AccountBasedExpenseLine?: Array<{ AccountBasedExpenseLineDetail?: { AccountRef?: { value?: string; name?: string } } }>
  ItemBasedExpenseLine?: Array<unknown>
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
const pendingStates = new Set<string>()

function getConfig() {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET
  const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI
  const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox'

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('QuickBooks environment variables are not configured.')
  }

  if (environment !== 'sandbox') {
    throw new Error('Only the QuickBooks sandbox environment is enabled.')
  }

  return { clientId, clientSecret, redirectUri }
}

export function createAuthorizationUrl() {
  const config = getConfig()
  const state = crypto.randomBytes(24).toString('hex')
  pendingStates.add(state)

  const url = new URL(authorizationUrl)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scope)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('state', state)
  return url.toString()
}

export async function exchangeCode(code: string, state: string, realmId: string) {
  const config = getConfig()
  if (!pendingStates.delete(state)) {
    throw new Error('Invalid or expired OAuth state.')
  }

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
  const transactions = results.flat().map((item) => {
    const payee = item.EntityRef?.name || item.VendorRef?.name || item.CustomerRef?.name || 'Unknown'
    const category = item.AccountRef?.name || 'Uncategorized'
    const description = item.PrivateNote || item.Memo || `${item.transactionType} from QuickBooks`
    const amount = Number(item.Amount ?? item.TotalAmt ?? 0)
    return {
      id: `quickbooks-${item.transactionType}-${item.Id || crypto.randomUUID()}`,
      quickBooksId: item.Id,
      date: item.TxnDate || 'Unknown date',
      payee,
      description,
      amount: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount),
      category,
      status: category === 'Uncategorized' ? 'Needs Review' as const : 'Categorized' as const,
      transactionType: item.transactionType,
      source: 'quickbooks' as const,
    }
  })

  return transactions.sort((left, right) => right.date.localeCompare(left.date))
}

export async function updateTransactionAccount(transactionType: string, transactionId: string, accountName: string) {
  if (transactionType !== 'Purchase' && transactionType !== 'Check') {
    throw new Error('This transaction type is read-only for now.')
  }
  if (!tokens) throw new Error('QuickBooks is not connected.')
  if (tokens.expiresAt <= Date.now()) throw new Error('QuickBooks access token has expired. Reconnect to continue.')

  const latest = (await getEntityList(transactionType)).find((item) => item.Id === transactionId)
  if (!latest) throw new Error('The QuickBooks transaction could not be found.')
  if (!latest.SyncToken) throw new Error('QuickBooks SyncToken is missing; update was stopped.')
  if (latest.ItemBasedExpenseLine?.length) throw new Error('This transaction type is read-only for now.')
  if (!latest.AccountBasedExpenseLine?.length) throw new Error('This transaction has no safe account-based expense lines to update.')

  const matchingAccount = (await getEntityList('Account')).find((account) => account.Name?.toLowerCase() === accountName.trim().toLowerCase() && account.Active !== false)
  if (!matchingAccount?.Id) throw new Error(`QuickBooks account "${accountName}" was not found.`)

  const payload = {
    ...latest,
    AccountBasedExpenseLine: latest.AccountBasedExpenseLine.map((line) => ({
      ...line,
      AccountBasedExpenseLineDetail: {
        ...line.AccountBasedExpenseLineDetail,
        AccountRef: { value: matchingAccount.Id, name: matchingAccount.Name },
      },
    })),
  }
  const response = await fetch(`${sandboxBaseUrl}/v3/company/${tokens.realmId}/${transactionType.toLowerCase()}?minorversion=75`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`QuickBooks rejected the update (${response.status}).`)
  return response.json()
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
