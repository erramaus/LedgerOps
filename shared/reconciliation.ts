// Pure reconciliation logic shared by the browser and the server. No imports, no I/O.
// Every amount is an integer number of cents. A transaction's `direction` is relative to the
// statement balance, so one formula serves both account types:
//   bank:        deposit = increase, withdrawal = decrease      (statement shows money held)
//   credit card: charge  = increase, payment/credit = decrease  (statement shows money owed)

export type Source = 'demo' | 'quickbooks'
export type AccountKind = 'bank' | 'credit_card'
export type Direction = 'increase' | 'decrease'

export type ReconTxn = { id: string; date: string; payee: string; memo: string; amountCents: number; direction: Direction; type?: string }
export type StatementLine = { id: string; date: string; description: string; amountCents: number; direction: Direction }
export type Match = { lineId: string; txnId: string }
export type Completeness = { complete: boolean; reasons: string[] }
export type HistoryEvent = { at: string; by: string; action: 'saved' | 'completed' | 'reopened'; reason?: string; differenceCents?: number }

export type CompletionResult = {
  differenceCents: number
  clearedBalanceCents: number
  clearedCount: number
  outstandingIncreaseCents: number
  outstandingDecreaseCents: number
  adjustedBankBalanceCents: number
  bookBalanceCents: number
  warnings: string[]
}

export type ReconciliationRecord = {
  id: string
  source: Source
  clientId: string
  clientName: string
  accountId: string
  accountName: string
  accountKind: AccountKind
  periodStart: string
  periodEnd: string
  statementDate: string
  beginningCents: number
  endingCents: number
  openingConfirmed: boolean
  statementMode: 'manual' | 'csv'
  statementLines: StatementLine[]
  transactions: ReconTxn[]
  clearedIds: string[]
  matches: Match[]
  completeness: Completeness
  status: 'draft' | 'completed'
  version: number
  createdAt: string
  updatedAt: string
  completedAt?: string
  completedBy?: string
  history: HistoryEvent[]
  result?: CompletionResult
}

export const MAX_ITEMS = 5000
export const RECORD_ID_PATTERN = /^(demo|quickbooks):[\w-]{1,60}:[\w-]{1,60}:\d{4}-\d{2}-\d{2}$/
export const reconciliationId = (source: Source, clientId: string, accountId: string, periodEnd: string) => `${source}:${clientId}:${accountId}:${periodEnd}`

// ---- Dates and money -------------------------------------------------------------------------

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/** Parses "$1,234.56", "(12.30)", "-12.3" and "12"; returns null for anything else. */
export function parseMoneyToCents(input: string): number | null {
  let text = input.trim()
  if (!text) return null
  let negative = false
  if (/^\(.*\)$/.test(text)) {
    negative = true
    text = text.slice(1, -1).trim()
  }
  const match = /^([+-])?\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(text)
  if (!match) return null
  const whole = Number(match[2].replace(/,/g, ''))
  if (!Number.isSafeInteger(whole) || whole > 1e11) return null
  const cents = whole * 100 + Number(`${match[3] ?? ''}00`.slice(0, 2))
  return match[1] === '-' !== negative ? -cents : cents
}

export const formatCents = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
export const signedCents = (transaction: { direction: Direction; amountCents: number }) => (transaction.direction === 'increase' ? transaction.amountCents : -transaction.amountCents)

export function labelsFor(kind: AccountKind) {
  return kind === 'bank'
    ? { increase: 'Deposit', decrease: 'Withdrawal', outstandingIncrease: 'Deposit in transit', outstandingDecrease: 'Outstanding check or payment', outstandingIncreasePlural: 'Deposits in transit', outstandingDecreasePlural: 'Outstanding checks and payments', owed: false }
    : { increase: 'Charge', decrease: 'Payment or credit', outstandingIncrease: 'Charge not yet on statement', outstandingDecrease: 'Payment not yet on statement', outstandingIncreasePlural: 'Charges not yet on statement', outstandingDecreasePlural: 'Payments not yet on statement', owed: true }
}

