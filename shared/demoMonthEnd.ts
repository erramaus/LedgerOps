// Demo Data month-end inputs, reports and scenario seed records, all calculated from shared/demoBooks.ts.
// None of this is ever consulted in QuickBooks mode.
import {
  aging, balanceSheet, balanceSheetSummary, balanceAt, cashFlow, generalLedger, openBalanceCents, profitAndLoss, profitAndLossSummary, trialBalance, withComparison,
  type ReportId, type ReportTable,
} from './accounting.js'
import {
  DEMO_CLIENT_ID, DEMO_CLIENT_NAME, DEMO_PERIODS, DEMO_RECONCILIATION_ACCOUNTS, demoLedger, demoPayableItems, demoPeriodReviews, demoReceivableItems, demoRegister,
} from './demoBooks.js'
import { buildChecklist, known, monthEndId, SIGNOFF_STEPS, unknown, type Availability, type MonthEndInputs, type MonthEndRecord, type OpenItemFacts, type Signoff, type TransactionFacts } from './monthEnd.js'
import { openItemFacts, reconFactsFor, statementFacts, unusualBalances, figureFrom, type ReconRecordLike } from './monthEndFacts.js'
import { parsePeriodKey, periodEnd, periodKey, periodStart, previousPeriod, type DateRange, type Period } from './period.js'
import { computeReconciliation, formatCents, reconciliationId, summarizeResult, type ReconciliationRecord, type ReconTxn } from './reconciliation.js'

const { accounts, entries } = demoLedger

export const hasDemoBooks = (period: Period) => DEMO_PERIODS.some((candidate) => candidate.year === period.year && candidate.month === period.month)
export const DEMO_NO_BOOKS = 'The demo books only cover May to August 2026.'

export type ReportSet = Record<ReportId, ReportTable>

/** Every report for a date range, calculated from the ledger. A range outside the demo books is reported as unavailable by the caller. */
export function demoReport(id: ReportId, range: DateRange): ReportTable {
  const table = (() => {
    switch (id) {
      case 'profit-loss': return profitAndLoss(accounts, entries, range.start, range.end)
      case 'balance-sheet': return balanceSheet(accounts, entries, range.end)
      case 'cash-flow': return cashFlow(accounts, entries, range.start, range.end)
      case 'trial-balance': return trialBalance(accounts, entries, range.end)
      case 'general-ledger': return generalLedger(accounts, entries, range.start, range.end)
      case 'ar-aging': return aging('ar-aging', demoReceivableItems(), range.end).table
      default: return aging('ap-aging', demoPayableItems(), range.end).table
    }
  })()
  const arTotal = id === 'ar-aging' ? aging('ar-aging', demoReceivableItems(), range.end).totalCents : undefined
  const apTotal = id === 'ap-aging' ? aging('ap-aging', demoPayableItems(), range.end).totalCents : undefined
  if (arTotal !== undefined || apTotal !== undefined) {
    // The aging must agree with the control account in the ledger: an independent source for the same number.
    const control = id === 'ar-aging' ? 'ar' : 'ap'
    const ledgerBalance = balanceAt(accounts, entries, control, range.end)
    const agrees = ledgerBalance === (arTotal ?? apTotal)
    table.checks.push({ id: 'aging-control', label: `Agrees with ${id === 'ar-aging' ? 'Accounts Receivable' : 'Accounts Payable'} in the ledger`, status: agrees ? 'pass' : 'fail', detail: agrees ? 'The aging and the ledger balance are the same.' : `The aging shows ${formatCents((arTotal ?? apTotal)!)} but the ledger shows ${formatCents(ledgerBalance)}.` })
  }
  return { ...table, meta: { start: range.start, end: range.end, basis: 'Accrual' } }
}

export function demoComparison(id: ReportId, current: DateRange, previous: DateRange): ReportTable | null {
  if (id === 'general-ledger') return null
  const previousInBooks = DEMO_PERIODS.some((period) => periodStart(period) <= previous.end && periodEnd(period) >= previous.start) && previous.start >= '2026-04-30'
  if (!previousInBooks) return null
  const now = demoReport(id, current), then = demoReport(id, previous)
  return { ...withComparison(now, then, { current: current.label, previous: previous.label }, true), meta: now.meta }
}

// --- Month-end inputs ----------------------------------------------------------------------------------------

const asPeriod = (key: string) => parsePeriodKey(key)!

