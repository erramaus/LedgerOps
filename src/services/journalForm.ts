export type JournalLineText = { accountId: string; debit: string; credit: string; memo?: string }

/** Whole cents from typed text. Empty is 0; anything that is not a non-negative amount with at most two decimals is NaN. */
export function parseAmountCents(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) return 0
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return Number.NaN
  return Math.round(Number(trimmed) * 100)
}

export type JournalReadinessState = 'empty' | 'invalid' | 'unbalanced' | 'balanced'

export type JournalReadiness = {
  debitCents: number
  creditCents: number
  differenceCents: number
  state: JournalReadinessState
  /** True only when the lines pass the same line rules the server enforces and debits equal credits above zero. */
  ready: boolean
  reasons: string[]
}

export function journalReadiness(lines: JournalLineText[]): JournalReadiness {
  let debitCents = 0
  let creditCents = 0
  const reasons: string[] = []
  const touched = lines.some((line) => line.accountId || line.debit.trim() || line.credit.trim())
  lines.forEach((line, index) => {
    const label = `Line ${index + 1}`
    const debit = parseAmountCents(line.debit)
    const credit = parseAmountCents(line.credit)
    if (Number.isNaN(debit) || Number.isNaN(credit)) {
      reasons.push(`${label}: enter amounts as positive dollars and cents.`)
      return
    }
    debitCents += debit
    creditCents += credit
    if (!line.accountId) reasons.push(`${label}: choose an account.`)
    if (debit > 0 && credit > 0) reasons.push(`${label}: enter either a debit or a credit, not both.`)
    else if (debit === 0 && credit === 0) reasons.push(`${label}: enter a debit or credit amount above zero.`)
  })
  if (lines.length < 2) reasons.push('Add at least two journal lines.')
  const differenceCents = debitCents - creditCents
  if (!touched) return { debitCents, creditCents, differenceCents, state: 'empty', ready: false, reasons: ['Nothing has been entered yet.'] }
  if (debitCents !== creditCents) reasons.push('Total debits must equal total credits.')
  else if (debitCents === 0) reasons.push('Total debits and credits must be above zero.')
  const hasLineProblem = reasons.some((reason) => reason.startsWith('Line ') || reason.startsWith('Add at least'))
  const state: JournalReadinessState = hasLineProblem ? 'invalid' : debitCents !== creditCents ? 'unbalanced' : debitCents === 0 ? 'invalid' : 'balanced'
  return { debitCents, creditCents, differenceCents, state, ready: reasons.length === 0, reasons }
}
