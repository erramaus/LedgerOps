// Demo Data month-end inputs, reports and scenario seed records, all calculated from shared/demoBooks.ts.
// None of this is ever consulted in QuickBooks mode.
import {
  aging, balanceSheet, balanceSheetSummary, balanceAt, cashFlow, generalLedger, openBalanceCents, profitAndLoss, profitAndLossSummary, trialBalance, withComparison,
  type ReportId, type ReportTable,
} from './accounting.js'
import {
  DEMO_CLIENT_ID, DEMO_CLIENT_NAME, DEMO_PERIODS, DEMO_RECONCILIATION_ACCOUNTS, demoLedger, demoPayableItems, demoPeriodReviews, demoReceivableItems, demoRegister,
} from './demoBooks.js'
import type { DemoLedger } from './demoPayments.js'
export type { DemoLedger } from './demoPayments.js'
import { ADDITIONAL_DEMO_CLIENT_IDS, getAdditionalDemoCompany } from './demoCompanyBooks.js'
import { buildChecklist, known, monthEndId, SIGNOFF_STEPS, unknown, type Availability, type MonthEndInputs, type MonthEndRecord, type OpenItemFacts, type Signoff, type TransactionFacts } from './monthEnd.js'
import { openItemFacts, reconFactsFor, statementFacts, unusualBalances, figureFrom, type ReconRecordLike } from './monthEndFacts.js'
import { parsePeriodKey, periodEnd, periodKey, periodStart, previousPeriod, type DateRange, type Period } from './period.js'
import { computeReconciliation, formatCents, reconciliationId, summarizeResult, type ReconciliationRecord, type ReconTxn } from './reconciliation.js'

const { accounts, entries } = demoLedger

export const hasDemoBooks = (period: Period, clientId = DEMO_CLIENT_ID) => {
  const candidates = clientId === DEMO_CLIENT_ID ? DEMO_PERIODS : getAdditionalDemoCompany(clientId)?.periods ?? []
  return candidates.some((candidate) => candidate.year === period.year && candidate.month === period.month)
}
export const hasDemoLedgerBooks = (period: Period, ledger: DemoLedger = demoLedger) => hasDemoBooks(period, ledger.clientId ?? DEMO_CLIENT_ID)
export const DEMO_NO_BOOKS = 'The demo books only cover May to August 2026.'

export type ReportSet = Record<ReportId, ReportTable>

/** Every report for a date range, calculated from the ledger. A range outside the demo books is reported as unavailable by the caller. */
export function demoReport(id: ReportId, range: DateRange, ledger: DemoLedger = demoLedger): ReportTable {
  const { accounts, entries } = ledger
  const receivables = ledger.receivableItems ?? demoReceivableItems()
  const payables = ledger.payableItems ?? demoPayableItems()
  const table = (() => {
    switch (id) {
      case 'profit-loss': return profitAndLoss(accounts, entries, range.start, range.end)
      case 'balance-sheet': return balanceSheet(accounts, entries, range.end)
      case 'cash-flow': return cashFlow(accounts, entries, range.start, range.end)
      case 'trial-balance': return trialBalance(accounts, entries, range.end)
      case 'general-ledger': return generalLedger(accounts, entries, range.start, range.end)
      case 'ar-aging': return aging('ar-aging', receivables, range.end).table
      default: return aging('ap-aging', payables, range.end).table
    }
  })()
  const arTotal = id === 'ar-aging' ? aging('ar-aging', receivables, range.end).totalCents : undefined
  const apTotal = id === 'ap-aging' ? aging('ap-aging', payables, range.end).totalCents : undefined
  if (arTotal !== undefined || apTotal !== undefined) {
    // The aging must agree with the control account in the ledger: an independent source for the same number.
    const control = id === 'ar-aging' ? 'ar' : 'ap'
    const ledgerBalance = balanceAt(accounts, entries, control, range.end)
    const agrees = ledgerBalance === (arTotal ?? apTotal)
    table.checks.push({ id: 'aging-control', label: `Agrees with ${id === 'ar-aging' ? 'Accounts Receivable' : 'Accounts Payable'} in the ledger`, status: agrees ? 'pass' : 'fail', detail: agrees ? 'The aging and the ledger balance are the same.' : `The aging shows ${formatCents((arTotal ?? apTotal)!)} but the ledger shows ${formatCents(ledgerBalance)}.` })
  }
  return { ...table, meta: { start: range.start, end: range.end, basis: 'Accrual' } }
}