export function demoTransactionFacts(period: Period): TransactionFacts {
  const key = periodKey(period)
  const review = demoPeriodReviews[key]
  const start = periodStart(period), end = periodEnd(period)
  const inMonth = entries.filter((item) => item.id !== 'opening' && item.date >= start && item.date <= end && item.lines.some((line) => line.accountId === 'checking' || line.accountId === 'card'))
  return {
    total: inMonth.length,
    uncategorized: inMonth.filter((item) => item.lines.some((line) => line.accountId === 'uncategorized')).length,
    possibleDuplicates: review?.possibleDuplicates ?? 0, missingReceipts: review?.missingReceipts ?? 0, missingPayees: review?.missingPayees ?? 0, openClientRequests: review?.openClientRequests ?? 0,
  }
}

export function demoOpenItems(kind: 'ar' | 'ap', period: Period) {
  const items = kind === 'ar' ? demoReceivableItems() : demoPayableItems()
  const end = periodEnd(period)
  const result = aging(kind === 'ar' ? 'ar-aging' : 'ap-aging', items, end)
  const open = items.map((item) => ({ item, cents: openBalanceCents(item, end) })).filter((entry) => entry.cents > 0)
  const overdue = open.filter((entry) => entry.item.dueDate < end)
  const ledger = balanceAt(accounts, entries, kind, end)
  const control = ledger === result.totalCents ? [] : [`The ${kind === 'ar' ? 'receivables' : 'payables'} aging does not agree with the ledger balance.`]
  return openItemFacts(result.table, { totalCents: result.totalCents, itemCount: open.length, overdueCount: overdue.length, overdueCents: overdue.reduce((total, entry) => total + entry.cents, 0) }, control)
}

export function demoUnusual(period: Period) {
  const end = periodEnd(period), start = periodStart(period)
  const lines = accounts.map((account) => {
    const balanceSheetAccount = account.klass === 'asset' || account.klass === 'liability' || account.klass === 'equity'
    let cents = 0
    for (const item of entries) {
      if (item.date > end || (!balanceSheetAccount && item.date < start)) continue
      for (const line of item.lines) if (line.accountId === account.id) cents += line.debitCents - line.creditCents
    }
    return { name: account.name, klass: account.klass, debitMinusCreditCents: cents }
  })
  return unusualBalances(lines)
}

export function demoStatementFacts(period: Period) {
  const range = { start: periodStart(period), end: periodEnd(period), label: '' }
  const profit = demoReport('profit-loss', range), sheet = demoReport('balance-sheet', range)
  return statementFacts(profit, sheet, figureFrom(profit, /^net income$/), figureFrom(sheet, /^total assets$/))
}

/** Inputs for the demo client's month. `liveTransactions` replaces the scenario figures for the month that uses live demo transactions. */
export function demoMonthEndInputs(period: Period, options: { records: ReconRecordLike[]; signoffs: MonthEndRecord['signoffs']; closing?: MonthEndRecord['closing']; liveTransactions?: TransactionFacts | null }): MonthEndInputs {
  const key = periodKey(period)
  if (!hasDemoBooks(period)) {
    const missing = <T,>() => unknown<T>(DEMO_NO_BOOKS)
    return { period: key, transactions: missing(), bankAccounts: missing(), cardAccounts: missing(), receivables: missing(), payables: missing(), unusual: missing(), statements: missing(), signoffs: options.signoffs, closing: options.closing }
  }
  const accountsFor = (kind: 'bank' | 'credit_card') => reconFactsFor(DEMO_RECONCILIATION_ACCOUNTS.filter((account) => account.kind === kind), options.records, key)
  const open = (kind: 'ar' | 'ap'): Availability<OpenItemFacts> => {
    const result = demoOpenItems(kind, period)
    return result.facts ? known(result.facts) : unknown(result.reason ?? 'Not available.')
  }
  return {
    period: key,
    transactions: known(options.liveTransactions ?? demoTransactionFacts(period)),
    bankAccounts: known(accountsFor('bank')),
    cardAccounts: known(accountsFor('credit_card')),
    receivables: open('ar'),
    payables: open('ap'),
    unusual: known(demoUnusual(period)),
    statements: known(demoStatementFacts(period)),
    signoffs: options.signoffs,
    closing: options.closing,
  }
}

