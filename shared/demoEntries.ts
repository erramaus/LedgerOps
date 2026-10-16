// Manually entered demo transactions (Demo Data only). Each one is a small record with its whole revision history; the
// double-entry journal entries are derived from it. A correction never deletes anything: it adds a reversing entry
// (dated like the original, so the original period is corrected) and, for an edit, a replacement entry.
import type { JournalEntry, LedgerAccountDef } from './accounting.js'
import { DEMO_CLIENT_ID, DEMO_PERIODS, DEMO_RECONCILIATION_ACCOUNTS, demoLedger, demoRegister, type RegisterTxn } from './demoBooks.js'
import { getAdditionalDemoCompany } from './demoCompanyBooks.js'
import { periodEnd, periodStart, type Period } from './period.js'
import { findDuplicateTransactions, formatCents, isValidIsoDate, type Direction, type ReconTxn } from './reconciliation.js'

export type EntryType = 'deposit' | 'withdrawal' | 'charge' | 'payment_or_credit'
export type EntryAccountKind = 'bank' | 'credit_card'

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = { deposit: 'Deposit', withdrawal: 'Withdrawal or check', charge: 'Charge', payment_or_credit: 'Payment or credit' }
export const ENTRY_TYPES_FOR: Record<EntryAccountKind, EntryType[]> = { bank: ['withdrawal', 'deposit'], credit_card: ['charge', 'payment_or_credit'] }
/** The first and last day the demo books cover. */
export const ENTRY_WINDOW = { start: '2026-05-01', end: '2026-08-31' }

export type DemoEntryInput = { accountId: string; type: EntryType; date: string; payee: string; amountCents: number; categoryId: string; memo: string }
export type EntryRevision = DemoEntryInput & { n: number; entryId: string; at: string; by: string }
export type EntryEvent = { at: string; by: string; action: 'created' | 'edited' | 'reversed'; summary: string; reason?: string }
export type DemoEntryRecord = {
  id: string
  clientId: string
  status: 'active' | 'reversed'
  version: number
  revisions: EntryRevision[]
  createdAt: string
  createdBy: string
  updatedAt: string
  history: EntryEvent[]
}

const reconAccountsFor = (clientId: string) => clientId === DEMO_CLIENT_ID ? DEMO_RECONCILIATION_ACCOUNTS : getAdditionalDemoCompany(clientId)?.reconciliationAccounts ?? []
const reconAccount = (accountId: string, clientId = DEMO_CLIENT_ID) => reconAccountsFor(clientId).find((account) => account.id === accountId)
const chartFor = (clientId: string, chart: LedgerAccountDef[] = demoLedger.accounts) => clientId === DEMO_CLIENT_ID ? chart : getAdditionalDemoCompany(clientId)?.ledger.accounts ?? chart
const periodsFor = (clientId: string) => clientId === DEMO_CLIENT_ID ? DEMO_PERIODS : getAdditionalDemoCompany(clientId)?.periods ?? DEMO_PERIODS
export const entryAccounts = (clientId = DEMO_CLIENT_ID) => reconAccountsFor(clientId).map((account) => ({ id: account.id, name: account.name, kind: account.kind as EntryAccountKind }))
export const directionOf = (type: EntryType): Direction => (type === 'deposit' || type === 'charge' ? 'increase' : 'decrease')

/** The other side of the entry: the accounts a bookkeeper may legitimately choose for this kind of transaction. */
export function categoryOptions(type: EntryType, chart: LedgerAccountDef[] = demoLedger.accounts): LedgerAccountDef[] {
  const byClass = (...classes: string[]) => chart.filter((account) => classes.includes(account.klass))
  const byId = (...ids: string[]) => chart.filter((account) => ids.includes(account.id))
  switch (type) {
    case 'deposit': return [...byClass('income', 'other_income'), ...byId('ar', 'equity')]
    case 'withdrawal': return [...byClass('cogs', 'expense', 'other_expense'), ...byId('ap', 'equipment')]
    case 'charge': return [...byClass('cogs', 'expense', 'other_expense'), ...byId('equipment')]
    default: return [...byId('checking'), ...byClass('cogs', 'expense')]
  }
}

export type EntryErrors = Partial<Record<keyof DemoEntryInput, string>>

