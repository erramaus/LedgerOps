import { apiFetch } from './apiClient'
import { DEMO_CLIENT_ID, demoLedger } from '../../shared/demoBooks'
import { getAdditionalDemoCompany } from '../../shared/demoCompanyBooks'
import { ENTRY_TYPE_LABELS, activeRevision, entryAccounts, type DemoEntryInput, type DemoEntryRecord } from '../../shared/demoEntries'
import { formatCents } from '../../shared/reconciliation'
import type { LedgerTransaction } from './bookkeepingTypes'

export class DemoEntryApiError extends Error {
  readonly code?: string
  readonly matches?: { date: string; payee: string; amountCents: number }[]
  readonly fields?: Record<string, string>
  constructor(message: string, extra: { code?: string; matches?: DemoEntryApiError['matches']; fields?: Record<string, string> } = {}) {
    super(message)
    this.name = 'DemoEntryApiError'
    Object.assign(this, extra)
  }
}

type Body = { error?: string; code?: string; record?: DemoEntryRecord; records?: DemoEntryRecord[]; durable?: boolean; matches?: DemoEntryApiError['matches']; fields?: Record<string, string> }
async function call(path: string, init?: RequestInit): Promise<Body> {
  const response = await apiFetch(path, init)
  const body = (await response.json().catch(() => ({}))) as Body
  if (response.ok) return body
  throw new DemoEntryApiError(body.error || 'The transaction could not be saved. Nothing was changed.', { code: body.code, matches: body.matches, fields: body.fields })
}
const post = (payload: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const displayDate = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(8, 10)}, ${iso.slice(0, 4)}`

/**
 * The Transactions rows for manually entered demo transactions. They are read-only there because changing a category without
 * changing the ledger would make the list disagree with the reports; Edit and Reverse in Reconcile keep both in step.
 */
export function entryTransactions(records: DemoEntryRecord[], clientId = records[0]?.clientId ?? DEMO_CLIENT_ID): LedgerTransaction[] {
  const accounts = entryAccounts(clientId)
  const chart = getAdditionalDemoCompany(clientId)?.ledger.accounts ?? demoLedger.accounts
  return records.flatMap((record) => {
    const revision = activeRevision(record)
    if (!revision) return []
    const category = chart.find((account) => account.id === revision.categoryId)?.name ?? revision.categoryId
    return [{
      id: revision.entryId,
      date: displayDate(revision.date),
      payee: revision.payee.trim(),
      description: `${ENTRY_TYPE_LABELS[revision.type]} entered manually${revision.memo.trim() ? ` - ${revision.memo.trim()}` : ''}`,
      amount: formatCents(revision.amountCents),
      category,
      status: 'Categorized' as const,
      account: accounts.find((account) => account.id === revision.accountId)?.name,
      clientId: record.clientId,
      source: 'demo' as const,
      readOnlyReason: 'Entered manually in LedgerOps. Use Edit or Reverse in Reconcile so the ledger and reports stay correct.',
    }]
  })
}

/** Manually entered transactions exist only in LedgerOps' demo books. Nothing here reads or writes QuickBooks. */
export const demoEntryService = {
  list: async (clientId: string) => (await call(`/api/demo-entries?clientId=${encodeURIComponent(clientId)}`)).records ?? [],
  create: async (clientId: string, input: DemoEntryInput, confirmedNotDuplicate: boolean) =>
    (await call('/api/demo-entries', post({ clientId, input, confirmedNotDuplicate }))).record!,
  edit: async (id: string, expectedVersion: number, input: DemoEntryInput, reason: string, confirmedNotDuplicate: boolean) =>
    (await call(`/api/demo-entries/${encodeURIComponent(id)}/edit`, post({ expectedVersion, input, reason, confirmedNotDuplicate }))).record!,
  reverse: async (id: string, expectedVersion: number, reason: string) =>
    (await call(`/api/demo-entries/${encodeURIComponent(id)}/reverse`, post({ expectedVersion, reason }))).record!,
}
