import type { LedgerAccount, LedgerBill, LedgerContact, LedgerInvoice, LedgerReport, LedgerTransaction } from './bookkeepingTypes'
import { apiFetch } from './apiClient'
import type { ConnectionReading } from './settingsStatus'
import type { Completeness, ReconTxn } from '../../shared/reconciliation'
import type { ReportId } from '../../shared/accounting'
import type { QbReportJson } from '../../shared/qbReports'

export type ListCompleteness = { transactions: Completeness; invoices: Completeness; bills: Completeness; accounts: Completeness }

/** A failed update, with the server's machine-readable reason (e.g. STALE, UNSUPPORTED). */
export class QuickBooksUpdateError extends Error {
  readonly code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'QuickBooksUpdateError'
    this.code = code
  }
}

export type QuickBooksStatus = {
  connected: boolean
  environment: 'sandbox'
}

export type QuickBooksCompany = {
  CompanyName?: string
  LegalName?: string
  Country?: string
  FiscalYearStartMonth?: string
}

const intuitAuthorizationPrefix = 'https://appcenter.intuit.com/connect/oauth2'

/** Frontend adapter: all secrets and Intuit API calls stay in the backend. */
export const quickBooksService = {
  getStatus: async (): Promise<QuickBooksStatus> => {
    const response = await apiFetch('/api/quickbooks/status')
    if (!response.ok) throw new Error('Unable to check QuickBooks status.')
    return response.json() as Promise<QuickBooksStatus>
  },
  /** Read-only status check that keeps the HTTP outcome, so Settings can tell "not connected" from "sign-in needed" or "server down". */
  readConnection: async (): Promise<ConnectionReading> => {
    let response: Response
    try {
      response = await apiFetch('/api/quickbooks/status')
    } catch {
      return { kind: 'network' }
    }
    const json = await response.json().catch(() => null) as { connected?: boolean; error?: string } | null
    return { kind: 'response', status: response.status, json }
  },
  /** Asks the server for a session-bound authorization URL, then sends the browser to Intuit. */
  connect: async () => {
    const response = await apiFetch('/api/quickbooks/connect', { method: 'POST' })
    const result = await response.json() as { authorizationUrl?: string; error?: string }
    if (!response.ok || !result.authorizationUrl) throw new Error(result.error || 'Unable to start the QuickBooks connection.')
    if (!result.authorizationUrl.startsWith(intuitAuthorizationPrefix)) throw new Error('Received an unexpected QuickBooks authorization address.')
    window.location.assign(result.authorizationUrl)
  },
  getCompany: async (): Promise<QuickBooksCompany> => {
    const response = await apiFetch('/api/quickbooks/company')
    const result = await response.json() as QuickBooksCompany & { error?: string }
    if (!response.ok) throw new Error(result.error || 'Unable to load company information.')
    return result
  },
  getTransactions: async (): Promise<LedgerTransaction[]> => {
    const response = await apiFetch('/api/quickbooks/transactions')
    const result = await response.json() as { transactions?: LedgerTransaction[]; error?: string }
    if (!response.ok) throw new Error(result.error || 'Unable to load QuickBooks transactions.')
    return result.transactions || []
  },
  /** Read-only. Never changes QuickBooks. */
  getReconciliationData: async (accountId: string, through: string): Promise<{ transactions: ReconTxn[]; completeness: Completeness }> => {
    const response = await apiFetch(`/api/quickbooks/reconciliation/${encodeURIComponent(accountId)}?through=${encodeURIComponent(through)}`)
    const result = await response.json().catch(() => ({})) as { transactions?: ReconTxn[]; completeness?: Completeness; error?: string }
    if (!response.ok || !result.transactions || !result.completeness) throw new Error(result.error || 'Unable to read QuickBooks transactions for reconciliation.')
    return { transactions: result.transactions, completeness: result.completeness }
  },
  getAccounts: async (): Promise<LedgerAccount[]> => {
    const response = await apiFetch('/api/quickbooks/accounts')
    const result = await response.json() as { accounts?: LedgerAccount[]; error?: string }
    if (!response.ok) throw new Error(result.error || 'Unable to load QuickBooks accounts.')
    return result.accounts || []
  },
  getCustomers: async (): Promise<LedgerContact[]> => {
    const response = await apiFetch('/api/quickbooks/customers')
    const result = await response.json() as { customers?: LedgerContact[]; error?: string }
    if (!response.ok) throw new Error(result.error || 'Unable to load QuickBooks customers.')
    return result.customers || []
  },
  getVendors: async (): Promise<LedgerContact[]> => {
    const response = await apiFetch('/api/quickbooks/vendors')
    const result = await response.json() as { vendors?: LedgerContact[]; error?: string }
    if (!response.ok) throw new Error(result.error || 'Unable to load QuickBooks vendors.')
    return result.vendors || []
  },
  getInvoices: async (): Promise<LedgerInvoice[]> => {
    const response = await apiFetch('/api/quickbooks/invoices')
    const result = await response.json() as { invoices?: LedgerInvoice[]; error?: string }
    if (!response.ok) throw new Error(result.error || 'Unable to load QuickBooks invoices.')
    return result.invoices || []
  },
  getBills: async (): Promise<LedgerBill[]> => {
    const response = await apiFetch('/api/quickbooks/bills')
    const result = await response.json() as { bills?: LedgerBill[]; error?: string }
    if (!response.ok) throw new Error(result.error || 'Unable to load QuickBooks bills.')
    return result.bills || []
  },
  /** Read-only. One QuickBooks report for exact dates; every figure is QuickBooks' own. */
  getReportData: async (report: ReportId, start: string, end: string): Promise<QbReportJson> => {
    const response = await apiFetch(`/api/quickbooks/report-data/${report}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)
    const result = await response.json().catch(() => ({})) as { report?: QbReportJson; error?: string }
    if (!response.ok || !result.report) throw new Error(result.error || 'Unable to load the QuickBooks report.')
    return result.report
  },
  /** Read-only. Whether the lists loaded above hold everything QuickBooks has, or were cut off at a page limit. */
  getListCompleteness: async (): Promise<ListCompleteness> => {
    const response = await apiFetch('/api/quickbooks/list-completeness')
    const result = await response.json().catch(() => ({})) as Partial<ListCompleteness> & { error?: string }
    if (!response.ok || !result.transactions || !result.invoices || !result.bills || !result.accounts) throw new Error(result.error || 'Unable to check that the QuickBooks lists are complete.')
    return result as ListCompleteness
  },
  getReport: async (report: 'profit-loss' | 'balance-sheet' | 'cash-flow', period: string): Promise<LedgerReport> => {
    const response = await apiFetch(`/api/quickbooks/reports/${report}?period=${encodeURIComponent(period)}`)
    const result = await response.json() as LedgerReport & { error?: string }
    if (!response.ok) throw new Error(result.error || 'Unable to load QuickBooks report.')
    return result
  },
  /** Changes the account on specific lines only; the server re-reads, validates and returns the refreshed transaction. */
  updateTransactionLines: async (transaction: LedgerTransaction, changes: { lineId: string; accountId: string }[]): Promise<LedgerTransaction> => {
    if (!transaction.quickBooksId || !transaction.transactionType || !transaction.syncToken || transaction.totalAmount === undefined) {
      throw new QuickBooksUpdateError('This transaction is missing the details needed to update it safely.', 'UNSUPPORTED')
    }
    const response = await apiFetch(`/api/quickbooks/transactions/${encodeURIComponent(transaction.transactionType)}/${encodeURIComponent(transaction.quickBooksId)}/lines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncToken: transaction.syncToken, expectedTotal: transaction.totalAmount, changes }),
    })
    const result = await response.json().catch(() => ({})) as { transaction?: LedgerTransaction; error?: string; code?: string }
    if (!response.ok || !result.transaction) throw new QuickBooksUpdateError(result.error || 'Unable to update QuickBooks transaction.', result.code)
    return result.transaction
  },
}