/** Field-by-field validation. Nothing is defaulted: every required field must be chosen by the person. */
export function validateEntryInput(input: Partial<DemoEntryInput>, chart: LedgerAccountDef[] = demoLedger.accounts, clientId = DEMO_CLIENT_ID): EntryErrors {
  const errors: EntryErrors = {}
  const account = input.accountId ? reconAccount(input.accountId, clientId) : undefined
  if (!account) errors.accountId = 'Choose the bank or card account.'
  if (!input.type) errors.type = 'Choose the transaction type.'
  else if (account && !ENTRY_TYPES_FOR[account.kind].includes(input.type)) errors.type = `A ${account.kind === 'bank' ? 'bank account' : 'credit card'} cannot have a ${ENTRY_TYPE_LABELS[input.type].toLowerCase()}.`
  if (!input.date || !isValidIsoDate(input.date)) errors.date = 'Enter a valid date.'
  else {
    const periods = periodsFor(clientId)
    const start = periods.length ? periodStart(periods[0]) : ENTRY_WINDOW.start
    const end = periods.length ? periodEnd(periods[periods.length - 1]) : ENTRY_WINDOW.end
    if (input.date < start || input.date > end) errors.date = clientId === DEMO_CLIENT_ID ? 'The demo books cover May 1 to August 31, 2026.' : `The demo books cover ${start} to ${end}.`
  }
  const payee = (input.payee ?? '').trim()
  if (!payee) errors.payee = 'Enter who was paid or who paid.'
  else if (payee.length > 120) errors.payee = 'Keep the payee under 120 characters.'
  if (!Number.isSafeInteger(input.amountCents) || (input.amountCents ?? 0) <= 0) errors.amountCents = 'Enter an amount greater than zero.'
  else if ((input.amountCents ?? 0) > 100_000_000) errors.amountCents = 'That amount is too large for the demo books.'
  if (!input.categoryId) errors.categoryId = 'Choose the category or account.'
  else if (input.type && !categoryOptions(input.type, chartFor(clientId, chart)).some((option) => option.id === input.categoryId)) errors.categoryId = 'That category does not fit this type of transaction.'
  if ((input.memo ?? '').length > 300) errors.memo = 'Keep the memo under 300 characters.'
  return errors
}

const describe = (input: DemoEntryInput) => `${ENTRY_TYPE_LABELS[input.type]} of ${formatCents(input.amountCents)} with ${input.payee.trim()} on ${input.date}`
const memoOf = (input: DemoEntryInput) => `${input.payee.trim()}${input.memo.trim() ? ` - ${input.memo.trim()}` : ''}`

/** The balanced journal entry for one revision. A bank deposit and a card payment debit the account; the others credit it. */
export function journalFor(input: DemoEntryInput, entryId: string, clientId = DEMO_CLIENT_ID): JournalEntry {
  const account = reconAccount(input.accountId, clientId)!
  const amount = input.amountCents
  const debit = (accountId: string) => ({ accountId, debitCents: amount, creditCents: 0 })
  const credit = (accountId: string) => ({ accountId, debitCents: 0, creditCents: amount })
  // Debit the account for a bank deposit and for a card payment or credit (the balance owed falls); credit it otherwise.
  const lines = input.type === 'deposit' || input.type === 'payment_or_credit' ? [debit(account.ledgerId), credit(input.categoryId)] : [debit(input.categoryId), credit(account.ledgerId)]
  return { id: entryId, date: input.date, memo: `${memoOf(input)} (entered manually)`, lines }
}

export const reversalOf = (entry: JournalEntry, entryId: string): JournalEntry => ({
  id: entryId, date: entry.date, memo: `Reversal of: ${entry.memo}`,
  lines: entry.lines.map((line) => ({ accountId: line.accountId, debitCents: line.creditCents, creditCents: line.debitCents })),
})

export const activeRevision = (record: DemoEntryRecord) => (record.status === 'active' ? record.revisions[record.revisions.length - 1] : undefined)

/** Every journal entry this record has ever caused, in order, including reversals of what was corrected. */
export function toJournalEntries(record: DemoEntryRecord): JournalEntry[] {
  const active = activeRevision(record)
  const entries: JournalEntry[] = []
  for (const revision of record.revisions) {
    const original = journalFor(revision, revision.entryId, record.clientId)
    entries.push(original)
    if (revision !== active) entries.push(reversalOf(original, `${revision.entryId}-rev`))
  }
  return entries
}

/** The base demo books plus every manually entered transaction. */
export function mergedLedger(records: DemoEntryRecord[], base = demoLedger, clientId = DEMO_CLIENT_ID) {
  const added = records.filter((record) => record.clientId === clientId).flatMap(toJournalEntries)
  return { ...base, accounts: base.accounts, entries: [...base.entries, ...added].sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id)) }
}