// ---- Eligibility -------------------------------------------------------------------------------

/**
 * Transactions that can still be cleared in this reconciliation. With no earlier reconciliation,
 * anything dated before the period is assumed to be inside the opening balance.
 */
export function splitEligible(all: ReconTxn[], options: { periodStart: string; periodEnd: string; previouslyClearedIds: Set<string>; hasPrevious: boolean }) {
  const eligible: ReconTxn[] = []
  const assumedInOpening: ReconTxn[] = []
  for (const transaction of all) {
    if (transaction.date > options.periodEnd || options.previouslyClearedIds.has(transaction.id)) continue
    if (!options.hasPrevious && transaction.date < options.periodStart) assumedInOpening.push(transaction)
    else eligible.push(transaction)
  }
  const order = (left: ReconTxn, right: ReconTxn) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id)
  return { eligible: eligible.sort(order), assumedInOpening: assumedInOpening.sort(order) }
}

// ---- Matching, duplicates, changes -----------------------------------------------------------

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const tokens = (value: string) => new Set(normalize(value).split(' ').filter((word) => word.length >= 3))
const sharesWord = (left: string, right: string) => {
  const other = tokens(right)
  return [...tokens(left)].some((word) => other.has(word))
}

export type SuggestedMatch = { lineId: string; txnId: string; reasons: string[]; score: number }

/** One-to-one suggestions: same direction and exact amount, dates close, best score first. */
export function suggestMatches(lines: StatementLine[], transactions: ReconTxn[], dayTolerance = 7): SuggestedMatch[] {
  const candidates: SuggestedMatch[] = []
  for (const line of lines) {
    for (const transaction of transactions) {
      if (transaction.direction !== line.direction || transaction.amountCents !== line.amountCents) continue
      const days = Math.abs(daysBetween(transaction.date, line.date))
      if (days > dayTolerance) continue
      const wording = sharesWord(line.description, `${transaction.payee} ${transaction.memo}`)
      candidates.push({
        lineId: line.id,
        txnId: transaction.id,
        score: 100 - days * 5 + (wording ? 20 : 0),
        reasons: ['Same amount', days === 0 ? 'Same date' : `${days} day${days === 1 ? '' : 's'} apart`, ...(wording ? ['Description matches payee'] : [])],
      })
    }
  }
  const usedLines = new Set<string>()
  const usedTransactions = new Set<string>()
  return candidates
    .sort((left, right) => right.score - left.score || left.lineId.localeCompare(right.lineId) || left.txnId.localeCompare(right.txnId))
    .filter((candidate) => {
      if (usedLines.has(candidate.lineId) || usedTransactions.has(candidate.txnId)) return false
      usedLines.add(candidate.lineId)
      usedTransactions.add(candidate.txnId)
      return true
    })
}

export type NearMatch = { lineId: string; txnId: string; statementCents: number; bookCents: number }

/** Statement lines that look like an unmatched transaction but for a different amount. */
export function findAmountDiscrepancies(lines: StatementLine[], transactions: ReconTxn[]): NearMatch[] {
  const found: NearMatch[] = []
  const usedTransactions = new Set<string>()
  for (const line of lines) {
    const near = transactions.find(
      (transaction) =>
        !usedTransactions.has(transaction.id) &&
        transaction.direction === line.direction &&
        transaction.amountCents !== line.amountCents &&
        Math.abs(daysBetween(transaction.date, line.date)) <= 3 &&
        sharesWord(line.description, `${transaction.payee} ${transaction.memo}`),
    )
    if (near) {
      usedTransactions.add(near.id)
      found.push({ lineId: line.id, txnId: near.id, statementCents: line.amountCents, bookCents: near.amountCents })
    }
  }
  return found
}