/** Dashboard-ready figures for the demo client, calculated from the ledger for the given month. */
export function demoClientFigures(period: Period) {
  const summary = profitAndLossSummary(accounts, entries, periodStart(period), periodEnd(period))
  const end = periodEnd(period)
  return {
    incomeCents: summary.incomeCents,
    expensesCents: summary.cogsCents + summary.expenseCents + summary.otherExpenseCents - summary.otherIncomeCents,
    profitCents: summary.netIncomeCents,
    bankBalanceCents: balanceAt(accounts, entries, 'checking', end),
    receivableCents: balanceAt(accounts, entries, 'ar', end),
    payableCents: balanceAt(accounts, entries, 'ap', end),
    ...balanceSheetSummary(accounts, entries, end),
  }
}

// --- Scenario seed records -----------------------------------------------------------------------------------

const SEED_COMPLETED: Record<string, string> = { '2026-05': '2026-06-03T15:00:00.000Z', '2026-06': '2026-07-02T15:00:00.000Z', '2026-07': '2026-08-03T15:00:00.000Z' }
export const SEED_USER = 'Demo scenario'

function seedReconciliation(accountId: string, ledgerId: 'checking' | 'card', name: string, kind: 'bank' | 'credit_card', period: Period, first: boolean): ReconciliationRecord {
  const key = periodKey(period)
  const end = periodEnd(period)
  const completedAt = SEED_COMPLETED[key]
  const natural = (asOf: string) => balanceAt(accounts, entries, ledgerId, asOf)
  const transactions: ReconTxn[] = demoRegister(ledgerId, period)
  const base = {
    accountKind: kind, periodStart: periodStart(period), periodEnd: end, statementDate: end, beginningCents: natural(periodEnd(previousPeriod(period))), endingCents: natural(end),
    openingConfirmed: first, statementMode: 'manual' as const, statementLines: [], transactions, clearedIds: transactions.map((item) => item.id), matches: [], completeness: { complete: true, reasons: [] },
  }
  const result = summarizeResult(computeReconciliation(base, { today: completedAt.slice(0, 10) }))
  return {
    id: reconciliationId('demo', DEMO_CLIENT_ID, accountId, end), source: 'demo', clientId: DEMO_CLIENT_ID, clientName: DEMO_CLIENT_NAME, accountId, accountName: name, ...base,
    status: 'completed', version: 2, createdAt: completedAt, updatedAt: completedAt, completedAt, completedBy: SEED_USER, result,
    history: [{ at: completedAt, by: SEED_USER, action: 'completed', differenceCents: result.differenceCents }],
  }
}

/** Completed reconciliations for May to July 2026, chained from the opening balances. August is left for the user to reconcile. */
export function buildDemoReconciliations(): ReconciliationRecord[] {
  const records: ReconciliationRecord[] = []
  DEMO_PERIODS.filter((period) => SEED_COMPLETED[periodKey(period)]).forEach((period, index) => {
    for (const account of DEMO_RECONCILIATION_ACCOUNTS) records.push(seedReconciliation(account.id, account.ledgerId as 'checking' | 'card', account.name, account.kind, period, index === 0))
  })
  return records
}

/** May was closed and later reopened; June and July have no month-end record yet. */
export function buildDemoMonthEndRecords(): MonthEndRecord[] {
  const period = asPeriod('2026-05')
  const reconciliations = buildDemoReconciliations()
  const inputs = demoMonthEndInputs(period, { records: reconciliations, signoffs: {} })
  const signoffs: MonthEndRecord['signoffs'] = {}
  const closedAt = '2026-06-04T14:00:00.000Z', reopenedAt = '2026-06-20T16:30:00.000Z'
  for (const item of buildChecklist(inputs).items) {
    if (item.signoff && item.signoff.allowed && SIGNOFF_STEPS.includes(item.id as never)) signoffs[item.id as keyof typeof signoffs] = { by: SEED_USER, at: closedAt, note: '', fingerprint: item.signoff.fingerprint, figures: item.signoff.figures } satisfies Signoff
  }
  return [{
    id: monthEndId('demo', DEMO_CLIENT_ID, '2026-05'), source: 'demo', clientId: DEMO_CLIENT_ID, clientName: DEMO_CLIENT_NAME, period: '2026-05', status: 'open', version: 3, createdAt: closedAt, updatedAt: reopenedAt,
    signoffs,
    history: [
      { at: closedAt, by: SEED_USER, action: 'closed' },
      { at: reopenedAt, by: SEED_USER, action: 'reopened', reason: 'The client sent a corrected May bank statement; re-checking the May figures.' },
    ],
  }]
}