/** Register rows (for reconciliation) caused by active manual entries. Corrected and reversed entries net to zero and are left out. */
export function additionRegister(records: DemoEntryRecord[], ledgerId: 'checking' | 'card', clientId = DEMO_CLIENT_ID): RegisterTxn[] {
  const rows: RegisterTxn[] = []
  for (const record of records.filter((item) => item.clientId === clientId)) {
    const revision = activeRevision(record)
    if (!revision) continue
    const entry = journalFor(revision, revision.entryId, clientId)
    const line = entry.lines.find((candidate) => candidate.accountId === ledgerId)
    if (!line) continue
    const amountCents = line.debitCents || line.creditCents
    const direction: Direction = ledgerId === 'checking' ? (line.debitCents > 0 ? 'increase' : 'decrease') : line.creditCents > 0 ? 'increase' : 'decrease'
    rows.push({ id: revision.entryId, date: entry.date, payee: revision.payee.trim(), memo: revision.memo.trim(), amountCents, direction })
  }
  return rows
}

/** Everything already in one account's register: the base demo books plus active manual entries. */
export function accountRegister(records: DemoEntryRecord[], ledgerId: 'checking' | 'card', clientId = DEMO_CLIENT_ID): RegisterTxn[] {
  const company = getAdditionalDemoCompany(clientId)
  const base = clientId === DEMO_CLIENT_ID
    ? DEMO_PERIODS.flatMap((period) => demoRegister(ledgerId, period))
    : company ? company.periods.flatMap((period) => registerForLedger(company.ledger.entries, ledgerId, period)) : []
  return [...base, ...additionRegister(records, ledgerId, clientId)]
}

function registerForLedger(entries: JournalEntry[], ledgerId: 'checking' | 'card', period: Period): RegisterTxn[] {
  const start = periodStart(period), end = periodEnd(period)
  return entries.filter((entry) => entry.date >= start && entry.date <= end).flatMap((entry) => {
    const line = entry.lines.find((item) => item.accountId === ledgerId)
    if (!line) return []
    const direction: Direction = ledgerId === 'checking' ? line.debitCents > 0 ? 'increase' : 'decrease' : line.creditCents > 0 ? 'increase' : 'decrease'
    return [{ id: entry.id, date: entry.date, payee: entry.memo, memo: '', amountCents: line.debitCents || line.creditCents, direction }]
  })
}

/**
 * Existing register rows that look like the same transaction: same payee, direction and amount within a week.
 * `excludeEntryId` lets an edit ignore the entry it is replacing.
 */
export function findPossibleDuplicates(input: DemoEntryInput, records: DemoEntryRecord[], excludeEntryId?: string, clientId = DEMO_CLIENT_ID): RegisterTxn[] {
  const account = reconAccount(input.accountId, clientId)
  if (!account) return []
  const existing = accountRegister(records, account.ledgerId as 'checking' | 'card', clientId).filter((row) => row.id !== excludeEntryId)
  const candidate: ReconTxn = { id: '__candidate__', date: input.date, payee: input.payee.trim(), memo: input.memo.trim(), amountCents: input.amountCents, direction: directionOf(input.type) }
  const clusters = findDuplicateTransactions([...existing, candidate])
  return clusters.filter((cluster) => cluster.some((row) => row.id === '__candidate__')).flatMap((cluster) => cluster.filter((row) => row.id !== '__candidate__')) as RegisterTxn[]
}

// --- Changes (pure; callers supply the id, person and time) ---------------------------------------------------

export function createRecord(id: string, clientId: string, input: DemoEntryInput, by: string, at: string): DemoEntryRecord {
  return {
    id, clientId, status: 'active', version: 1, createdAt: at, createdBy: by, updatedAt: at,
    revisions: [{ ...input, payee: input.payee.trim(), memo: input.memo.trim(), n: 1, entryId: id, at, by }],
    history: [{ at, by, action: 'created', summary: `Entered ${describe(input)}.` }],
  }
}

/** Replaces the active revision with a corrected one. The old entry stays in the books, reversed. */
export function editRecord(record: DemoEntryRecord, input: DemoEntryInput, by: string, at: string, reason: string): DemoEntryRecord {
  const previous = activeRevision(record)!
  const n = previous.n + 1
  return {
    ...record, version: record.version + 1, updatedAt: at,
    revisions: [...record.revisions, { ...input, payee: input.payee.trim(), memo: input.memo.trim(), n, entryId: `${record.id}~${n}`, at, by }],
    history: [...record.history, { at, by, action: 'edited', reason, summary: `Changed from ${describe(previous)} to ${describe(input)}. The earlier entry was reversed, not deleted.` }],
  }
}

export function reverseRecord(record: DemoEntryRecord, by: string, at: string, reason: string): DemoEntryRecord {
  const previous = activeRevision(record)!
  return {
    ...record, status: 'reversed', version: record.version + 1, updatedAt: at,
    history: [...record.history, { at, by, action: 'reversed', reason, summary: `Reversed ${describe(previous)}. The original entry and its reversal both stay in the general ledger.` }],
  }
}
