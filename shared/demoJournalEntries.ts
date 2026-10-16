import type { JournalEntry, JournalLine, LedgerAccountDef } from './accounting.js'
import { DEMO_CLIENT_ID, DEMO_PERIODS, demoLedger } from './demoBooks.js'
import { getAdditionalDemoCompany } from './demoCompanyBooks.js'
import type { DemoLedger } from './demoPayments.js'
import { isValidIsoDate, periodEnd, periodStart, type Period } from './period.js'

export type JournalRecordStatus = 'Draft' | 'Posted' | 'Reversed'
export type AdjustingEntryType =
  | 'Accrued Expense'
  | 'Prepaid Expense'
  | 'Depreciation'
  | 'Accrued Income'
  | 'Correction'
  | 'Reclassification'

export type DemoJournalLineInput = {
  accountId: string
  debitCents: number
  creditCents: number
  memo: string
}

export type DemoJournalEntryInput = {
  date: string
  description: string
  referenceNumber: string
  adjustmentType?: AdjustingEntryType
  explanation?: string
  lines: DemoJournalLineInput[]
}

export type JournalHistoryEvent = {
  at: string
  by: string
  action: 'created' | 'edited' | 'posted' | 'reversed'
  summary: string
  reason?: string
}

export type DemoJournalRecord = {
  id: string
  clientId: string
  status: JournalRecordStatus
  version: number
  input: DemoJournalEntryInput
  createdAt: string
  createdBy: string
  updatedAt: string
  history: JournalHistoryEvent[]
  postedAt?: string
  postedBy?: string
  reversesRecordId?: string
  reversalRecordId?: string
}

export const ACCOUNTANT_ACCOUNTS: LedgerAccountDef[] = [
  { id: 'prepaid-expenses', name: 'Prepaid Expenses', klass: 'asset', kind: 'other' },
  { id: 'accrued-liabilities', name: 'Accrued Liabilities', klass: 'liability', kind: 'other' },
  { id: 'accumulated-depreciation', name: 'Accumulated Depreciation', klass: 'asset', kind: 'other' },
  { id: 'depreciation-expense', name: 'Depreciation Expense', klass: 'expense', kind: 'other' },
]

const periodsFor = (clientId: string) => clientId === DEMO_CLIENT_ID ? DEMO_PERIODS : getAdditionalDemoCompany(clientId)?.periods ?? DEMO_PERIODS
const baseChartFor = (clientId: string) => clientId === DEMO_CLIENT_ID ? demoLedger.accounts : getAdditionalDemoCompany(clientId)?.ledger.accounts ?? demoLedger.accounts

export function accountantAccounts(accounts: LedgerAccountDef[]) {
  const known = new Set(accounts.map((account) => account.id))
  return [...accounts, ...ACCOUNTANT_ACCOUNTS.filter((account) => !known.has(account.id))]
}

export function journalAccounts(clientId = DEMO_CLIENT_ID, accounts = baseChartFor(clientId)) {
  return accountantAccounts(accounts)
}

const normalizeLine = (line: DemoJournalLineInput): DemoJournalLineInput => ({
  accountId: line.accountId.trim(),
  debitCents: line.debitCents,
  creditCents: line.creditCents,
  memo: line.memo.trim(),
})

export function normalizeJournalInput(input: DemoJournalEntryInput): DemoJournalEntryInput {
  return {
    date: input.date.trim(),
    description: input.description.trim(),
    referenceNumber: input.referenceNumber.trim(),
    ...(input.adjustmentType ? { adjustmentType: input.adjustmentType } : {}),
    ...(input.explanation?.trim() ? { explanation: input.explanation.trim() } : {}),
    lines: input.lines.map(normalizeLine),
  }
}

export type JournalValidationErrors = Record<string, string>

export function validateJournalInput(input: DemoJournalEntryInput, accounts = journalAccounts(), clientId = DEMO_CLIENT_ID): JournalValidationErrors {
  const normalized = normalizeJournalInput(input)
  const errors: JournalValidationErrors = {}
  const accountIds = new Set(accounts.map((account) => account.id))
  const periods = periodsFor(clientId)
  const start = periods.length > 0 ? periodStart(periods[0]) : '2026-05-01'
  const end = periods.length > 0 ? periodEnd(periods[periods.length - 1]) : '2026-08-31'
  if (!isValidIsoDate(normalized.date)) errors.date = 'Enter a valid journal-entry date.'
  else if (normalized.date < start || normalized.date > end) errors.date = clientId === DEMO_CLIENT_ID ? 'The demo books cover May 1 to August 31, 2026.' : `The demo books cover ${start} to ${end}.`
  if (!normalized.description) errors.description = 'Enter a description.'
  else if (normalized.description.length > 160) errors.description = 'Keep the description under 160 characters.'
  if (normalized.referenceNumber.length > 40) errors.referenceNumber = 'Keep the reference number under 40 characters.'
  if ((normalized.explanation ?? '').length > 500) errors.explanation = 'Keep the explanation under 500 characters.'
  if (normalized.lines.length < 2) errors.lines = 'Add at least two journal lines.'
  let debitTotal = 0
  let creditTotal = 0
  normalized.lines.forEach((line, index) => {
    if (!line.accountId) errors[`line-${index}-accountId`] = 'Choose an account.'
    else if (!accountIds.has(line.accountId)) errors[`line-${index}-accountId`] = 'Choose a valid account.'
    if (!Number.isSafeInteger(line.debitCents) || line.debitCents < 0) errors[`line-${index}-debitCents`] = 'Debit must be whole cents and not negative.'
    if (!Number.isSafeInteger(line.creditCents) || line.creditCents < 0) errors[`line-${index}-creditCents`] = 'Credit must be whole cents and not negative.'
    if ((line.debitCents > 0 && line.creditCents > 0) || (line.debitCents === 0 && line.creditCents === 0)) errors[`line-${index}-amount`] = 'Enter either a debit or a credit amount.'
    if (line.memo.length > 160) errors[`line-${index}-memo`] = 'Keep the line memo under 160 characters.'
    debitTotal += line.debitCents
    creditTotal += line.creditCents
  })
  if (debitTotal !== creditTotal) errors.balance = `Debits ${debitTotal} and credits ${creditTotal} must be equal.`
  return errors
}

