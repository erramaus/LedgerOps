import type { Bill, Invoice, Transaction } from './bookkeepingTypes'
import type { TaskKind, TaskPriority, WorkTask } from './workQueue'

export type FindingType = 'duplicate' | 'categorization' | 'missing-info' | 'unusual-amount' | 'inconsistency' | 'other'

export const findingTypes: FindingType[] = ['duplicate', 'categorization', 'missing-info', 'unusual-amount', 'inconsistency', 'other']

export const findingTypeLabel: Record<FindingType, string> = {
  duplicate: 'Possible duplicate',
  categorization: 'Categorization',
  'missing-info': 'Missing information',
  'unusual-amount': 'Unusual amount',
  inconsistency: 'Accounting inconsistency',
  other: 'Other review',
}

/**
 * Accounting quality-control findings. Reminders about overdue or partially paid invoices and bills, bills coming due,
 * recurring reminders, client questions and month-end tracking stay in the Inbox only.
 */
const FINDING_TYPES: Partial<Record<TaskKind, FindingType>> = {
  'possible-duplicate': 'duplicate',
  uncategorized: 'categorization',
  'rule-suggestion': 'categorization',
  'missing-payee': 'missing-info',
  'needs-receipt': 'missing-info',
  'large-transaction': 'unusual-amount',
  'negative-balance': 'inconsistency',
  'reconciliation-difference': 'inconsistency',
  'summary-reconciliation': 'inconsistency',
  'bill-needs-review': 'other',
  'summary-flagged': 'other',
}

export const isAccountingFinding = (task: WorkTask) => task.kind in FINDING_TYPES
export const findingTypeOf = (task: WorkTask): FindingType => FINDING_TYPES[task.kind] ?? 'other'

type Explanation = { detected: string; why: string; next: string }

const WHY: Partial<Record<TaskKind, string>> = {
  'possible-duplicate': 'Another transaction has the same payee and amount. That is a pattern, not proof: recurring charges can look identical.',
  uncategorized: 'The transaction has no category or account, so reports would put it in the wrong place or leave it out.',
  'rule-suggestion': 'The transaction has no category, and one of your automation rules suggests one. Nothing is applied until you confirm.',
  'missing-payee': 'A transaction without a payee cannot be matched to a vendor or checked against a receipt.',
  'needs-receipt': 'The transaction is marked as needing a receipt, so supporting documentation may be missing.',
  'large-transaction': 'This amount is well above what is typical for this client, judged from the client’s own transaction history (or against a conservative fixed limit when there is too little history). An unusual amount is not automatically wrong.',
  'negative-balance': 'A bank or credit card account shows a negative balance in the books. This can be expected, so it is a prompt to check.',
  'reconciliation-difference': 'The statement balance and the books differ, so something is missing, duplicated or mistimed.',
  'summary-reconciliation': 'The client summary shows reconciliation is not complete. Individual items are not in the demo data.',
  'bill-needs-review': 'The bill is marked as needing review before it is paid or recorded.',
  'summary-flagged': 'The client summary reports flagged items. Individual items are not in the demo data.',
}

/** Plain-language explanation of a finding. Wording stays "possible" unless the rule reports a fact. */
export function explainFinding(task: WorkTask): Explanation {
  return {
    detected: task.description,
    why: `${task.suspected ? 'Possible issue, not a confirmed error. ' : ''}${WHY[task.kind] ?? 'A review rule flagged this item.'}`,
    next: task.action,
  }
}

export type ReviewSource = 'demo' | 'quickbooks'
export type DecisionStatus = 'reviewing' | 'dismissed' | 'reopened'

export type ReviewDecision = {
  id: string
  source: ReviewSource
  clientId: string
  clientName: string
  /** The work-queue task id, which is stable for the same record and rule. */
  findingId: string
  findingType: FindingType
  issue: string
  description: string
  priority: TaskPriority
  status: DecisionStatus
  reason?: string
  actor?: string
  actorId?: string
  at: string
  /** Fingerprint of the source record when the decision was made. A different one means the record changed. */
  fingerprint: string
  /** Per-finding append-only sequence number assigned by the server. */
  version: number
}

export const decisionKey = (source: ReviewSource, clientId: string, findingId: string) => `${source}:${clientId}:${findingId}`

/** The most recent decision per finding. `decisions` are newest first. */
export function latestDecisions(decisions: ReviewDecision[]): Map<string, ReviewDecision> {
  const latest = new Map<string, ReviewDecision>()
  for (const decision of decisions) {
    const key = decisionKey(decision.source, decision.clientId, decision.findingId)
    if (!latest.has(key)) latest.set(key, decision)
  }
  return latest
}

function hash(text: string) {
  let value = 5381
  for (let index = 0; index < text.length; index += 1) value = ((value << 5) + value + text.charCodeAt(index)) | 0
  return (value >>> 0).toString(36)
}

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export type SourceRecords = { transactions: Transaction[]; invoices: Invoice[]; bills: Bill[] }

/** Identifies the underlying evidence for a finding. It changes when the source record changes, and for duplicates when a matching transaction is added or removed. */
export function sourceFingerprint(task: WorkTask, records: SourceRecords): string {
  const record = task.recordId ? [...records.transactions, ...records.invoices, ...records.bills].find((item) => item.id === task.recordId) : undefined
  if (!record) return hash(stable({ kind: task.kind, amount: task.amount, description: task.description, count: task.count }))
  const matches =
    task.kind === 'possible-duplicate'
      ? records.transactions.filter((other) => other.payee === (record as Transaction).payee && other.amount === (record as Transaction).amount).length
      : undefined
  return hash(stable({ kind: task.kind, record, matches }))
}

