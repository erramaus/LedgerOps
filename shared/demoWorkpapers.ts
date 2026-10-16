import type { LedgerAccountDef } from './accounting.js'
import { DEMO_CLIENT_ID, DEMO_PERIODS, demoLedger } from './demoBooks.js'
import { getAdditionalDemoCompany } from './demoCompanyBooks.js'
import { isValidIsoDate, type Period } from './period.js'
import { accountantAccounts } from './demoJournalEntries.js'

export type WorkpaperStatus = 'Open' | 'Prepared' | 'Reviewed'

export type DemoWorkpaperInput = {
  title: string
  period: string
  accountId: string
  note: string
  supportingDocumentRefs: string[]
  reconciliationLinks: string[]
  adjustingEntryIds: string[]
  reviewStatus: WorkpaperStatus
  preparedBy: string
  reviewedBy?: string
  workDate: string
}

export type WorkpaperHistoryEvent = {
  at: string
  by: string
  action: 'created' | 'updated' | 'reviewed'
  summary: string
}

export type DemoWorkpaperRecord = {
  id: string
  clientId: string
  version: number
  input: DemoWorkpaperInput
  createdAt: string
  createdBy: string
  updatedAt: string
  history: WorkpaperHistoryEvent[]
}

const periodsFor = (clientId: string) => clientId === DEMO_CLIENT_ID ? DEMO_PERIODS : getAdditionalDemoCompany(clientId)?.periods ?? DEMO_PERIODS
const chartFor = (clientId: string) => accountantAccounts(clientId === DEMO_CLIENT_ID ? demoLedger.accounts : getAdditionalDemoCompany(clientId)?.ledger.accounts ?? demoLedger.accounts)

export const workpaperAccounts = (clientId = DEMO_CLIENT_ID, accounts = chartFor(clientId)) => accounts

const normalizeList = (items: string[]) => items.map((item) => item.trim()).filter(Boolean)

export function normalizeWorkpaperInput(input: DemoWorkpaperInput): DemoWorkpaperInput {
  return {
    title: input.title.trim(),
    period: input.period.trim(),
    accountId: input.accountId.trim(),
    note: input.note.trim(),
    supportingDocumentRefs: normalizeList(input.supportingDocumentRefs),
    reconciliationLinks: normalizeList(input.reconciliationLinks),
    adjustingEntryIds: normalizeList(input.adjustingEntryIds),
    reviewStatus: input.reviewStatus,
    preparedBy: input.preparedBy.trim(),
    ...(input.reviewedBy?.trim() ? { reviewedBy: input.reviewedBy.trim() } : {}),
    workDate: input.workDate.trim(),
  }
}

export type WorkpaperValidationErrors = Record<string, string>

export function validateWorkpaperInput(input: DemoWorkpaperInput, accounts = workpaperAccounts(), clientId = DEMO_CLIENT_ID): WorkpaperValidationErrors {
  const normalized = normalizeWorkpaperInput(input)
  const errors: WorkpaperValidationErrors = {}
  const known = new Set(accounts.map((account) => account.id))
  const periods = new Set(periodsFor(clientId).map((period) => `${period.year}-${String(period.month).padStart(2, '0')}`))
  if (!normalized.title) errors.title = 'Enter a workpaper title.'
  else if (normalized.title.length > 120) errors.title = 'Keep the title under 120 characters.'
  if (!periods.has(normalized.period)) errors.period = 'Choose a valid accounting period.'
  if (!normalized.accountId) errors.accountId = 'Choose an account.'
  else if (!known.has(normalized.accountId)) errors.accountId = 'Choose a valid account.'
  if (!normalized.note) errors.note = 'Enter account-review notes.'
  else if (normalized.note.length > 1200) errors.note = 'Keep the notes under 1200 characters.'
  if (!normalized.preparedBy) errors.preparedBy = 'Enter who prepared the workpaper.'
  if (normalized.reviewStatus === 'Reviewed' && !normalized.reviewedBy) errors.reviewedBy = 'Enter who reviewed the workpaper.'
  if (!isValidIsoDate(normalized.workDate)) errors.workDate = 'Enter a valid workpaper date.'
  return errors
}

const historyEvent = (action: WorkpaperHistoryEvent['action'], at: string, by: string, summary: string): WorkpaperHistoryEvent => ({ action, at, by, summary })

export function createWorkpaperRecord(id: string, clientId: string, input: DemoWorkpaperInput, by: string, at: string): DemoWorkpaperRecord {
  const normalized = normalizeWorkpaperInput(input)
  return {
    id,
    clientId,
    version: 1,
    input: normalized,
    createdAt: at,
    createdBy: by,
    updatedAt: at,
    history: [historyEvent('created', at, by, `Created workpaper ${normalized.title}.`)],
  }
}

export function updateWorkpaperRecord(record: DemoWorkpaperRecord, input: DemoWorkpaperInput, by: string, at: string): DemoWorkpaperRecord {
  const normalized = normalizeWorkpaperInput(input)
  const action = normalized.reviewStatus === 'Reviewed' ? 'reviewed' : 'updated'
  const summary = normalized.reviewStatus === 'Reviewed' ? `Reviewed workpaper ${normalized.title}.` : `Updated workpaper ${normalized.title}.`
  return {
    ...record,
    version: record.version + 1,
    input: normalized,
    updatedAt: at,
    history: [...record.history, historyEvent(action, at, by, summary)],
  }
}

export const periodLabel = (period: string) => {
  const [year, month] = period.split('-').map(Number)
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return year && month ? `${names[month - 1]} ${year}` : period
}

export type WorkpaperLedger = { accounts: LedgerAccountDef[]; clientId?: string; periods?: Period[] }
