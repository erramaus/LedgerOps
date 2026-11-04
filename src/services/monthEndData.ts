// Turns the records the app already holds into month-end checklist inputs. Pure, and used for both data sources.
import type { AccountClass, ReportTable } from '../../shared/accounting'
import { known, unknown, type AccountRecon, type Availability, type Checklist, type MonthEndInputs, type MonthEndRecord, type OpenItemFacts, type TransactionFacts, type UnusualFacts, type StatementFacts } from '../../shared/monthEnd'
import { figureFrom, openItemFacts, reconFactsFor, statementFacts, unusualBalances, type BalanceLine, type ReconRecordLike } from '../../shared/monthEndFacts'
import { isInPeriod, normalizeDate, periodEnd, periodKey, type Period } from '../../shared/period'
import { agingTotalCents } from '../../shared/qbReports'
import { parseMoneyToCents } from '../../shared/reconciliation'
import type { ClientRequest, LedgerAccount, LedgerTransaction, MonthEndItem, Transaction } from './bookkeepingTypes'
import { buildReviewTasks } from './workQueue'

export type Loaded<T> = { ok: true; value: T } | { ok: false; reason: string }
export const loaded = <T,>(value: T): Loaded<T> => ({ ok: true, value })
export const failed = <T,>(reason: string): Loaded<T> => ({ ok: false, reason })

/**
 * A request belongs to a month when its transaction is dated in it, or it matches a transaction in it by payee and amount.
 * A request that cannot be tied to a transaction at all is placed in the month it was created, so it is never silently ignored.
 */
function requestIsInPeriod(request: ClientRequest, inPeriod: Transaction[], period: Period) {
  const date = normalizeDate(request.transactionDate)
  if (date) return isInPeriod(date, period)
  const amount = request.relatedAmount ? parseMoneyToCents(request.relatedAmount) : null
  const matched = Boolean(request.relatedTransaction) && inPeriod.some((transaction) => transaction.payee === request.relatedTransaction && (amount === null || parseMoneyToCents(transaction.amount) === amount))
  if (matched) return true
  const created = normalizeDate(request.dateCreated)
  return created !== null && isInPeriod(created, period)
}

/** Counts, for one month, what the bookkeeping review rules find. `undated` transactions cannot be placed in any month. */
export function transactionFacts(period: Period, transactions: Transaction[], requests: ClientRequest[]): { facts: TransactionFacts; undated: number } {
  const dated = transactions.map((transaction) => ({ transaction, date: normalizeDate(transaction.date) }))
  const inPeriod = dated.filter((item) => item.date && isInPeriod(item.date, period)).map((item) => item.transaction)
  const tasks = buildReviewTasks({ client: { id: 'month-end', name: 'month-end' }, transactions: inPeriod, invoices: [], bills: [], accounts: [], reconciliations: [], requests: [], monthEnd: [] })
  const count = (kind: string) => tasks.filter((task) => task.kind === kind).length
  return {
    undated: dated.filter((item) => !item.date).length,
    facts: {
      total: inPeriod.length,
      uncategorized: count('uncategorized'),
      possibleDuplicates: count('possible-duplicate'),
      missingReceipts: count('needs-receipt'),
      missingPayees: count('missing-payee'),
      openClientRequests: requests.filter((request) => request.status !== 'Completed' && requestIsInPeriod(request, inPeriod, period)).length,
    },
  }
}

const CLASS_BY_TYPE: Record<string, AccountClass> = {
  Bank: 'asset', 'Accounts Receivable': 'asset', 'Other Current Asset': 'asset', 'Fixed Asset': 'asset', 'Other Asset': 'asset',
  'Accounts Payable': 'liability', 'Credit Card': 'liability', 'Other Current Liability': 'liability', 'Long Term Liability': 'liability',
  Equity: 'equity', Income: 'income', 'Cost of Goods Sold': 'cogs', Expense: 'expense', 'Other Income': 'other_income', 'Other Expense': 'other_expense',
}

/** Unusual balances from a QuickBooks Trial Balance, classified by the account types QuickBooks reports. */
export function quickBooksUnusual(trialBalance: ReportTable, accounts: LedgerAccount[]) {
  const byName = new Map(accounts.map((account) => [account.name.trim().toLowerCase(), account]))
  const lines: BalanceLine[] = []
  let unclassified = 0
  for (const row of trialBalance.rows) {
    if (row.style !== 'normal') continue
    const [debit, credit] = row.cells
    if (debit === null && credit === null) continue
    const klass = CLASS_BY_TYPE[byName.get(row.label.trim().toLowerCase())?.accountType ?? '']
    if (!klass) { unclassified += 1; continue }
    lines.push({ name: row.label, klass, debitMinusCreditCents: (debit ?? 0) - (credit ?? 0) })
  }
  const facts = unusualBalances(lines)
  if (unclassified > 0) facts.findings.push(`${unclassified} account${unclassified === 1 ? '' : 's'} in the trial balance could not be matched to a QuickBooks account type, so ${unclassified === 1 ? 'its' : 'their'} balance sign was not checked.`)
  return facts
}