/** A dismissal only holds while the underlying record is unchanged. */
export const isDismissalCurrent = (decision: ReviewDecision | undefined, fingerprint: string) =>
  decision?.status === 'dismissed' && decision.fingerprint === fingerprint

export type ReviewStatus = 'Open' | 'Under review' | 'Dismissed' | 'Resolved'
export const reviewStatuses: ReviewStatus[] = ['Open', 'Under review', 'Dismissed', 'Resolved']

export type FindingRow = {
  key: string
  task: WorkTask
  status: ReviewStatus
  decision?: ReviewDecision
  /** True when a dismissed finding came back because its source record changed. */
  changedSinceDismissed: boolean
}

/** Builds the rows shown in Bookkeeping Review from the live findings and the stored decisions. */
export function buildFindingRows(input: {
  source: ReviewSource
  live: WorkTask[]
  dismissed: WorkTask[]
  decisions: ReviewDecision[]
  records: SourceRecords | ((task: WorkTask) => SourceRecords)
  /** The client whose findings are fully loaded; null when every client's findings are (All clients). */
  detailClientId: string | null
}): FindingRow[] {
  const latest = latestDecisions(input.decisions)
  const rows: FindingRow[] = []
  const seen = new Set<string>()
  const recordsFor = (task: WorkTask) => (typeof input.records === 'function' ? input.records(task) : input.records)
  for (const task of input.live) {
    const key = decisionKey(input.source, task.clientId, task.id)
    seen.add(key)
    const decision = latest.get(key)
    const changed = decision?.status === 'dismissed' && decision.fingerprint !== sourceFingerprint(task, recordsFor(task))
    rows.push({ key, task, status: decision?.status === 'reviewing' ? 'Under review' : 'Open', decision, changedSinceDismissed: Boolean(changed) })
  }
  for (const task of input.dismissed) {
    const key = decisionKey(input.source, task.clientId, task.id)
    seen.add(key)
    rows.push({ key, task, status: 'Dismissed', decision: latest.get(key), changedSinceDismissed: false })
  }
  // A finding that was under review and no longer triggers its check has been fixed at the source.
  for (const [key, decision] of latest) {
    if (seen.has(key) || decision.source !== input.source || (input.detailClientId !== null && decision.clientId !== input.detailClientId) || decision.status !== 'reviewing') continue
    rows.push({
      key,
      status: 'Resolved',
      decision,
      changedSinceDismissed: false,
      task: {
        id: decision.findingId, clientId: decision.clientId, client: decision.clientName, type: 'Transactions', kind: 'summary-flagged', issue: decision.issue,
        description: decision.description, priority: decision.priority, status: 'Open', suspected: false, count: 1, destination: 'Transactions', action: 'No action needed',
      },
    })
  }
  return rows
}

export type FindingFilters = {
  client: string
  type: FindingType | 'All'
  priority: TaskPriority | 'All'
  status: ReviewStatus | 'Active' | 'All'
  query: string
}

/** Resolved rows have no live task, so their kind is recovered from the stored decision. */
export const rowType = (row: FindingRow): FindingType => (row.status === 'Resolved' && row.decision ? row.decision.findingType : findingTypeOf(row.task))

export function filterFindingRows(rows: FindingRow[], filters: FindingFilters): FindingRow[] {
  const words = filters.query.toLowerCase().split(/\s+/).filter(Boolean)
  return rows.filter((row) => {
    const { task } = row
    if (filters.client !== 'All' && task.clientId !== filters.client) return false
    if (filters.type !== 'All' && rowType(row) !== filters.type) return false
    if (filters.priority !== 'All' && task.priority !== filters.priority) return false
    if (filters.status === 'Active' ? row.status !== 'Open' && row.status !== 'Under review' : filters.status !== 'All' && row.status !== filters.status) return false
    if (words.length === 0) return true
    const amount = task.amount === undefined ? '' : `${task.amount} ${task.amount.toFixed(2)} ${task.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    const haystack = [task.client, task.issue, task.description, task.recordId ?? '', task.id, amount, findingTypeLabel[rowType(row)]].join(' ').toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

export type FindingSummary = { total: number; duplicates: number; categorization: number; missingInfo: number }

const sum = (tasks: WorkTask[]) => tasks.reduce((total, task) => total + task.count, 0)

/** Counts come only from the findings passed in; the caller passes the ones that are still active. */
export function summarizeFindings(tasks: WorkTask[]): FindingSummary {
  const of = (type: FindingType) => sum(tasks.filter((task) => findingTypeOf(task) === type))
  return { total: sum(tasks), duplicates: of('duplicate'), categorization: of('categorization'), missingInfo: of('missing-info') }
}

const KEY = 'ledgerops-review-decisions-v1'
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
const local = (): StorageLike | null => (typeof window === 'undefined' ? null : window.localStorage)

/** Reads the old browser-only value only when a user explicitly requests an export. */
export function readLegacyReviewDecisionExport(storage: StorageLike | null = local()): string | null {
  return storage?.getItem(KEY) ?? null
}