export function totalDebits(lines: DemoJournalLineInput[]) {
  return lines.reduce((sum, line) => sum + line.debitCents, 0)
}

export function totalCredits(lines: DemoJournalLineInput[]) {
  return lines.reduce((sum, line) => sum + line.creditCents, 0)
}

const event = (action: JournalHistoryEvent['action'], at: string, by: string, summary: string, reason?: string): JournalHistoryEvent => ({
  at,
  by,
  action,
  summary,
  ...(reason ? { reason } : {}),
})

export function createDraftJournalRecord(id: string, clientId: string, input: DemoJournalEntryInput, by: string, at: string): DemoJournalRecord {
  const normalized = normalizeJournalInput(input)
  return {
    id,
    clientId,
    status: 'Draft',
    version: 1,
    input: normalized,
    createdAt: at,
    createdBy: by,
    updatedAt: at,
    history: [event('created', at, by, `Created draft journal entry${normalized.referenceNumber ? ` ${normalized.referenceNumber}` : ''}.`)],
  }
}

export function editDraftJournalRecord(record: DemoJournalRecord, input: DemoJournalEntryInput, by: string, at: string): DemoJournalRecord {
  const normalized = normalizeJournalInput(input)
  return {
    ...record,
    version: record.version + 1,
    input: normalized,
    updatedAt: at,
    history: [...record.history, event('edited', at, by, `Updated draft journal entry${normalized.referenceNumber ? ` ${normalized.referenceNumber}` : ''}.`)],
  }
}

export function postDraftJournalRecord(record: DemoJournalRecord, by: string, at: string): DemoJournalRecord {
  return {
    ...record,
    status: 'Posted',
    version: record.version + 1,
    updatedAt: at,
    postedAt: at,
    postedBy: by,
    history: [...record.history, event('posted', at, by, 'Posted journal entry to the demo books.')],
  }
}

export function reverseJournalRecord(record: DemoJournalRecord, reversalId: string, by: string, at: string, reason: string): { original: DemoJournalRecord; reversal: DemoJournalRecord } {
  const reversedInput: DemoJournalEntryInput = {
    ...record.input,
    description: `Reversal of ${record.input.description}`,
    referenceNumber: record.input.referenceNumber ? `${record.input.referenceNumber}-REV`.slice(0, 40) : '',
    explanation: reason.trim() || record.input.explanation,
    lines: record.input.lines.map((line) => ({
      accountId: line.accountId,
      debitCents: line.creditCents,
      creditCents: line.debitCents,
      memo: line.memo,
    })),
  }
  return {
    original: {
      ...record,
      status: 'Reversed',
      version: record.version + 1,
      updatedAt: at,
      reversalRecordId: reversalId,
      history: [...record.history, event('reversed', at, by, 'Marked journal entry as reversed.', reason)],
    },
    reversal: {
      id: reversalId,
      clientId: record.clientId,
      status: 'Posted',
      version: 1,
      input: normalizeJournalInput(reversedInput),
      createdAt: at,
      createdBy: by,
      updatedAt: at,
      postedAt: at,
      postedBy: by,
      reversesRecordId: record.id,
      history: [
        event('created', at, by, `Created reversal for ${record.input.referenceNumber || record.id}.`, reason),
        event('posted', at, by, 'Posted reversal journal entry to the demo books.', reason),
      ],
    },
  }
}

export function recordToJournalEntry(record: DemoJournalRecord): JournalEntry | null {
  if (record.status === 'Draft') return null
  return {
    id: record.id,
    date: record.input.date,
    memo: `${record.input.description}${record.input.referenceNumber ? ` (${record.input.referenceNumber})` : ''}`,
    lines: record.input.lines.map((line): JournalLine => ({
      accountId: line.accountId,
      debitCents: line.debitCents,
      creditCents: line.creditCents,
    })),
  }
}

export function postedJournalEntries(records: DemoJournalRecord[], clientId = DEMO_CLIENT_ID) {
  return records
    .filter((record) => record.clientId === clientId && record.status !== 'Draft')
    .map(recordToJournalEntry)
    .filter((record): record is JournalEntry => record !== null)
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id))
}

export function mergeDemoJournals(records: DemoJournalRecord[], base: DemoLedger = demoLedger, clientId = DEMO_CLIENT_ID): DemoLedger {
  const accounts = accountantAccounts(base.accounts)
  const entries = [...base.entries, ...postedJournalEntries(records, clientId)].sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id))
  return { ...base, accounts, entries }
}