export function findDuplicateTransactions(transactions: ReconTxn[], windowDays = 7): ReconTxn[][] {
  const groups = new Map<string, ReconTxn[]>()
  for (const transaction of transactions) {
    const key = `${normalize(transaction.payee || transaction.memo)}|${transaction.direction}|${transaction.amountCents}`
    groups.set(key, [...(groups.get(key) ?? []), transaction])
  }
  const clusters: ReconTxn[][] = []
  for (const group of groups.values()) {
    const sorted = [...group].sort((left, right) => left.date.localeCompare(right.date))
    let cluster: ReconTxn[] = []
    for (const transaction of sorted) {
      if (cluster.length > 0 && daysBetween(cluster[cluster.length - 1].date, transaction.date) > windowDays) {
        if (cluster.length > 1) clusters.push(cluster)
        cluster = []
      }
      cluster.push(transaction)
    }
    if (cluster.length > 1) clusters.push(cluster)
  }
  return clusters
}

export function findDuplicateLines(lines: StatementLine[]): StatementLine[][] {
  const groups = new Map<string, StatementLine[]>()
  for (const line of lines) {
    const key = `${line.date}|${line.direction}|${line.amountCents}|${normalize(line.description)}`
    groups.set(key, [...(groups.get(key) ?? []), line])
  }
  return [...groups.values()].filter((group) => group.length > 1)
}

export type ChangedItem = { id: string; payee: string; change: 'deleted' | 'amount' | 'date' | 'direction'; before: ReconTxn; after?: ReconTxn }

/** Transactions cleared in the previous reconciliation that no longer look the same in the books. */
export function findChangedSincePrevious(previousCleared: ReconTxn[], current: ReconTxn[]): ChangedItem[] {
  const byId = new Map(current.map((transaction) => [transaction.id, transaction]))
  const changes: ChangedItem[] = []
  for (const before of previousCleared) {
    const after = byId.get(before.id)
    const change = !after ? 'deleted' : after.direction !== before.direction ? 'direction' : after.amountCents !== before.amountCents ? 'amount' : after.date !== before.date ? 'date' : null
    if (change) changes.push({ id: before.id, payee: before.payee, change, before, after })
  }
  return changes
}

// ---- The calculation ---------------------------------------------------------------------------

export type PreviousRecon = { endingCents: number; periodEnd: string; clearedTransactions: ReconTxn[] }
export type IssueCode =
  | 'period_invalid' | 'dates_invalid' | 'period_in_future' | 'period_overlap' | 'opening_mismatch' | 'opening_unconfirmed'
  | 'data_incomplete' | 'cleared_unknown' | 'statement_empty' | 'statement_coverage' | 'statement_out_of_period'
  | 'statement_lines_unmatched' | 'cleared_without_line' | 'amount_discrepancy' | 'statement_line_reused' | 'transaction_matched_twice' | 'previously_cleared_changed'
  | 'not_balanced' | 'already_completed' | 'possible_duplicate' | 'statement_duplicate_lines' | 'assumed_opening'
export type Issue = { code: IssueCode; severity: 'blocking' | 'warning'; message: string }

export type CalcInput = Pick<
  ReconciliationRecord,
  'accountKind' | 'periodStart' | 'periodEnd' | 'statementDate' | 'beginningCents' | 'endingCents' | 'openingConfirmed' | 'statementMode' | 'statementLines' | 'transactions' | 'clearedIds' | 'matches' | 'completeness'
>

export type Computation = {
  clearedIncreaseCents: number
  clearedDecreaseCents: number
  clearedBalanceCents: number
  differenceCents: number
  cleared: ReconTxn[]
  outstandingIncrease: ReconTxn[]
  outstandingDecrease: ReconTxn[]
  outstandingIncreaseCents: number
  outstandingDecreaseCents: number
  adjustedBankBalanceCents: number
  bookBalanceCents: number
  unmatchedLines: StatementLine[]
  clearedWithoutLine: ReconTxn[]
  suggestions: SuggestedMatch[]
  nearMatches: NearMatch[]
  duplicates: ReconTxn[][]
  statementDuplicates: StatementLine[][]
  changedSincePrevious: ChangedItem[]
  issues: Issue[]
  explanations: string[]
  canComplete: boolean
}

