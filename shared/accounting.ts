// Double-entry reporting engine for ledger-based data (the demo books). Every amount is an integer number
// of cents; nothing is ever estimated, and a total that cannot be proven is reported as a failed check.
import { daysBetween, isValidIsoDate } from './period.js'

export type AccountClass = 'asset' | 'liability' | 'equity' | 'income' | 'cogs' | 'expense' | 'other_income' | 'other_expense'
export type CashFlowClass = 'cash' | 'operating' | 'investing' | 'financing'
export type AccountKind = 'bank' | 'credit_card' | 'ar' | 'ap' | 'other'

export type LedgerAccountDef = { id: string; name: string; klass: AccountClass; kind?: AccountKind; cashFlow?: CashFlowClass }
export type JournalLine = { accountId: string; debitCents: number; creditCents: number }
export type JournalEntry = { id: string; date: string; memo: string; lines: JournalLine[] }

export type ReportId = 'profit-loss' | 'balance-sheet' | 'cash-flow' | 'trial-balance' | 'general-ledger' | 'ar-aging' | 'ap-aging'
export type ReportColumn = { key: string; label: string }
export type RowStyle = 'normal' | 'heading' | 'total' | 'grand'
export type ReportRow = { key: string; label: string; cells: (number | null)[]; level: number; style: RowStyle }
export type CheckStatus = 'pass' | 'fail' | 'unavailable'
export type ReportCheck = { id: string; label: string; status: CheckStatus; detail: string }
export type ReportMeta = { basis?: string; currency?: string; start?: string; end?: string; generatedAt?: string }
export type ReportTable = { id: ReportId; title: string; columns: ReportColumn[]; rows: ReportRow[]; checks: ReportCheck[]; meta?: ReportMeta }

const DEBIT_NORMAL: AccountClass[] = ['asset', 'cogs', 'expense', 'other_expense']
export const isDebitNormal = (klass: AccountClass) => DEBIT_NORMAL.includes(klass)
const isProfitAndLoss = (klass: AccountClass) => ['income', 'cogs', 'expense', 'other_income', 'other_expense'].includes(klass)

