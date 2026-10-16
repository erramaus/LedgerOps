import { demoReport, demoClientFigures } from '../../shared/demoMonthEnd'
import { balanceAt, profitAndLossSummary } from '../../shared/accounting'
import type { DemoCompanyBooks } from '../../shared/demoCompanyBooks'
import type { DemoPaymentBook } from '../../shared/demoPayments'
import type { Bill, Client, ClientRequest, Invoice, ReconciliationAccount, ReconciliationTransaction, Transaction } from './bookkeepingTypes'
import { formatCents } from '../../shared/reconciliation'

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const displayDate = (date: string) => `${months[Number(date.slice(5, 7)) - 1]} ${date.slice(8, 10)}, ${date.slice(0, 4)}`
const isoFromDisplay = (date: string) => date

export function companyClient(company: DemoCompanyBooks): Client {
  const period = { year: 2026, month: 8 }
  const figures = demoClientFigures(period, company.ledger)
  const august = company.statements.filter((statement) => statement.period.month === 8)
  const discrepancy = august.some((statement) => {
    const opening = balanceAt(company.ledger.accounts, company.ledger.entries, statement.accountId.endsWith('-checking') ? 'checking' : 'card', statement.periodEnd)
    return opening !== statement.endingCents
  })
  const active = company.transactions.filter((transaction) => transaction.date >= '2026-08-01' && transaction.date <= '2026-08-31')
  const needsAttention = active.filter((transaction) => transaction.status === 'Needs Review' || transaction.status === 'Needs Receipt').length
  return {
    id: company.clientId,
    name: company.clientName,
    initials: company.clientName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
    status: needsAttention > 0 || discrepancy ? 'Needs attention' : 'On track',
    month: 'August 2026',
    attention: needsAttention + Number(discrepancy) + company.requests.length,
    reconciliation: discrepancy ? 'Needs review' : 'Ready to complete',
    monthEnd: 56,
    income: formatCents(figures.incomeCents),
    expenses: formatCents(figures.expensesCents),
    profit: formatCents(figures.profitCents),
    bankBalance: formatCents(figures.bankBalanceCents),
    accountsReceivable: formatCents(figures.receivableCents),
    accountsPayable: formatCents(figures.payableCents),
  }
}

export function companyTransactions(company: DemoCompanyBooks): Transaction[] {
  return company.transactions.map((transaction) => {
    const categoryName = company.ledger.accounts.find((account) => account.id === transaction.categoryId)?.name ?? transaction.categoryId
    const lines = transaction.lines?.map((line) => ({ id: line.id, description: line.description, amount: line.amountCents / 100, category: company.ledger.accounts.find((account) => account.id === line.categoryId)?.name ?? line.categoryId, categoryId: line.categoryId }))
    return {
      id: transaction.id,
      date: displayDate(transaction.date),
      payee: transaction.payee,
      description: transaction.description,
      amount: formatCents(transaction.amountCents),
      category: lines ? 'Split' : categoryName,
      status: transaction.status,
      account: company.ledger.accounts.find((account) => account.id === transaction.accountId)?.name,
      clientId: company.clientId,
      ...(lines ? { lines } : {}),
      ...(transaction.status === 'Needs Review' ? { suggestedCategory: categoryName } : {}),
    }
  })
}

export function companyInvoices(company: DemoCompanyBooks, books: DemoPaymentBook[] = []): Invoice[] {
  return company.invoices.map((document) => {
    const amountPaidCents = document.payments.reduce((sum, payment) => sum + payment.amountCents, 0) + books.filter((book) => book.clientId === company.clientId && book.kind === 'invoice' && book.documentId === document.id).flatMap((book) => book.payments).reduce((sum, payment) => sum + (payment.status === 'active' ? payment.amountCents : 0), 0)
    const remaining = document.amountCents - amountPaidCents
    const overdue = document.dueDate < '2026-10-15' && remaining > 0
    return { id: document.id, customer: document.party, number: document.number, invoiceDate: displayDate(document.date), dueDate: displayDate(document.dueDate), amount: document.amountCents / 100, amountPaid: amountPaidCents / 100, status: remaining <= 0 ? 'Paid' : overdue ? 'Overdue' : amountPaidCents > 0 ? 'Partially Paid' : 'Open' }
  })
}

export function companyBills(company: DemoCompanyBooks, books: DemoPaymentBook[] = []): Bill[] {
  return company.bills.map((document) => {
    const amountPaidCents = document.payments.reduce((sum, payment) => sum + payment.amountCents, 0) + books.filter((book) => book.clientId === company.clientId && book.kind === 'bill' && book.documentId === document.id).flatMap((book) => book.payments).reduce((sum, payment) => sum + (payment.status === 'active' ? payment.amountCents : 0), 0)
    const remaining = document.amountCents - amountPaidCents
    const overdue = document.dueDate < '2026-10-15' && remaining > 0
    return { id: document.id, vendor: document.party, number: document.number, billDate: displayDate(document.date), dueDate: displayDate(document.dueDate), amount: document.amountCents / 100, amountPaid: amountPaidCents / 100, category: company.ledger.accounts.find((account) => account.id === document.accountId)?.name ?? document.accountId, status: remaining <= 0 ? 'Paid' : amountPaidCents > 0 ? 'Partially Paid' : overdue ? 'Overdue' : 'Open' }
  })
}

export function companyRequests(company: DemoCompanyBooks): ClientRequest[] {
  return company.requests.map((request) => ({ ...request, clientId: company.clientId }))
}