export interface CalcOptions {
  previous?: PreviousRecon
  /** Fresh copy of every transaction from the source, used to spot changes to earlier reconciliations. */
  sourceTransactions?: ReconTxn[]
  today?: string
}

const sum = (items: { direction: Direction; amountCents: number }[]) => items.reduce((total, item) => total + signedCents(item), 0)
const describeTxn = (t: ReconTxn) => `"${t.payee || t.memo || 'Transaction'}" on ${t.date} (${formatCents(t.amountCents)})`
const describeLine = (l: StatementLine) => `"${l.description || 'Statement line'}" on ${l.date} (${formatCents(l.amountCents)})`
const list = (items: string[], limit = 3) => (items.length <= limit ? items.join('; ') : `${items.slice(0, limit).join('; ')}; and ${items.length - limit} more`)

export function computeReconciliation(rec: CalcInput, options: CalcOptions = {}): Computation {
  const issues: Issue[] = []
  const add = (code: IssueCode, severity: Issue['severity'], message: string) => issues.push({ code, severity, message })
  const labels = labelsFor(rec.accountKind)

  const knownIds = new Set(rec.transactions.map((transaction) => transaction.id))
  const unknownCleared = rec.clearedIds.filter((id) => !knownIds.has(id))
  const clearedSet = new Set(rec.clearedIds)
  const cleared = rec.transactions.filter((transaction) => clearedSet.has(transaction.id))
  const uncleared = rec.transactions.filter((transaction) => !clearedSet.has(transaction.id))
  const outstandingIncrease = uncleared.filter((transaction) => transaction.direction === 'increase')
  const outstandingDecrease = uncleared.filter((transaction) => transaction.direction === 'decrease')

  const clearedIncreaseCents = cleared.filter((t) => t.direction === 'increase').reduce((total, t) => total + t.amountCents, 0)
  const clearedDecreaseCents = cleared.filter((t) => t.direction === 'decrease').reduce((total, t) => total + t.amountCents, 0)
  const clearedBalanceCents = rec.beginningCents + clearedIncreaseCents - clearedDecreaseCents
  const differenceCents = rec.endingCents - clearedBalanceCents
  const outstandingIncreaseCents = outstandingIncrease.reduce((total, t) => total + t.amountCents, 0)
  const outstandingDecreaseCents = outstandingDecrease.reduce((total, t) => total + t.amountCents, 0)
  const adjustedBankBalanceCents = rec.endingCents + outstandingIncreaseCents - outstandingDecreaseCents
  const bookBalanceCents = rec.beginningCents + sum(rec.transactions)

  // Statement period and dates
  if (!isValidIsoDate(rec.periodStart) || !isValidIsoDate(rec.periodEnd)) add('dates_invalid', 'blocking', 'Enter a valid statement start and end date.')
  else {
    if (rec.periodStart > rec.periodEnd) add('period_invalid', 'blocking', 'The statement period starts after it ends.')
    else if (daysBetween(rec.periodStart, rec.periodEnd) > 400) add('period_invalid', 'blocking', 'The statement period is longer than a year.')
    if (options.today && rec.periodEnd > options.today) add('period_in_future', 'blocking', 'The statement period ends in the future.')
  }
  if (!isValidIsoDate(rec.statementDate)) add('dates_invalid', 'blocking', 'Enter a valid statement date.')
  else if (isValidIsoDate(rec.periodEnd) && rec.statementDate < rec.periodEnd) add('dates_invalid', 'blocking', 'The statement date is before the end of the period.')

  // Opening balance
  if (options.previous) {
    if (rec.beginningCents !== options.previous.endingCents) {
      add('opening_mismatch', 'blocking', `The beginning balance (${formatCents(rec.beginningCents)}) does not match the ending balance of the last completed reconciliation (${formatCents(options.previous.endingCents)}, period ended ${options.previous.periodEnd}).`)
    }
    if (isValidIsoDate(rec.periodStart) && rec.periodStart <= options.previous.periodEnd) add('period_overlap', 'blocking', `This period overlaps the previous reconciliation, which ended ${options.previous.periodEnd}.`)
  } else if (!rec.openingConfirmed) {
    add('opening_unconfirmed', 'blocking', 'This is the first reconciliation for the account. Confirm that the beginning balance matches the prior statement and earlier activity was reconciled.')
  }

  // Source data
  if (!rec.completeness.complete) add('data_incomplete', 'blocking', `The transaction data is incomplete${rec.completeness.reasons.length ? `: ${list(rec.completeness.reasons)}` : ''}. A zero difference cannot be trusted.`)
  if (unknownCleared.length > 0) add('cleared_unknown', 'blocking', `${unknownCleared.length} cleared item${unknownCleared.length === 1 ? ' is' : 's are'} no longer in the transaction list. Reload the data.`)

  // Statement detail (CSV)
  const lineById = new Map(rec.statementLines.map((line) => [line.id, line]))
  const txnById = new Map(rec.transactions.map((transaction) => [transaction.id, transaction]))
  const validMatches = rec.matches.filter((match) => lineById.has(match.lineId) && clearedSet.has(match.txnId) && txnById.has(match.txnId))
  const matchedLineIds = new Set(validMatches.map((match) => match.lineId))
  const matchedTxnIds = new Set(validMatches.map((match) => match.txnId))
  const unmatchedLines = rec.statementMode === 'csv' ? rec.statementLines.filter((line) => !matchedLineIds.has(line.id)) : []
  const clearedWithoutLine = rec.statementMode === 'csv' ? cleared.filter((transaction) => !matchedTxnIds.has(transaction.id)) : []
  const suggestions = rec.statementMode === 'csv' ? suggestMatches(unmatchedLines, uncleared) : []
  const nearMatches = rec.statementMode === 'csv' ? findAmountDiscrepancies(unmatchedLines, uncleared) : []
  const statementDuplicates = rec.statementMode === 'csv' ? findDuplicateLines(rec.statementLines) : []

  if (rec.statementMode === 'csv') {
    if (rec.statementLines.length === 0) add('statement_empty', 'blocking', 'No statement transactions were imported.')
    const outside = rec.statementLines.filter((line) => line.date < rec.periodStart || line.date > rec.periodEnd)
    if (outside.length > 0) add('statement_out_of_period', 'blocking', `${outside.length} statement line${outside.length === 1 ? ' is' : 's are'} outside the statement period: ${list(outside.map(describeLine))}.`)
    const lineChange = sum(rec.statementLines)
    const expectedChange = rec.endingCents - rec.beginningCents
    if (lineChange !== expectedChange) {
      add('statement_coverage', 'blocking', `The imported statement lines change the balance by ${formatCents(lineChange)}, but the beginning and ending balances differ by ${formatCents(expectedChange)}. The statement data is incomplete or a balance is wrong (${formatCents(expectedChange - lineChange)} unexplained).`)
    }
    const mismatched = validMatches.flatMap((match) => {
      const line = lineById.get(match.lineId)!
      const transaction = txnById.get(match.txnId)!
      return line.amountCents !== transaction.amountCents || line.direction !== transaction.direction ? [`${describeLine(line)} was matched to ${describeTxn(transaction)}`] : []
    })
    if (mismatched.length > 0) add('amount_discrepancy', 'blocking', `Amounts differ between the statement and your books: ${list(mismatched)}.`)
    const linesUsedTwice = [...new Set(validMatches.filter((match, index) => validMatches.findIndex((other) => other.lineId === match.lineId) !== index).map((match) => match.lineId))]
    if (linesUsedTwice.length > 0) add('statement_line_reused', 'blocking', `Each statement line can explain only one transaction, but ${list(linesUsedTwice.map((lineId) => describeLine(lineById.get(lineId)!)))} ${linesUsedTwice.length === 1 ? 'is' : 'are'} matched to more than one.`)
    const txnsUsedTwice = [...new Set(validMatches.filter((match, index) => validMatches.findIndex((other) => other.txnId === match.txnId) !== index).map((match) => match.txnId))]
    if (txnsUsedTwice.length > 0) add('transaction_matched_twice', 'blocking', `Each transaction can match only one statement line, but ${list(txnsUsedTwice.map((txnId) => describeTxn(txnById.get(txnId)!)))} ${txnsUsedTwice.length === 1 ? 'is' : 'are'} matched to more than one.`)
    if (unmatchedLines.length > 0) add('statement_lines_unmatched', 'blocking', `${unmatchedLines.length} statement line${unmatchedLines.length === 1 ? ' is' : 's are'} not matched to a transaction in your books: ${list(unmatchedLines.map(describeLine))}.`)
    if (clearedWithoutLine.length > 0) add('cleared_without_line', 'blocking', `${clearedWithoutLine.length} cleared transaction${clearedWithoutLine.length === 1 ? ' has' : 's have'} no matching statement line: ${list(clearedWithoutLine.map(describeTxn))}.`)
    if (statementDuplicates.length > 0) add('statement_duplicate_lines', 'warning', `${statementDuplicates.length} group${statementDuplicates.length === 1 ? '' : 's'} of identical statement lines. Check they are not import duplicates.`)
  }

  // Potential duplicates in the books
  const duplicates = findDuplicateTransactions(rec.transactions)
  if (duplicates.length > 0) add('possible_duplicate', 'warning', `Possible duplicate transactions: ${list(duplicates.map((group) => `${describeTxn(group[0])} appears ${group.length} times`))}. These are suggestions to check, not confirmed errors.`)

  // Earlier reconciliations that no longer agree with the books
  const changedSincePrevious = options.previous && options.sourceTransactions ? findChangedSincePrevious(options.previous.clearedTransactions, options.sourceTransactions) : []
  if (changedSincePrevious.length > 0) {
    add('previously_cleared_changed', 'blocking', `${changedSincePrevious.length} transaction${changedSincePrevious.length === 1 ? '' : 's'} cleared in the previous reconciliation ${changedSincePrevious.length === 1 ? 'has' : 'have'} changed: ${list(changedSincePrevious.map((item) => `${describeTxn(item.before)} ${item.change === 'deleted' ? 'was deleted' : `${item.change} changed`}`))}.`)
  }

  // The balance itself
  if (differenceCents !== 0) add('not_balanced', 'blocking', `The statement ending balance is ${formatCents(rec.endingCents)} but your cleared transactions come to ${formatCents(clearedBalanceCents)}. The difference is ${formatCents(differenceCents)}.`)

  const explanations = explain({ rec, differenceCents, cleared, uncleared, unmatchedLines, nearMatches, txnById, labels })
  return {
    clearedIncreaseCents, clearedDecreaseCents, clearedBalanceCents, differenceCents, cleared,
    outstandingIncrease, outstandingDecrease, outstandingIncreaseCents, outstandingDecreaseCents,
    adjustedBankBalanceCents, bookBalanceCents, unmatchedLines, clearedWithoutLine, suggestions, nearMatches,
    duplicates, statementDuplicates, changedSincePrevious, issues, explanations,
    canComplete: !issues.some((issue) => issue.severity === 'blocking'),
  }
}