const byId = (accounts: LedgerAccountDef[]) => new Map(accounts.map((account) => [account.id, account]))
const row = (key: string, label: string, cells: (number | null)[], level = 1, style: RowStyle = 'normal'): ReportRow => ({ key, label, cells, level, style })
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const money = (cents: number) => `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Debit minus credit for one account over a date range (inclusive; either bound may be omitted). */
function net(entries: JournalEntry[], accountId: string, from: string | null, to: string | null) {
  let total = 0
  for (const entry of entries) {
    if ((from && entry.date < from) || (to && entry.date > to)) continue
    for (const line of entry.lines) if (line.accountId === accountId) total += line.debitCents - line.creditCents
  }
  return total
}

/** Natural-sign balance: positive means the normal side (debit for assets and expenses, credit for the rest). */
const natural = (account: LedgerAccountDef, debitMinusCredit: number) => (isDebitNormal(account.klass) ? debitMinusCredit : -debitMinusCredit)

export type LedgerIssue = { entryId?: string; message: string }

/** Structural validation: valid dates, known accounts, whole cents, one-sided lines and balanced entries. */
export function validateLedger(accounts: LedgerAccountDef[], entries: JournalEntry[]): LedgerIssue[] {
  const known = byId(accounts)
  const issues: LedgerIssue[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.id)) issues.push({ entryId: entry.id, message: 'Duplicate journal entry id.' })
    seen.add(entry.id)
    if (!isValidIsoDate(entry.date)) issues.push({ entryId: entry.id, message: `Invalid date "${entry.date}".` })
    if (entry.lines.length < 2) issues.push({ entryId: entry.id, message: 'An entry needs at least two lines.' })
    let debits = 0, credits = 0
    for (const line of entry.lines) {
      if (!known.has(line.accountId)) issues.push({ entryId: entry.id, message: `Unknown account "${line.accountId}".` })
      if (!Number.isSafeInteger(line.debitCents) || !Number.isSafeInteger(line.creditCents) || line.debitCents < 0 || line.creditCents < 0) issues.push({ entryId: entry.id, message: 'Amounts must be whole cents and not negative.' })
      if (line.debitCents > 0 && line.creditCents > 0) issues.push({ entryId: entry.id, message: 'A line cannot be both a debit and a credit.' })
      debits += line.debitCents
      credits += line.creditCents
    }
    if (debits !== credits) issues.push({ entryId: entry.id, message: `Entry is out of balance by ${money(Math.abs(debits - credits))}.` })
  }
  return issues
}

const ledgerCheck = (accounts: LedgerAccountDef[], entries: JournalEntry[]): ReportCheck => {
  const issues = validateLedger(accounts, entries)
  return issues.length === 0
    ? { id: 'ledger-valid', label: 'Every journal entry is balanced', status: 'pass', detail: `${entries.length} entries checked.` }
    : { id: 'ledger-valid', label: 'Every journal entry is balanced', status: 'fail', detail: issues.slice(0, 3).map((issue) => issue.message).join(' ') }
}

export function balanceAt(accounts: LedgerAccountDef[], entries: JournalEntry[], accountId: string, asOf: string) {
  const account = byId(accounts).get(accountId)
  return account ? natural(account, net(entries, accountId, null, asOf)) : 0
}

// --- Trial balance -------------------------------------------------------------------------------------------

export function trialBalance(accounts: LedgerAccountDef[], entries: JournalEntry[], asOf: string): ReportTable {
  const rows: ReportRow[] = []
  let debits = 0, credits = 0
  for (const account of accounts) {
    const balance = net(entries, account.id, null, asOf)
    if (balance === 0) continue
    const debit = balance > 0 ? balance : 0
    const credit = balance < 0 ? -balance : 0
    debits += debit
    credits += credit
    rows.push(row(account.id, account.name, [debit, credit]))
  }
  rows.push(row('total', 'Total', [debits, credits], 0, 'grand'))
  const balanced = debits === credits
  return {
    id: 'trial-balance', title: 'Trial Balance', columns: [{ key: 'debit', label: 'Debit' }, { key: 'credit', label: 'Credit' }], rows,
    checks: [
      ledgerCheck(accounts, entries),
      { id: 'tb-balanced', label: 'Total debits equal total credits', status: balanced ? 'pass' : 'fail', detail: balanced ? `Both total ${money(debits)}.` : `Debits ${money(debits)} and credits ${money(credits)} differ by ${money(Math.abs(debits - credits))}.` },
    ],
  }
}

// --- Profit and loss -----------------------------------------------------------------------------------------

export type ProfitAndLossSummary = { incomeCents: number; cogsCents: number; grossProfitCents: number; expenseCents: number; otherIncomeCents: number; otherExpenseCents: number; netIncomeCents: number }

export function profitAndLossSummary(accounts: LedgerAccountDef[], entries: JournalEntry[], start: string, end: string): ProfitAndLossSummary {
  const total = (klass: AccountClass) => sum(accounts.filter((account) => account.klass === klass).map((account) => natural(account, net(entries, account.id, start, end))))
  const incomeCents = total('income'), cogsCents = total('cogs'), expenseCents = total('expense'), otherIncomeCents = total('other_income'), otherExpenseCents = total('other_expense')
  const grossProfitCents = incomeCents - cogsCents
  return { incomeCents, cogsCents, grossProfitCents, expenseCents, otherIncomeCents, otherExpenseCents, netIncomeCents: grossProfitCents - expenseCents + otherIncomeCents - otherExpenseCents }
}

export function profitAndLoss(accounts: LedgerAccountDef[], entries: JournalEntry[], start: string, end: string): ReportTable {
  const summary = profitAndLossSummary(accounts, entries, start, end)
  const section = (title: string, klass: AccountClass, totalLabel: string, totalKey: string, totalCents: number): ReportRow[] => {
    const lines = accounts.filter((account) => account.klass === klass).map((account) => ({ account, cents: natural(account, net(entries, account.id, start, end)) })).filter((item) => item.cents !== 0)
    if (lines.length === 0 && totalCents === 0) return []
    return [row(`h-${klass}`, title, [null], 0, 'heading'), ...lines.map((item) => row(item.account.id, item.account.name, [item.cents])), row(totalKey, totalLabel, [totalCents], 0, 'total')]
  }
  const rows = [
    ...section('Income', 'income', 'Total income', 'total-income', summary.incomeCents),
    ...section('Cost of goods sold', 'cogs', 'Total cost of goods sold', 'total-cogs', summary.cogsCents),
    row('gross-profit', 'Gross profit', [summary.grossProfitCents], 0, 'total'),
    ...section('Expenses', 'expense', 'Total expenses', 'total-expenses', summary.expenseCents),
    ...section('Other income', 'other_income', 'Total other income', 'total-other-income', summary.otherIncomeCents),
    ...section('Other expenses', 'other_expense', 'Total other expenses', 'total-other-expenses', summary.otherExpenseCents),
    row('net-income', 'Net income', [summary.netIncomeCents], 0, 'grand'),
  ]
  // Independent proof: net income must equal the net credit balance of every income and expense account.
  const fromTrial = sum(accounts.filter((account) => isProfitAndLoss(account.klass)).map((account) => -net(entries, account.id, start, end)))
  const agrees = fromTrial === summary.netIncomeCents
  return {
    id: 'profit-loss', title: 'Profit and Loss', columns: [{ key: 'amount', label: 'Amount' }], rows,
    checks: [
      ledgerCheck(accounts, entries),
      { id: 'pl-agrees', label: 'Net income agrees with the account activity', status: agrees ? 'pass' : 'fail', detail: agrees ? `Net income ${money(summary.netIncomeCents)}.` : `Statement ${money(summary.netIncomeCents)} but the accounts net to ${money(fromTrial)}.` },
    ],
  }
}

// --- Balance sheet -------------------------------------------------------------------------------------------

const fiscalYearStart = (asOf: string) => `${asOf.slice(0, 4)}-01-01`
const dayBefore = (iso: string) => {
  const date = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) - 1))
  return date.toISOString().slice(0, 10)
}

export type BalanceSheetSummary = { assetsCents: number; liabilitiesCents: number; equityCents: number; retainedEarningsCents: number; currentEarningsCents: number }

export function balanceSheetSummary(accounts: LedgerAccountDef[], entries: JournalEntry[], asOf: string): BalanceSheetSummary {
  const total = (klass: AccountClass) => sum(accounts.filter((account) => account.klass === klass).map((account) => natural(account, net(entries, account.id, null, asOf))))
  const yearStart = fiscalYearStart(asOf)
  const retainedEarningsCents = sum(accounts.filter((account) => isProfitAndLoss(account.klass)).map((account) => -net(entries, account.id, null, dayBefore(yearStart))))
  const currentEarningsCents = sum(accounts.filter((account) => isProfitAndLoss(account.klass)).map((account) => -net(entries, account.id, yearStart, asOf)))
  const equityAccounts = total('equity')
  return { assetsCents: total('asset'), liabilitiesCents: total('liability'), equityCents: equityAccounts + retainedEarningsCents + currentEarningsCents, retainedEarningsCents, currentEarningsCents }
}

export function balanceSheet(accounts: LedgerAccountDef[], entries: JournalEntry[], asOf: string): ReportTable {
  const summary = balanceSheetSummary(accounts, entries, asOf)
  const section = (title: string, klass: AccountClass, totalLabel: string, totalKey: string, totalCents: number, extra: ReportRow[] = []): ReportRow[] => [
    row(`h-${klass}`, title, [null], 0, 'heading'),
    ...accounts.filter((account) => account.klass === klass).map((account) => ({ account, cents: natural(account, net(entries, account.id, null, asOf)) })).filter((item) => item.cents !== 0).map((item) => row(item.account.id, item.account.name, [item.cents])),
    ...extra,
    row(totalKey, totalLabel, [totalCents], 0, 'total'),
  ]
  const equityExtra = [row('retained-earnings', 'Retained earnings (prior years)', [summary.retainedEarningsCents]), row('current-earnings', 'Net income (this year to date)', [summary.currentEarningsCents])]
  const liabilitiesAndEquity = summary.liabilitiesCents + summary.equityCents
  const rows = [
    ...section('Assets', 'asset', 'Total assets', 'total-assets', summary.assetsCents),
    ...section('Liabilities', 'liability', 'Total liabilities', 'total-liabilities', summary.liabilitiesCents),
    ...section('Equity', 'equity', 'Total equity', 'total-equity', summary.equityCents, equityExtra),
    row('total-liabilities-equity', 'Total liabilities and equity', [liabilitiesAndEquity], 0, 'grand'),
  ]
  const balanced = summary.assetsCents === liabilitiesAndEquity
  return {
    id: 'balance-sheet', title: 'Balance Sheet', columns: [{ key: 'amount', label: 'Balance' }], rows,
    checks: [
      ledgerCheck(accounts, entries),
      { id: 'bs-balanced', label: 'Assets equal liabilities plus equity', status: balanced ? 'pass' : 'fail', detail: balanced ? `Both total ${money(summary.assetsCents)}.` : `Assets ${money(summary.assetsCents)} but liabilities and equity ${money(liabilitiesAndEquity)}.` },
    ],
  }
}

// --- Cash flow (indirect method) -----------------------------------------------------------------------------

export function cashFlow(accounts: LedgerAccountDef[], entries: JournalEntry[], start: string, end: string): ReportTable {
  const summary = profitAndLossSummary(accounts, entries, start, end)
  const before = dayBefore(start)
  const classified = accounts.filter((account) => (account.klass === 'asset' || account.klass === 'liability' || account.klass === 'equity') && account.cashFlow && account.cashFlow !== 'cash')
  const unclassified = accounts.filter((account) => (account.klass === 'asset' || account.klass === 'liability' || account.klass === 'equity') && !account.cashFlow && net(entries, account.id, null, end) !== net(entries, account.id, null, before))
  // More of an asset ties up cash; more of a liability or equity brings cash in.
  const change = (account: LedgerAccountDef) => {
    const delta = natural(account, net(entries, account.id, start, end))
    return account.klass === 'asset' ? -delta : delta
  }
  const group = (flow: CashFlowClass) => classified.filter((account) => account.cashFlow === flow).map((account) => ({ account, cents: change(account) })).filter((item) => item.cents !== 0)
  const operating = group('operating'), investing = group('investing'), financing = group('financing')
  const operatingTotal = summary.netIncomeCents + sum(operating.map((item) => item.cents))
  const investingTotal = sum(investing.map((item) => item.cents))
  const financingTotal = sum(financing.map((item) => item.cents))
  const computedChange = operatingTotal + investingTotal + financingTotal

  const cashAccounts = accounts.filter((account) => account.cashFlow === 'cash')
  const beginning = sum(cashAccounts.map((account) => natural(account, net(entries, account.id, null, before))))
  const ending = sum(cashAccounts.map((account) => natural(account, net(entries, account.id, null, end))))
  const actualChange = ending - beginning

  const rows = [
    row('h-operating', 'Operating activities', [null], 0, 'heading'),
    row('net-income', 'Net income', [summary.netIncomeCents]),
    ...operating.map((item) => row(item.account.id, `Change in ${item.account.name}`, [item.cents])),
    row('total-operating', 'Net cash from operating activities', [operatingTotal], 0, 'total'),
    row('h-investing', 'Investing activities', [null], 0, 'heading'),
    ...investing.map((item) => row(item.account.id, `Change in ${item.account.name}`, [item.cents])),
    row('total-investing', 'Net cash from investing activities', [investingTotal], 0, 'total'),
    row('h-financing', 'Financing activities', [null], 0, 'heading'),
    ...financing.map((item) => row(item.account.id, `Change in ${item.account.name}`, [item.cents])),
    row('total-financing', 'Net cash from financing activities', [financingTotal], 0, 'total'),
    row('net-change', 'Net change in cash', [computedChange], 0, 'total'),
    row('beginning-cash', 'Cash at beginning of period', [beginning]),
    row('ending-cash', 'Cash at end of period', [beginning + computedChange], 0, 'grand'),
  ]
  const agrees = computedChange === actualChange
  return {
    id: 'cash-flow', title: 'Cash Flow', columns: [{ key: 'amount', label: 'Amount' }], rows,
    checks: [
      ledgerCheck(accounts, entries),
      { id: 'cf-classified', label: 'Every balance sheet account is classified', status: unclassified.length === 0 ? 'pass' : 'fail', detail: unclassified.length === 0 ? 'All accounts that moved are classified.' : `Not classified: ${unclassified.map((account) => account.name).join(', ')}.` },
      { id: 'cf-agrees', label: 'Net change agrees with the cash accounts', status: agrees ? 'pass' : 'fail', detail: agrees ? `Cash moved by ${money(actualChange)}.` : `The statement shows ${money(computedChange)} but the cash accounts moved by ${money(actualChange)}.` },
    ],
  }
}

// --- General ledger ------------------------------------------------------------------------------------------

export function generalLedger(accounts: LedgerAccountDef[], entries: JournalEntry[], start: string, end: string): ReportTable {
  const rows: ReportRow[] = []
  const before = dayBefore(start)
  let overallDebits = 0, overallCredits = 0
  for (const account of accounts) {
    const opening = natural(account, net(entries, account.id, null, before))
    const activity = entries
      .filter((entry) => entry.date >= start && entry.date <= end && entry.lines.some((line) => line.accountId === account.id))
      .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id))
    if (opening === 0 && activity.length === 0) continue
    rows.push(row(`h-${account.id}`, account.name, [null, null, opening], 0, 'heading'))
    let running = opening
    for (const entry of activity) {
      const debit = sum(entry.lines.filter((line) => line.accountId === account.id).map((line) => line.debitCents))
      const credit = sum(entry.lines.filter((line) => line.accountId === account.id).map((line) => line.creditCents))
      running += natural(account, debit - credit)
      overallDebits += debit
      overallCredits += credit
      rows.push(row(`${account.id}/${entry.id}`, `${entry.date}  ${entry.memo}`, [debit || null, credit || null, running]))
    }
    rows.push(row(`t-${account.id}`, `Closing balance, ${account.name}`, [null, null, running], 0, 'total'))
  }
  const balanced = overallDebits === overallCredits
  return {
    id: 'general-ledger', title: 'General Ledger', columns: [{ key: 'debit', label: 'Debit' }, { key: 'credit', label: 'Credit' }, { key: 'balance', label: 'Balance' }], rows,
    checks: [
      ledgerCheck(accounts, entries),
      { id: 'gl-balanced', label: 'Total debits equal total credits in the period', status: balanced ? 'pass' : 'fail', detail: balanced ? `Both total ${money(overallDebits)}.` : `Debits ${money(overallDebits)} and credits ${money(overallCredits)} differ.` },
    ],
  }
}

// --- Aging ---------------------------------------------------------------------------------------------------

export type OpenItem = { id: string; party: string; number: string; date: string; dueDate: string; amountCents: number; payments: { date: string; amountCents: number }[] }
export const AGING_BUCKETS = [
  { key: 'current', label: 'Current' },
  { key: 'd1', label: '1-30' },
  { key: 'd31', label: '31-60' },
  { key: 'd61', label: '61-90' },
  { key: 'd91', label: '91+' },
] as const

export const openBalanceCents = (item: OpenItem, asOf: string) => (item.date > asOf ? 0 : item.amountCents - sum(item.payments.filter((payment) => payment.date <= asOf).map((payment) => payment.amountCents)))
const bucketOf = (daysPastDue: number) => (daysPastDue <= 0 ? 0 : daysPastDue <= 30 ? 1 : daysPastDue <= 60 ? 2 : daysPastDue <= 90 ? 3 : 4)

export function aging(id: 'ar-aging' | 'ap-aging', items: OpenItem[], asOf: string): { table: ReportTable; totalCents: number } {
  const byParty = new Map<string, number[]>()
  let overpaid = 0
  for (const item of items) {
    const open = openBalanceCents(item, asOf)
    if (open < 0) overpaid += 1
    if (open <= 0) continue
    const cells = byParty.get(item.party) ?? [0, 0, 0, 0, 0]
    cells[bucketOf(daysBetween(item.dueDate, asOf))] += open
    byParty.set(item.party, cells)
  }
  const parties = [...byParty.entries()].sort(([left], [right]) => left.localeCompare(right))
  const rows = parties.map(([party, cells]) => row(party, party, [...cells, sum(cells)]))
  const totals = [0, 1, 2, 3, 4].map((index) => sum(parties.map(([, cells]) => cells[index])))
  const totalCents = sum(totals)
  rows.push(row('total', 'Total', [...totals, totalCents], 0, 'grand'))
  const rowsAgree = sum(rows.slice(0, -1).map((item) => item.cells[5] ?? 0)) === totalCents
  return {
    totalCents,
    table: {
      id, title: id === 'ar-aging' ? 'Accounts Receivable Aging' : 'Accounts Payable Aging',
      columns: [...AGING_BUCKETS.map((bucket) => ({ key: bucket.key, label: bucket.label })), { key: 'total', label: 'Total' }], rows,
      checks: [
        { id: 'aging-sums', label: 'Rows add up to the total', status: rowsAgree ? 'pass' : 'fail', detail: rowsAgree ? `Total ${money(totalCents)}.` : 'The rows do not add up to the total.' },
        { id: 'aging-overpaid', label: 'No document is paid more than its amount', status: overpaid === 0 ? 'pass' : 'fail', detail: overpaid === 0 ? 'All balances are zero or positive.' : `${overpaid} document${overpaid === 1 ? ' is' : 's are'} overpaid.` },
      ],
    },
  }
}

// --- Comparing two periods -----------------------------------------------------------------------------------

/** Adds a previous-period column and a change column. A row missing from either period is treated as zero only when `missingIsZero`. */
export function withComparison(current: ReportTable, previous: ReportTable, labels: { current: string; previous: string }, missingIsZero: boolean): ReportTable {
  const previousByKey = new Map(previous.rows.map((item) => [item.key, item]))
  const currentKeys = new Set(current.rows.map((item) => item.key))
  const merged: ReportRow[] = current.rows.map((item) => {
    const other = previousByKey.get(item.key)
    const now = item.cells[0] ?? null
    const then = other ? (other.cells[0] ?? null) : missingIsZero && now !== null ? 0 : null
    return { ...item, cells: [now, then, now !== null && then !== null ? now - then : null] }
  })
  // Rows that only existed last period still belong in a comparison; they are inserted before the first total row to stay readable.
  const onlyPrevious = previous.rows.filter((item) => !currentKeys.has(item.key) && item.style === 'normal' && (item.cells[0] ?? 0) !== 0)
  for (const item of onlyPrevious) {
    const now = missingIsZero ? 0 : null
    const then = item.cells[0] ?? null
    const insertAt = merged.findIndex((candidate, index) => index > 0 && (candidate.style === 'total' || candidate.style === 'grand') && previous.rows.findIndex((other) => other.key === item.key) < previous.rows.findIndex((other) => other.key === candidate.key))
    const created: ReportRow = { ...item, cells: [now, then, now !== null && then !== null ? now - then : null] }
    if (insertAt < 0) merged.push(created)
    else merged.splice(insertAt, 0, created)
  }
  return {
    ...current,
    columns: [{ key: 'current', label: labels.current }, { key: 'previous', label: labels.previous }, { key: 'change', label: 'Change' }],
    rows: merged,
    checks: [...current.checks, ...previous.checks.filter((check) => check.status !== 'pass').map((check) => ({ ...check, id: `previous-${check.id}`, label: `${labels.previous}: ${check.label}` }))],
  }
}
