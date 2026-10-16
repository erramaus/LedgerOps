// Builds month-end checklist inputs from raw records. Used identically for Demo Data and QuickBooks so the same rules apply.
import type { AccountClass, ReportTable } from './accounting.js'
import { periodEnd, parsePeriodKey } from './period.js'
import { formatCents } from './reconciliation.js'
import type { AccountRecon, OpenItemFacts, StatementFacts, UnusualFacts } from './monthEnd.js'

export type ReconRecordLike = {
  id: string
  accountId: string
  status: 'draft' | 'completed'
  periodEnd: string
  version: number
  completedAt?: string
  completedBy?: string
  result?: { differenceCents: number }
  history: { action: string; at: string; reason?: string }[]
}

/** One entry per active bank or card account, with the reconciliation that ends on the last day of the month (if any). */
export function reconFactsFor(accounts: { id: string; name: string; kind: 'bank' | 'credit_card' }[], records: ReconRecordLike[], period: string): AccountRecon[] {
  const parsed = parsePeriodKey(period)
  const end = parsed ? periodEnd(parsed) : ''
  return accounts.map((account) => {
    const record = records.find((candidate) => candidate.accountId === account.id && candidate.periodEnd === end)
    if (!record) return { accountId: account.id, name: account.name, kind: account.kind }
    const reopened = [...record.history].reverse().find((event) => event.action === 'reopened')
    return {
      accountId: account.id, name: account.name, kind: account.kind,
      record: {
        id: record.id, status: record.status, periodEnd: record.periodEnd, version: record.version, completedAt: record.completedAt, completedBy: record.completedBy,
        differenceCents: record.result?.differenceCents, ...(reopened ? { reopenedAt: reopened.at, reopenReason: reopened.reason } : {}),
      },
    }
  })
}

export type BalanceLine = { name: string; klass: AccountClass; debitMinusCreditCents: number }

/** Plain sign and naming rules that point at balances worth a second look. They flag; they never decide. */
export function unusualBalances(lines: BalanceLine[]): UnusualFacts {
  const findings: string[] = []
  for (const line of lines) {
    const cents = line.debitMinusCreditCents
    if (cents === 0) continue
    const amount = formatCents(Math.abs(cents))
    const side = cents > 0 ? 'debit' : 'credit'
    if (line.klass === 'asset' && cents < 0) findings.push(`${line.name}: ${amount} on the credit side. An asset should normally have a debit balance.`)
    else if (line.klass === 'liability' && cents > 0) findings.push(`${line.name}: ${amount} on the debit side. A liability should normally have a credit balance.`)
    else if ((line.klass === 'income' || line.klass === 'other_income') && cents > 0) findings.push(`${line.name}: ${amount} on the debit side. Income should normally be a credit.`)
    else if ((line.klass === 'expense' || line.klass === 'cogs' || line.klass === 'other_expense') && cents < 0) findings.push(`${line.name}: ${amount} on the credit side. An expense should normally be a debit.`)
    if (/uncategorized|suspense|ask my accountant|opening balance/i.test(line.name)) findings.push(`${line.name}: ${amount} (${side}). Money parked here has not been classified.`)
    if (/undeposited funds/i.test(line.name)) findings.push(`${line.name}: ${amount}. Payments received that are not deposited yet; confirm they match deposits in transit.`)
  }
  return { accountsChecked: lines.length, findings }
}

/** Open invoices or bills as of the month end, with whether the report they came from verifies. */
export function openItemFacts(table: ReportTable, totals: { totalCents: number | null; itemCount: number; overdueCount: number; overdueCents: number }, extraProblems: string[] = []): { facts: OpenItemFacts | null; reason?: string } {
  const failed = table.checks.filter((check) => check.status === 'fail').map((check) => `${check.label}: ${check.detail}`)
  const unavailable = table.checks.filter((check) => check.status === 'unavailable').map((check) => `${check.label}: ${check.detail}`)
  if (totals.totalCents === null) return { facts: null, reason: 'The report total is not available.' }
  const problems = [...failed, ...unavailable, ...extraProblems]
  return { facts: { totalCents: totals.totalCents, itemCount: totals.itemCount, overdueCount: totals.overdueCount, overdueCents: totals.overdueCents, reportVerified: problems.length === 0, reportProblems: problems } }
}

/** What the sign-off for the financial statements is allowed to rest on. */
export function statementFacts(profitLoss: ReportTable, balanceSheet: ReportTable, netIncomeCents: number | null, totalAssetsCents: number | null): StatementFacts {
  const describe = (table: ReportTable, status: 'fail' | 'unavailable') => table.checks.filter((check) => check.status === status).map((check) => `${table.title}: ${check.label}. ${check.detail}`)
  return {
    netIncomeCents, totalAssetsCents,
    failed: [...describe(profitLoss, 'fail'), ...describe(balanceSheet, 'fail')],
    unavailable: [...describe(profitLoss, 'unavailable'), ...describe(balanceSheet, 'unavailable'), ...(netIncomeCents === null ? ['Net income could not be read from the Profit and Loss.'] : []), ...(totalAssetsCents === null ? ['Total assets could not be read from the Balance Sheet.'] : [])],
  }
}

/** The first row of a table whose label matches, read from one column. Returns null when absent or unreadable. */
export function figureFrom(table: ReportTable, pattern: RegExp, column = 0): number | null {
  const found = table.rows.find((row) => pattern.test(row.label.trim().replace(/\s+/g, ' ').toLowerCase()))
  const value = found?.cells[column]
  return value === undefined ? null : value
}