export function companyReconciliationAccounts(company: DemoCompanyBooks): ReconciliationAccount[] {
  return company.reconciliationAccounts.map((account) => {
    const August = company.statements.find((statement) => statement.accountId === account.id && statement.period.month === 8)!
    const book = balanceAt(company.ledger.accounts, company.ledger.entries, account.ledgerId, August.periodEnd)
    const transactions: ReconciliationTransaction[] = August.transactions.map((transaction) => ({ id: transaction.id, date: displayDate(transaction.date), payee: transaction.payee, amount: transaction.amountCents / 100, type: transaction.direction === 'increase' && account.kind === 'bank' ? 'Deposit' : 'Withdrawal', cleared: true }))
    return {
      id: account.id,
      name: account.name,
      lastReconciled: 'February 28, 2026',
      statementEnding: displayDate(August.periodEnd),
      quickBooksBalance: book / 100,
      statementBalance: August.endingCents / 100,
      status: book === August.endingCents ? 'Ready to complete' : 'Difference to resolve',
      transactions,
      possibleProblems: book === August.endingCents ? [] : ['The statement and register need review.'],
    }
  })
}

export function companyReconSources(company: DemoCompanyBooks, period: { year: number; month: number }) {
  return company.reconciliationAccounts.map((account) => {
    const statement = company.statements.find((item) => item.accountId === account.id && item.period.year === period.year && item.period.month === period.month)
    if (!statement) return null
    return { ...statement, name: account.name, lastReconciled: 'February 28, 2026' }
  }).filter((item): item is NonNullable<typeof item> => item !== null)
}

export function companyLedgerRegister(company: DemoCompanyBooks, ledgerId: 'checking' | 'card', through: string) {
  return company.ledger.entries.filter((entry) => entry.id !== `${company.clientId}-opening` && entry.date <= through).flatMap((entry) => {
    const line = entry.lines.find((candidate) => candidate.accountId === ledgerId)
    if (!line) return []
    const direction = ledgerId === 'checking' ? line.debitCents > 0 ? 'increase' as const : 'decrease' as const : line.creditCents > 0 ? 'increase' as const : 'decrease' as const
    return [{ id: entry.id, date: entry.date, payee: entry.memo, memo: '', amountCents: line.debitCents || line.creditCents, direction }]
  })
}

export function companyMonthEndItems(company: DemoCompanyBooks, currentPeriod: { year: number; month: number }, completedAccountIds: string[] = []) {
  const key = `${currentPeriod.year}-${String(currentPeriod.month).padStart(2, '0')}`
  const scenario = company.reviewScenarios[key]
  if (!scenario) return []
  const records = completedAccountIds
  const bankDone = company.reconciliationAccounts.filter((item) => item.kind === 'bank').every((item) => records.includes(item.id))
  const cardDone = company.reconciliationAccounts.filter((item) => item.kind === 'credit_card').every((item) => records.includes(item.id))
  const transactions = company.transactions.filter((transaction) => transaction.date.startsWith(key))
  const uncategorized = transactions.filter((transaction) => transaction.status === 'Needs Review').length
  const result = demoReport('trial-balance', { start: `${key}-01`, end: `${key}-31`, label: key }, company.ledger)
  const unusual = result.checks.every((check) => check.status === 'pass')
  const invoicePeriod = companyInvoices(company).filter((invoice) => isoFromDisplay(invoice.invoiceDate).includes(months[currentPeriod.month - 1]))
  void invoicePeriod
  return [
    { id: 'month-bank', label: 'Bank reconciliation', status: bankDone ? 'Complete' : 'Needs Attention', explanation: bankDone ? 'Bank reconciliation completed.' : 'Reconcile the company checking account.', relatedView: 'Reconcile' as const, relatedLabel: 'Open Reconcile' },
    { id: 'month-card', label: 'Credit card reconciliation', status: cardDone ? 'Complete' : 'Needs Attention', explanation: cardDone ? 'Card reconciliation completed.' : 'Reconcile the company credit card.', relatedView: 'Reconcile' as const, relatedLabel: 'Open Reconcile' },
    { id: 'month-uncategorized', label: 'Uncategorized transactions reviewed', status: uncategorized === 0 ? 'Complete' : 'Needs Attention', explanation: `${uncategorized} transactions need category review.`, relatedView: 'Transactions' as const, relatedLabel: 'Review transactions' },
    { id: 'month-receipts', label: 'Missing receipts resolved', status: scenario.missingReceipts === 0 ? 'Complete' : 'Needs Attention', explanation: `${scenario.missingReceipts} receipts need review.`, relatedView: 'Transactions' as const, relatedLabel: 'Review transactions' },
    { id: 'month-receivables', label: 'Accounts receivable reviewed', status: 'Not Started' as const, explanation: 'Review open customer invoices.', relatedView: 'Receivables' as const, relatedLabel: 'Open Receivables' },
    { id: 'month-payables', label: 'Accounts payable reviewed', status: 'Not Started' as const, explanation: 'Review open vendor bills.', relatedView: 'Payables' as const, relatedLabel: 'Open Payables' },
    { id: 'month-reports', label: 'Financial reports reviewed', status: unusual ? 'Not Started' as const : 'Needs Attention' as const, explanation: 'Review the monthly statements.', relatedView: 'Reports' as const, relatedLabel: 'Open Reports' },
  ]
}
