import {
  clientRequests,
  clients,
  demoBills,
  demoClient,
  demoInvoices,
  demoTransactions,
  inboxItems,
  monthEndItems,
  navigationItems,
  reconciliationAccounts,
  todaysWork,
} from '../data/demoData'
import type { DemoReportData } from './bookkeepingTypes'

// This is the active data provider while LedgerOps is running in demo mode.
export const demoDataService = {
  clients,
  demoClient,
  transactions: demoTransactions,
  reconciliationAccounts,
  invoices: demoInvoices,
  bills: demoBills,
  reports: {
    income: [
      { label: 'Service Revenue', amount: 83000 },
      { label: 'Other Income', amount: 1260 },
    ],
    expenses: [
      { label: 'Materials', amount: 18240 },
      { label: 'Fuel', amount: 4210 },
      { label: 'Payroll', amount: 21800 },
      { label: 'Office Supplies', amount: 1240 },
      { label: 'Utilities', amount: 2970 },
      { label: 'Insurance', amount: 2860 },
      { label: 'Other Expenses', amount: 1098 },
    ],
    assets: [
      { label: 'Bank Accounts', amount: 48421.72 },
      { label: 'Equipment', amount: 18500 },
    ],
    liabilities: [
      { label: 'Credit Cards', amount: 6010.3 },
      { label: 'Loans', amount: 12000 },
    ],
    equity: [
      { label: 'Owner Equity', amount: 25000 },
    ],
    cashFlow: [
      { label: 'Cash from Operations', amount: 28600 },
      { label: 'Cash from Investing', amount: -4500 },
      { label: 'Cash from Financing', amount: 2000 },
    ],
  } satisfies DemoReportData,
  inboxItems,
  clientRequests,
  monthEndItems,
  todaysWork,
  navigationItems,
}