export function demoComparison(id: ReportId, current: DateRange, previous: DateRange, ledger: DemoLedger = demoLedger): ReportTable | null {
  if (id === 'general-ledger') return null
  const periods = ledger.periods ?? DEMO_PERIODS
  const previousInBooks = periods.some((period) => periodStart(period) <= previous.end && periodEnd(period) >= previous.start) && previous.start >= '2026-02-28'
  if (!previousInBooks) return null
  const now = demoReport(id, current, ledger), then = demoReport(id, previous, ledger)
  return { ...withComparison(now, then, { current: current.label, previous: previous.label }, true), meta: now.meta }
}

// --- Month-end inputs ----------------------------------------------------------------------------------------

const asPeriod = (key: string) => parsePeriodKey(key)!

export function demoTransactionFacts(period: Period, ledger: DemoLedger = demoLedger): TransactionFacts {
  const { entries } = ledger
  const key = periodKey(period)
  const review = ledger.reviewScenarios?.[key] ?? demoPeriodReviews[key]
  const start = periodStart(period), end = periodEnd(period)
  const inMonth = entries.filter((item) => item.id !== 'opening' && item.date >= start && item.date <= end && item.lines.some((line) => line.accountId === 'checking' || line.accountId === 'card'))
  return {
    total: inMonth.length,
    uncategorized: inMonth.filter((item) => item.lines.some((line) => line.accountId === 'uncategorized')).length,
    possibleDuplicates: review?.possibleDuplicates ?? 0, missingReceipts: review?.missingReceipts ?? 0, missingPayees: review?.missingPayees ?? 0, openClientRequests: review?.openClientRequests ?? 0,
  }
}

export function demoOpenItems(kind: 'ar' | 'ap', period: Period, ledgerSource: DemoLedger = demoLedger) {
  const { accounts, entries } = ledgerSource
  const items = kind === 'ar' ? ledgerSource.receivableItems ?? demoReceivableItems() : ledgerSource.payableItems ?? demoPayableItems()
  const end = periodEnd(period)
  const result = aging(kind === 'ar' ? 'ar-aging' : 'ap-aging', items, end)
  const open = items.map((item) => ({ item, cents: openBalanceCents(item, end) })).filter((entry) => entry.cents > 0)
  const overdue = open.filter((entry) => entry.item.dueDate < end)
  const ledger = balanceAt(accounts, entries, kind, end)
  const control = ledger === result.totalCents ? [] : [`The ${kind === 'ar' ? 'receivables' : 'payables'} aging does not agree with the ledger balance.`]
  return openItemFacts(result.table, { totalCents: result.totalCents, itemCount: open.length, overdueCount: overdue.length, overdueCents: overdue.reduce((total, entry) => total + entry.cents, 0) }, control)
}

