import type { LedgerAccount, LedgerBill, LedgerContact, LedgerInvoice, LedgerReport, LedgerTransaction } from './bookkeepingTypes'

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

/** Frontend adapter: all secrets and Intuit API calls stay in the backend. */
export const quickBooksService = {
  getStatus: async (): Promise<QuickBooksStatus> => {
    const response = await fetch('/api/quickbooks/status')
    if (!response.ok) throw new Error('Unable to check QuickBooks status.')
    return response.json() as Promise<QuickBooksStatus>
  },
  connect: () => {
    window.location.href = '/api/quickbooks/connect'
  },
  getCompany: async (): Promise<QuickBooksCompany> => {
    const response = await fetch('/api/quickbooks/company')
    const result = await response.json() as QuickBooksCompany & { error?: string }
    if (!response.ok) throw new Error(result.error || 'Unable to load company information.')
    return result
  },
  getTransactions: async (): Promise<LedgerTransaction[]> => {
    const response = await fetch('/api/quickbooks/transactions')
    const result = await response.json() as { transactions?: LedgerTransaction[]; error?: string }
    if (!response.ok) throw new Error(result.error || 'Unable to load QuickBooks transactions.')
    return result.transactions || []
  },
  getAccounts: async (): Promise<LedgerAccount[]> => {
    const response = await fetch('/api/quickbooks/accounts')
    const result = await response.json() as { accounts?: LedgerAccount[]; error?: string }
    if (!response.ok) throw new Error(result.error || 'Unable to load QuickBooks accounts.')
    return result.accounts || []
  },
  getCustomers: async (): Promise<LedgerContact[]> => {
    const response = await fetch('/api/quickbooks/customers')
    const result = await response.json() as { customers?: LedgerContact[]; error?: string }
    if (!response.ok) throw new Error(result.error || 'Unable to load QuickBooks customers.')
    return result.customers || []
  },
  getVendors: async (): Promise<LedgerContact[]> => {
    const response = await fetch('/api/quickbooks/vendors')
    const result = await response.json() as { vendors?: LedgerContact[]; error?: string }
    if (!response.ok) throw new Error(result.error || 'Unable to load QuickBooks vendors.')
    return result.vendors || []
  },
  getInvoices: async (): Promise<LedgerInvoice[]> => {
    const response = await fetch('/api/quickbooks/invoices')
    const result = await response.json() as { invoices?: LedgerInvoice[]; error?: string }
    if (!response.ok) throw new Error(result.error || 'Unable to load QuickBooks invoices.')
    return result.invoices || []
  },
  getBills: async (): Promise<LedgerBill[]> => {
    const response = await fetch('/api/quickbooks/bills')
    const result = await response.json() as { bills?: LedgerBill[]; error?: string }
    if (!response.ok) throw new Error(result.error || 'Unable to load QuickBooks bills.')
    return result.bills || []
  },
  getReport: async (report: 'profit-loss' | 'balance-sheet' | 'cash-flow', period: string): Promise<LedgerReport> => {
    const response = await fetch(`/api/quickbooks/reports/${report}?period=${encodeURIComponent(period)}`)
    const result = await response.json() as LedgerReport & { error?: string }
    if (!response.ok) throw new Error(result.error || 'Unable to load QuickBooks report.')
    return result
  },
  updateTransactionAccount: async (transactionType: string, transactionId: string, accountName: string) => {
    const response = await fetch(`/api/quickbooks/transactions/${encodeURIComponent(transactionType)}/${encodeURIComponent(transactionId)}/account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountName }),
    })
    const result = await response.json() as { error?: string }
    if (!response.ok) throw new Error(result.error || 'Unable to update QuickBooks transaction.')
  },
}
