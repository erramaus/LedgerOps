import { formatCents, type Match, type ReconTxn, type StatementLine } from '../../shared/reconciliation'

export type TxnState = 'Matched and cleared' | 'Needs investigation' | 'Not yet reviewed' | 'Uncleared / potentially outstanding'

export type TxnStateInput = { cleared: boolean; flagged: boolean; suggested: boolean; csv: boolean }

/**
 * Review state of one book transaction. Only the totals in the reconciliation computation decide
 * what is outstanding; this label never claims an uncleared item is a confirmed outstanding item.
 */
export function classifyTxn(input: TxnStateInput): TxnState {
  if (input.cleared) return 'Matched and cleared'
  if (input.flagged) return 'Needs investigation'
  if (input.suggested || !input.csv) return 'Not yet reviewed'
  return 'Uncleared / potentially outstanding'
}

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000)
const words = (value: string) => new Set(value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((word) => word.length >= 3))

/** Plain-language evidence for pairing a book transaction with a statement line. */
export function matchEvidence(txn: ReconTxn, line: StatementLine): string[] {
  const evidence: string[] = []
  evidence.push(txn.amountCents === line.amountCents ? `Amount ${formatCents(txn.amountCents)} is the same` : `Amount differs: books ${formatCents(txn.amountCents)}, statement ${formatCents(line.amountCents)}`)
  const days = Math.abs(dayNumber(txn.date) - dayNumber(line.date))
  evidence.push(days === 0 ? `Same date (${txn.date})` : `Dates are ${days} day${days === 1 ? '' : 's'} apart (books ${txn.date}, statement ${line.date})`)
  const bookWords = words(`${txn.payee} ${txn.memo}`)
  const shared = [...words(line.description)].filter((word) => bookWords.has(word))
  if (shared.length > 0) evidence.push(`Description shares "${shared.join(' ')}" with the payee`)
  if (txn.direction !== line.direction) evidence.push('Direction differs')
  return evidence
}

export type MatchState = { clearedIds: string[]; matches: Match[] }

/**
 * Pairs a transaction with a statement line and marks it cleared. A line already used by a different
 * transaction is refused, so one statement line can never explain two book entries.
 */
export function acceptMatch(state: MatchState, txnId: string, lineId: string): MatchState | null {
  if (state.matches.some((match) => match.lineId === lineId && match.txnId !== txnId)) return null
  return {
    clearedIds: state.clearedIds.includes(txnId) ? state.clearedIds : [...state.clearedIds, txnId],
    matches: [...state.matches.filter((match) => match.txnId !== txnId), { lineId, txnId }],
  }
}

/** Counts for the unmatched-statement section; every original line stays available in the record. */
export function unmatchedSummary(lines: StatementLine[], matches: Match[]) {
  const used = new Set(matches.map((match) => match.lineId))
  const unmatched = lines.filter((line) => !used.has(line.id))
  return { total: lines.length, matched: lines.length - unmatched.length, unmatched }
}

/**
 * Checks a manually chosen pairing. Only an exact amount in the same direction is supported: the
 * reconciliation model has no recorded-reason field, so exceptional matches are blocked, not accepted.
 */
export function validateManualMatch(txn: ReconTxn, line: StatementLine, matches: Match[]): string | null {
  if (matches.some((match) => match.lineId === line.id && match.txnId !== txn.id)) return 'That statement item is already matched to another transaction.'
  if (txn.direction !== line.direction) return `Direction disagrees: the books show ${txn.direction === 'increase' ? 'money in' : 'money out'} but the statement item is ${line.direction === 'increase' ? 'money in' : 'money out'}.`
  if (txn.amountCents !== line.amountCents) return `Amounts disagree: books ${formatCents(txn.amountCents)}, statement ${formatCents(line.amountCents)}. Exceptional matches are not supported; correct the books or investigate the item.`
  return null
}

export type BulkClearPlan = { clear: string[]; skipped: string[] }

/**
 * Bulk clearing with a statement: only transactions that already hold, or can take, a valid unclaimed
 * statement line are cleared. The rest stay uncleared for individual investigation.
 */
export function planBulkClear(shown: ReconTxn[], clearedIds: string[], matches: Match[], suggestions: { txnId: string; lineId: string }[]): BulkClearPlan {
  const used = new Set(matches.map((match) => match.lineId))
  const matched = new Set(matches.map((match) => match.txnId))
  const cleared = new Set(clearedIds)
  const clear: string[] = []
  const skipped: string[] = []
  for (const item of shown) {
    if (cleared.has(item.id) && matched.has(item.id)) continue
    const suggestion = suggestions.find((entry) => entry.txnId === item.id)
    if (matched.has(item.id)) clear.push(item.id)
    else if (suggestion && !used.has(suggestion.lineId)) { clear.push(item.id); used.add(suggestion.lineId) }
    else if (!cleared.has(item.id)) skipped.push(item.id)
  }
  return { clear, skipped }
}
