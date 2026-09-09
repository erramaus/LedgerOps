import type { Bill, Invoice, Transaction } from '../data/demoData'

export type {
  Bill,
  BillStatus,
  Client,
  ClientRequest,
  ClientRequestStatus,
  InboxItem,
  InboxType,
  Invoice,
  InvoiceStatus,
  MonthEndItem,
  MonthEndStatus,
  ReconciliationAccount,
  ReconciliationTransaction,
  TransactionStatus,
  WorkItem,
} from '../data/demoData'

export type { Transaction } from '../data/demoData'

export type LedgerContact = {
  quickBooksId?: string
  name: string
  companyName?: string
  email?: string
  balance: number
  active: boolean
}

export type LedgerInvoice = Invoice & {
  quickBooksId?: string
  daysOverdue?: number
  source?: 'demo' | 'quickbooks'
}

export type LedgerBill = Bill & {
  quickBooksId?: string
  daysOverdue?: number
  source?: 'demo' | 'quickbooks'
}

export type LedgerTransaction = Transaction & {
  quickBooksId?: string
  transactionType?: string
  source?: 'demo' | 'quickbooks'
}

export type LedgerAccount = {
  quickBooksId?: string
  name: string
  accountType: string
  accountSubType?: string
  currentBalance: number
  active: boolean
  currency?: string
}

export type ReportLine = {
  label: string
  amount: number
}

export type DemoReportData = {
  income: ReportLine[]
  expenses: ReportLine[]
  assets: ReportLine[]
  liabilities: ReportLine[]
  equity: ReportLine[]
  cashFlow: ReportLine[]
}

export type LedgerReportSection = {
  label: string
  lines: ReportLine[]
}

export type LedgerReport = {
  reportName: string
  sections: LedgerReportSection[]
  totals: ReportLine[]
}
