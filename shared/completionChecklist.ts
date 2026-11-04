import { formatCents, type CalcInput, type Computation, type IssueCode } from './reconciliation.js'

export type ChecklistStatus = 'passed' | 'attention' | 'unavailable'
export type ChecklistItem = { id: string; label: string; status: ChecklistStatus; reason: string }

type Rule = { id: string; label: string; codes: IssueCode[]; needsStatementDetail?: boolean; passed: string; unavailable?: string }

const RULES: Rule[] = [
  { id: 'opening', label: 'Opening balance verified', codes: ['opening_unconfirmed', 'opening_mismatch', 'period_overlap'], passed: 'The beginning balance is confirmed or agrees with the previous completed reconciliation.' },
  { id: 'statement', label: 'Statement dates and balances valid', codes: ['dates_invalid', 'period_invalid', 'period_in_future', 'statement_empty', 'statement_out_of_period'], passed: 'The statement dates are valid and consistent.' },
  { id: 'coverage', label: 'Statement coverage sufficient', codes: ['statement_coverage'], needsStatementDetail: true, passed: 'The statement lines add up to the change between the beginning and ending balances.', unavailable: 'Statement detail was entered manually, so coverage cannot be checked.' },
  { id: 'matches', label: 'Statement matches valid and unique', codes: ['statement_lines_unmatched', 'cleared_without_line', 'statement_line_reused', 'transaction_matched_twice'], needsStatementDetail: true, passed: 'Every statement line is matched to exactly one cleared transaction.', unavailable: 'Statement detail was entered manually, so there are no statement matches to check.' },
  { id: 'discrepancies', label: 'No unresolved amount or direction discrepancies', codes: ['amount_discrepancy'], needsStatementDetail: true, passed: 'Matched items agree in amount and direction.', unavailable: 'Statement detail was entered manually, so amounts cannot be compared with statement lines.' },
  { id: 'difference', label: 'Reconciliation difference exactly zero', codes: ['not_balanced'], passed: 'The difference is $0.00.' },
]

/**
 * Plain-language view of the completion rules. It only reads the issues the shared calculation
 * (and therefore the server) already produced, so it cannot be weaker than the server check.
 */
export function completionChecklist(rec: Pick<CalcInput, 'statementMode'>, computation: Computation): ChecklistItem[] {
  const blocking = computation.issues.filter((issue) => issue.severity === 'blocking')
  const claimed = new Set<IssueCode>(RULES.flatMap((rule) => rule.codes))
  const items: ChecklistItem[] = RULES.map((rule) => {
    const hits = blocking.filter((issue) => rule.codes.includes(issue.code))
    if (hits.length > 0) {
      const detail = rule.id === 'difference' ? `The remaining difference is ${formatCents(computation.differenceCents)}.` : hits.map((issue) => issue.message).join(' ')
      return { id: rule.id, label: rule.label, status: 'attention', reason: detail }
    }
    if (rule.needsStatementDetail && rec.statementMode !== 'csv') return { id: rule.id, label: rule.label, status: 'unavailable', reason: rule.unavailable ?? 'Not available for this statement.' }
    return { id: rule.id, label: rule.label, status: 'passed', reason: rule.passed }
  })
  const others = blocking.filter((issue) => !claimed.has(issue.code))
  const zeroButBlocked = computation.differenceCents === 0 && blocking.length > 0
  items.push({
    id: 'blocking',
    label: 'No remaining blocking issues',
    status: blocking.length === 0 ? 'passed' : 'attention',
    reason: blocking.length === 0
      ? 'No blocking issues remain.'
      : `${blocking.length} blocking issue${blocking.length === 1 ? '' : 's'} remain${blocking.length === 1 ? 's' : ''}${others.length > 0 ? `: ${others.map((issue) => issue.message).join(' ')}` : ' (listed above)'}${zeroButBlocked ? ' A zero difference alone does not allow completion.' : ''}`,
  })
  return items
}

export type OutstandingBasis = { basis: 'verified' | 'provisional'; reason: string }

/**
 * Uncleared items are only verified outstanding items when an imported statement has been fully matched
 * and every completion check passes. Otherwise they are provisional: simply not yet found on the statement.
 */
export function outstandingBasis(rec: Pick<CalcInput, 'statementMode'>, computation: Computation): OutstandingBasis {
  if (rec.statementMode !== 'csv') return { basis: 'provisional', reason: 'Statement detail was entered manually, so uncleared items have not been checked against statement lines.' }
  if (!computation.canComplete) return { basis: 'provisional', reason: 'Some completion checks still need attention, so uncleared items are only provisionally outstanding.' }
  return { basis: 'verified', reason: 'The imported statement is fully matched and every check passes, so these items are confirmed outstanding.' }
}