function explain(context: { rec: CalcInput; differenceCents: number; cleared: ReconTxn[]; uncleared: ReconTxn[]; unmatchedLines: StatementLine[]; nearMatches: NearMatch[]; txnById: Map<string, ReconTxn>; labels: ReturnType<typeof labelsFor> }): string[] {
  const { rec, differenceCents, cleared, uncleared, unmatchedLines, nearMatches, txnById, labels } = context
  if (differenceCents === 0) return []
  const lines: string[] = []
  const direction = differenceCents > 0 ? 'higher' : 'lower'
  lines.push(`The statement is ${formatCents(Math.abs(differenceCents))} ${direction} than your cleared transactions${labels.owed ? ' (amount owed)' : ''}.`)
  for (const line of unmatchedLines) {
    const explainsAll = signedCents(line) === differenceCents
    lines.push(`Statement line ${describeLine(line)} is not matched to your books${explainsAll ? ' and equals the whole difference. It is probably missing from QuickBooks; record it there, then reload.' : '.'}`)
  }
  for (const near of nearMatches) {
    const transaction = txnById.get(near.txnId)
    const line = rec.statementLines.find((item) => item.id === near.lineId)
    if (transaction && line) lines.push(`${describeLine(line)} looks like ${describeTxn(transaction)} but the amounts differ by ${formatCents(Math.abs(near.statementCents - near.bookCents))}. One of them may have a typing error.`)
  }
  for (const transaction of uncleared) {
    if (signedCents(transaction) === differenceCents) lines.push(`${describeTxn(transaction)} is not cleared but equals the difference. If it appears on the statement, mark it cleared.`)
  }
  for (const transaction of cleared) {
    if (signedCents(transaction) === -differenceCents) lines.push(`${describeTxn(transaction)} is cleared but equals the difference in the opposite direction. Check that it is really on the statement.`)
    else if (differenceCents !== 0 && 2 * signedCents(transaction) === -differenceCents) lines.push(`${describeTxn(transaction)} is cleared and twice its amount equals the difference. It may be recorded as a ${transaction.direction === 'increase' ? labels.increase.toLowerCase() : labels.decrease.toLowerCase()} when it should be the opposite.`)
  }
  if (Math.abs(differenceCents) % 9 === 0) lines.push('A difference divisible by 9 can mean two digits were transposed when an amount was entered.')
  if (lines.length === 1) lines.push('No single item explains it. Check every cleared item against the statement and confirm the beginning balance.')
  return lines
}