/** Open balances from a QuickBooks aging report. Rows are customers or vendors, not documents. */
export function quickBooksOpenItems(table: ReportTable, unit: string, asOf?: string): { facts: OpenItemFacts | null; reason?: string } {
  const total = agingTotalCents(table)
  const grand = table.rows.find((row) => row.style === 'grand')
  const currentIndex = table.columns.findIndex((column) => column.label.trim().toLowerCase() === 'current')
  const current = grand && currentIndex >= 0 ? grand.cells[currentIndex] : null
  if (total === null || current === null || current === undefined) return { facts: null, reason: 'The aging report total or its current column could not be read.' }
  const rows = table.rows.filter((row) => row.style === 'normal')
  const last = table.columns.length - 1
  const open = rows.filter((row) => (row.cells[last] ?? 0) > 0)
  const overdue = open.filter((row) => (row.cells[last] ?? 0) - (row.cells[currentIndex] ?? 0) > 0)
  const result = openItemFacts(table, { totalCents: total, itemCount: open.length, overdueCount: overdue.length, overdueCents: total - current })
  return result.facts ? { facts: { ...result.facts, unit, ...(asOf ? { asOf } : {}) } } : result
}

export type QuickBooksPeriodData = {
  transactions: Loaded<LedgerTransaction[]>
  accounts: Loaded<LedgerAccount[]>
  profitLoss: Loaded<ReportTable>
  balanceSheet: Loaded<ReportTable>
  trialBalance: Loaded<ReportTable>
  receivables: Loaded<ReportTable>
  payables: Loaded<ReportTable>
}

type Context = { records: ReconRecordLike[]; signoffs: MonthEndRecord['signoffs']; closing?: MonthEndRecord['closing']; requests: ClientRequest[] }

export function quickBooksInputs(period: Period, data: QuickBooksPeriodData, context: Context): MonthEndInputs {
  const key = periodKey(period)
  const accountFacts = (kind: 'Bank' | 'Credit Card'): Availability<AccountRecon[]> => {
    if (!data.accounts.ok) return unknown(data.accounts.reason)
    const wanted = data.accounts.value.filter((account) => account.active && account.quickBooksId && account.accountType === kind)
    return known(reconFactsFor(wanted.map((account) => ({ id: account.quickBooksId!, name: account.name, kind: kind === 'Bank' ? ('bank' as const) : ('credit_card' as const) })), context.records, key))
  }
  const open = (table: Loaded<ReportTable>, unit: string) => {
    if (!table.ok) return unknown<OpenItemFacts>(table.reason)
    const result = quickBooksOpenItems(table.value, unit, periodEnd(period))
    return result.facts ? known(result.facts) : unknown<OpenItemFacts>(result.reason ?? 'Not available.')
  }

  let transactions: Availability<TransactionFacts>
  if (!data.transactions.ok) transactions = unknown(data.transactions.reason)
  else {
    const result = transactionFacts(period, data.transactions.value, context.requests)
    transactions = result.undated > 0 ? unknown(`${result.undated} transaction${result.undated === 1 ? ' has' : 's have'} no valid date, so they cannot be placed in a month.`) : known(result.facts)
  }

  const unusual: Availability<UnusualFacts> = !data.trialBalance.ok ? unknown(data.trialBalance.reason)
    : !data.accounts.ok ? unknown(`The account types could not be read: ${data.accounts.reason}`)
    : data.trialBalance.value.checks.some((check) => check.status === 'fail') ? unknown('The trial balance does not add up, so its balances cannot be relied on.')
    : known(quickBooksUnusual(data.trialBalance.value, data.accounts.value))

  const statements: Availability<StatementFacts> = !data.profitLoss.ok ? unknown(`Profit and Loss: ${data.profitLoss.reason}`)
    : !data.balanceSheet.ok ? unknown(`Balance Sheet: ${data.balanceSheet.reason}`)
    : known(statementFacts(data.profitLoss.value, data.balanceSheet.value, figureFrom(data.profitLoss.value, /^net income$/), figureFrom(data.balanceSheet.value, /^total assets$/)))

  return {
    period: key, transactions, bankAccounts: accountFacts('Bank'), cardAccounts: accountFacts('Credit Card'),
    receivables: open(data.receivables, 'customer balance'), payables: open(data.payables, 'vendor balance'),
    unusual, statements, signoffs: context.signoffs, closing: context.closing,
  }
}

/** The shape the dashboard and work queue already understand, derived from the real checklist (the approval step is not counted). */
export function toMonthEndItems(checklist: Checklist | null): MonthEndItem[] {
  if (!checklist) return []
  return checklist.items
    .filter((item) => item.id !== 'approval')
    .map((item) => ({
      id: item.id,
      label: item.title,
      status: item.status === 'Complete' ? 'Complete' : item.status === 'Not Started' ? 'Not Started' : item.status === 'Blocked' && item.attention.startsWith('Cannot be checked') ? 'Not Available' : 'Needs Attention',
      explanation: item.attention,
      relatedView: item.action?.view === 'Bookkeeping Review' ? 'Transactions' : item.action?.view,
      relatedLabel: item.action?.label,
    }))
}
