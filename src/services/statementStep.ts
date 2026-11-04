import { formatCents, isValidIsoDate, parseMoneyToCents } from '../../shared/reconciliation'

export type StatementInput = { periodStart: string; periodEnd: string; statementDate: string; beginning: string; ending: string }
export type PreviousBalance = { periodEnd: string; endingCents: number }

/** Statement date follows the end date until the user sets it to something else. */
export function nextStatementDate(oldEnd: string, newEnd: string, currentStatementDate: string): string {
  return currentStatementDate === '' || currentStatementDate === oldEnd ? newEnd : currentStatementDate
}

/** Ending minus beginning, in integer cents. */
export const netChangeCents = (beginningCents: number, endingCents: number) => endingCents - beginningCents

/** Currency display for a balance field that is not being edited; unparseable text is shown as typed. */
export function displayBalance(text: string): string {
  const cents = parseMoneyToCents(text)
  return text.trim() === '' || cents === null ? text : formatCents(cents)
}

export type StatementValidation = { errors: string[]; beginningCents: number | null; endingCents: number | null }

/** Checks everything the Statement step must know before matching can start. */
export function validateStatement(input: StatementInput, previous?: PreviousBalance): StatementValidation {
  const errors: string[] = []
  if (!isValidIsoDate(input.periodStart) || !isValidIsoDate(input.periodEnd) || !isValidIsoDate(input.statementDate)) {
    errors.push('Enter valid dates for the statement start, end and statement date.')
  } else if (input.periodStart > input.periodEnd) {
    errors.push('The statement start date is after the end date.')
  }
  const beginningCents = parseMoneyToCents(input.beginning)
  const endingCents = parseMoneyToCents(input.ending)
  if (beginningCents === null || endingCents === null) errors.push('Enter the beginning and ending balances as numbers, for example 1,234.56.')
  if (previous && beginningCents !== null && beginningCents !== previous.endingCents) {
    errors.push(`The beginning balance (${formatCents(beginningCents)}) does not agree with the previous completed reconciliation, which ended on ${previous.periodEnd} at ${formatCents(previous.endingCents)}. Correct it, or reopen the earlier reconciliation if it was wrong.`)
  }
  return { errors, beginningCents, endingCents }
}