/** Everything that must hold before a reconciliation can be marked completed. */
export function validateCompletion(rec: CalcInput & Pick<ReconciliationRecord, 'status'>, options: CalcOptions = {}) {
  const computation = computeReconciliation(rec, options)
  const blocking = computation.issues.filter((issue) => issue.severity === 'blocking')
  if (rec.status === 'completed') blocking.push({ code: 'already_completed', severity: 'blocking', message: 'This reconciliation is already completed. Reopen it to make changes.' })
  return { ok: blocking.length === 0, blocking, computation }
}

export function summarizeResult(computation: Computation): CompletionResult {
  return {
    differenceCents: computation.differenceCents,
    clearedBalanceCents: computation.clearedBalanceCents,
    clearedCount: computation.cleared.length,
    outstandingIncreaseCents: computation.outstandingIncreaseCents,
    outstandingDecreaseCents: computation.outstandingDecreaseCents,
    adjustedBankBalanceCents: computation.adjustedBankBalanceCents,
    bookBalanceCents: computation.bookBalanceCents,
    warnings: computation.issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.message),
  }
}

export const previousFrom = (record: Pick<ReconciliationRecord, 'endingCents' | 'periodEnd' | 'transactions' | 'clearedIds'>): PreviousRecon => {
  const cleared = new Set(record.clearedIds)
  return { endingCents: record.endingCents, periodEnd: record.periodEnd, clearedTransactions: record.transactions.filter((transaction) => cleared.has(transaction.id)) }
}

/** Two transaction lists describe the same books (order, memo wording aside). */
export function sameTransactions(left: ReconTxn[], right: ReconTxn[]) {
  if (left.length !== right.length) return false
  const key = (t: ReconTxn) => `${t.id}|${t.date}|${t.direction}|${t.amountCents}`
  const rightKeys = new Set(right.map(key))
  return left.every((transaction) => rightKeys.has(key(transaction)))
}