export function demoUnusual(period: Period, ledger: DemoLedger = demoLedger) {
  const { accounts, entries } = ledger
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

export function demoStatementFacts(period: Period, ledger: DemoLedger = demoLedger) {
  const range = { start: periodStart(period), end: periodEnd(period), label: '' }
  const profit = demoReport('profit-loss', range, ledger), sheet = demoReport('balance-sheet', range, ledger)
  return statementFacts(profit, sheet, figureFrom(profit, /^net income$/), figureFrom(sheet, /^total assets$/))
}

/** Inputs for the demo client's month. `liveTransactions` replaces the scenario figures for the month that uses live demo transactions. */
export function demoMonthEndInputs(period: Period, options: { records: ReconRecordLike[]; signoffs: MonthEndRecord['signoffs']; closing?: MonthEndRecord['closing']; liveTransactions?: TransactionFacts | null; ledger?: DemoLedger; clientId?: string }): MonthEndInputs {
  const key = periodKey(period)
  const ledger: DemoLedger = options.ledger ?? demoLedger
  const clientId = options.clientId ?? ledger.clientId ?? DEMO_CLIENT_ID
  if (!hasDemoBooks(period, clientId)) {
    const unavailable = clientId === DEMO_CLIENT_ID ? DEMO_NO_BOOKS : `${getAdditionalDemoCompany(clientId)?.clientName ?? 'This demo company'} has no books for that period.`
    const missing = <T,>() => unknown<T>(unavailable)
    return { period: key, transactions: missing(), bankAccounts: missing(), cardAccounts: missing(), receivables: missing(), payables: missing(), unusual: missing(), statements: missing(), signoffs: options.signoffs, closing: options.closing }
  }
  const reconAccounts = ledger.reconAccounts ?? DEMO_RECONCILIATION_ACCOUNTS
  const accountsFor = (kind: 'bank' | 'credit_card') => reconFactsFor(reconAccounts.filter((account) => account.kind === kind), options.records, key)
  const open = (kind: 'ar' | 'ap'): Availability<OpenItemFacts> => {
    const result = demoOpenItems(kind, period, ledger)
    return result.facts ? known(result.facts) : unknown(result.reason ?? 'Not available.')
  }
  return {
    period: key,
    transactions: known(options.liveTransactions ?? demoTransactionFacts(period, ledger)),
    bankAccounts: known(accountsFor('bank')),
    cardAccounts: known(accountsFor('credit_card')),
    receivables: open('ar'),
    payables: open('ap'),
    unusual: known(demoUnusual(period, ledger)),
    statements: known(demoStatementFacts(period, ledger)),
    signoffs: options.signoffs,
    closing: options.closing,
  }
}

/** Dashboard-ready figures for the demo client, calculated from the ledger for the given month. */
export function demoClientFigures(period: Period, ledger: DemoLedger = demoLedger) {
  const { accounts, entries } = ledger
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

/** Reconciliations for generated companies, separate from ABC's pinned scenario fixtures. */
export function buildAdditionalDemoReconciliations(): ReconciliationRecord[] {
  const records: ReconciliationRecord[] = []
  for (const clientId of ADDITIONAL_DEMO_CLIENT_IDS) {
    const company = getAdditionalDemoCompany(clientId)!
    for (const period of company.periods) {
      if (period.year === 2026 && period.month === 8) continue
      const end = periodEnd(period)
      const at = `${end}T15:00:00.000Z`
      for (const account of company.reconciliationAccounts) {
        const statement = company.statements.find((item) => item.accountId === account.id && item.period.year === period.year && item.period.month === period.month)!
        const matches = statement.transactions.flatMap((transaction) => {
          const line = statement.statementLines.find((candidate) => candidate.date === transaction.date && candidate.amountCents === transaction.amountCents && candidate.direction === transaction.direction)
          return line ? [{ lineId: line.id, txnId: transaction.id }] : []
        })
        const clearedIds = matches.map((match) => match.txnId)
        const base = {
          clientId: company.clientId, clientName: company.clientName, accountId: account.id, accountName: account.name, accountKind: account.kind,
          periodStart: statement.periodStart, periodEnd: statement.periodEnd, statementDate: statement.statementDate,
          beginningCents: statement.beginningCents, endingCents: statement.endingCents, openingConfirmed: true,
          statementMode: 'csv' as const, statementLines: statement.statementLines, transactions: statement.transactions,
          clearedIds, matches, completeness: { complete: true, reasons: [] },
        }
        const previous = records.filter((record) => record.clientId === company.clientId && record.accountId === account.id && record.status === 'completed').sort((left, right) => left.periodEnd.localeCompare(right.periodEnd)).slice(-1)[0]
        const sourceTransactions: ReconTxn[] = company.ledger.entries.filter((entry) => entry.date <= end).flatMap((entry) => {
          const line = entry.lines.find((candidate) => candidate.accountId === account.ledgerId)
          if (!line) return []
          const direction = account.ledgerId === 'checking' ? line.debitCents > 0 ? 'increase' as const : 'decrease' as const : line.creditCents > 0 ? 'increase' as const : 'decrease' as const
          return [{ id: entry.id, date: entry.date, payee: entry.memo, memo: '', amountCents: line.debitCents || line.creditCents, direction }]
        })
        const computation = computeReconciliation(base, { previous: previous ? { periodEnd: previous.periodEnd, endingCents: previous.endingCents, clearedTransactions: previous.transactions.filter((transaction) => previous.clearedIds.includes(transaction.id)) } : undefined, sourceTransactions, today: end })
        if (computation.differenceCents !== 0 || computation.issues.some((issue) => issue.severity === 'blocking')) continue
        const result = summarizeResult(computation)
        records.push({
          ...base, id: reconciliationId('demo', company.clientId, account.id, end), source: 'demo', status: 'completed', version: 2,
          createdAt: at, updatedAt: at, completedAt: at, completedBy: SEED_USER, result,
          history: [{ at, by: SEED_USER, action: 'completed', differenceCents: result.differenceCents }],
        })
      }
    }
  }
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

/** Open month-end records for the four generated companies; ABC's original May scenario is untouched. */
export function buildAdditionalDemoMonthEndRecords(): MonthEndRecord[] {
  return ADDITIONAL_DEMO_CLIENT_IDS.flatMap((clientId) => {
    const company = getAdditionalDemoCompany(clientId)!
    return company.periods.map((period) => {
      const key = periodKey(period)
      const at = `${periodEnd(period)}T18:00:00.000Z`
      return { id: monthEndId('demo', clientId, key), source: 'demo' as const, clientId, clientName: company.clientName, period: key, status: 'open' as const, version: 1, createdAt: at, updatedAt: at, signoffs: {}, history: [] }
    })
  })
}
