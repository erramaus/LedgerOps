import type {
  Bill,
  Client,
  ClientRequest,
  Invoice,
  LedgerAccount,
  MonthEndItem,
  ReconciliationAccount,
  Transaction,
} from './bookkeepingTypes'
import { openRequest, requestTaskPriority, requestTaskStatus, summarizeRequest } from './clientPortal'
import { getLines, needsCategory, uncategorizedLineCount } from './transactionReview'

export type DataSource = 'demo' | 'quickbooks'
export type TaskPriority = 'High' | 'Medium' | 'Low'
export type TaskStatus = 'Open' | 'Waiting on client' | 'Ready to review'
export type TaskType = 'Transactions' | 'Receivables' | 'Payables' | 'Reconciliation' | 'Client Requests' | 'Month End'
/** Matches the app's view names so a task can open its workflow directly. */
export type TaskDestination = 'Transactions' | 'Receivables' | 'Payables' | 'Reconcile' | 'Client Requests' | 'Month End'

export type TaskKind =
  | 'uncategorized'
  | 'rule-suggestion'
  | 'missing-recurring'
  | 'missing-payee'
  | 'large-transaction'
  | 'needs-receipt'
  | 'possible-duplicate'
  | 'overdue-invoice'
  | 'partially-paid-invoice'
  | 'large-unpaid-invoice'
  | 'overdue-bill'
  | 'partially-paid-bill'
  | 'bill-due-soon'
  | 'bill-needs-review'
  | 'negative-balance'
  | 'reconciliation-difference'
  | 'client-question'
  | 'month-end-open'
  | 'summary-flagged'
  | 'summary-reconciliation'
  | 'summary-month-end'

export type WorkTask = {
  id: string
  clientId: string
  client: string
  type: TaskType
  kind: TaskKind
  issue: string
  description: string
  priority: TaskPriority
  /** ISO yyyy-mm-dd, only when the source record has one. */
  dueDate?: string
  status: TaskStatus
  /** True when the rule only suggests a possible problem rather than reporting a fact. */
  suspected: boolean
  amount?: number
  /** How many underlying items the task stands for; summary-only clients report a count, not records. */
  count: number
  destination: TaskDestination
  action: string
  requestId?: string
  automationId?: string
  /** The single transaction, invoice or bill this task is about, when it is about exactly one. */
  recordId?: string
}

export type ClientRef = { id: string; name: string }

/** Everything known about one client's books from a single data source. */
export type ClientRecords = {
  client: ClientRef
  transactions: Transaction[]
  invoices: Invoice[]
  bills: Bill[]
  accounts: LedgerAccount[]
  reconciliations: ReconciliationAccount[]
  requests: ClientRequest[]
  monthEnd: MonthEndItem[]
}

export const QUICKBOOKS_CLIENT_ID = 'quickbooks-sandbox'
export const taskPriorities: TaskPriority[] = ['High', 'Medium', 'Low']
export const taskStatuses: TaskStatus[] = ['Open', 'Waiting on client', 'Ready to review']
export const taskTypes: TaskType[] = ['Transactions', 'Receivables', 'Payables', 'Reconciliation', 'Client Requests', 'Month End']

const priorityRank: Record<TaskPriority, number> = { High: 0, Medium: 1, Low: 2 }

function parseAmount(value: string) {
  const amount = Number(value.replace(/[$,]/g, ''))
  return Number.isFinite(amount) ? amount : 0
}

export function toIsoDate(value?: string): string | undefined {
  if (!value) return undefined
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return undefined
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
}

type NewTask = Pick<WorkTask, 'id' | 'type' | 'kind' | 'issue' | 'description' | 'priority' | 'destination' | 'action'> & Partial<WorkTask>

function taskFactory(client: ClientRef, into: WorkTask[]) {
  return (task: NewTask) =>
    into.push({ clientId: client.id, client: client.name, status: 'Open', suspected: false, count: 1, ...task, id: `${client.id}/${task.id}` })
}

/** Rule-based checks over one client's records. Suspected problems are marked `suspected`. */
export function buildReviewTasks(records: ClientRecords): WorkTask[] {
  const tasks: WorkTask[] = []
  const add = taskFactory(records.client, tasks)

  records.transactions.forEach((transaction, index) => {
    const amount = parseAmount(transaction.amount)
    const payee = transaction.payee?.trim()
    const knownPayee = Boolean(payee) && payee !== 'Unknown'
    const label = knownPayee ? payee : 'A transaction'
    if (needsCategory(transaction)) {
      const missing = uncategorizedLineCount(transaction)
      const total = getLines(transaction).length
      add({ id: `${transaction.id}-category`, type: 'Transactions', kind: 'uncategorized', issue: 'Uncategorized transaction', description: total > 1 ? `${label} has ${missing} of ${total} lines with no category.` : `${label} has no category or account.`, amount, priority: 'High', destination: 'Transactions', action: 'Categorize transaction' })
    }
    if (!knownPayee) {
      add({ id: `${transaction.id}-payee`, type: 'Transactions', kind: 'missing-payee', issue: 'Missing payee', description: 'This transaction needs a payee before it can be reviewed.', amount, priority: 'High', destination: 'Transactions', action: 'Add the payee' })
    }
    if (amount >= 1000) {
      add({ id: `${transaction.id}-large`, type: 'Transactions', kind: 'large-transaction', issue: 'Large transaction', description: `${label} is a large amount and may be worth a second look.`, amount, priority: 'Medium', suspected: true, destination: 'Transactions', action: 'Review transaction' })
    }
    if (transaction.status === 'Needs Receipt') {
      add({ id: `${transaction.id}-receipt`, type: 'Transactions', kind: 'needs-receipt', issue: 'May need receipt', description: `${label} may need supporting documentation.`, amount, priority: 'Medium', suspected: true, destination: 'Transactions', action: 'Request receipt' })
    }
    const repeated = knownPayee && records.transactions.some((other, otherIndex) => otherIndex < index && other.payee === transaction.payee && other.amount === transaction.amount)
    if (repeated) {
      add({ id: `${transaction.id}-duplicate`, type: 'Transactions', kind: 'possible-duplicate', issue: 'Possible duplicate', description: `${label} has another transaction for the same amount. Compare them to see if it is a duplicate.`, amount, priority: 'Low', suspected: true, destination: 'Transactions', action: 'Compare transactions' })
    }
  })

  records.invoices.forEach((invoice) => {
    const amount = invoice.amount - invoice.amountPaid
    const dueDate = toIsoDate(invoice.dueDate)
    if (invoice.status === 'Overdue') {
      add({ id: `${invoice.id}-overdue`, type: 'Receivables', kind: 'overdue-invoice', issue: 'Overdue invoice', description: `${invoice.customer} invoice ${invoice.number} is overdue.`, amount, dueDate, priority: amount >= 1000 ? 'High' : 'Medium', destination: 'Receivables', action: 'Review invoice' })
    } else if (invoice.status === 'Partially Paid' && amount > 0) {
      add({ id: `${invoice.id}-partial`, type: 'Receivables', kind: 'partially-paid-invoice', issue: 'Invoice partially paid', description: `${invoice.customer} still has a balance on partially paid invoice ${invoice.number}.`, amount, dueDate, priority: amount >= 1000 ? 'High' : 'Medium', destination: 'Receivables', action: 'Review invoice' })
    } else if (amount >= 1000 && invoice.status !== 'Paid') {
      add({ id: `${invoice.id}-large`, type: 'Receivables', kind: 'large-unpaid-invoice', issue: 'Large unpaid invoice', description: `${invoice.customer} still owes a large balance on ${invoice.number}.`, amount, dueDate, priority: 'Medium', destination: 'Receivables', action: 'Review invoice' })
    }
  })

  records.bills.forEach((bill) => {
    const amount = bill.amount - bill.amountPaid
    const dueDate = toIsoDate(bill.dueDate)
    if (bill.status === 'Overdue') {
      add({ id: `${bill.id}-overdue`, type: 'Payables', kind: 'overdue-bill', issue: 'Overdue bill', description: `${bill.vendor} bill ${bill.number} is overdue.`, amount, dueDate, priority: 'High', destination: 'Payables', action: 'Review bill' })
    } else if (bill.status === 'Partially Paid' && amount > 0) {
      add({ id: `${bill.id}-partial`, type: 'Payables', kind: 'partially-paid-bill', issue: 'Bill partially paid', description: `${bill.vendor} still has a balance on partially paid bill ${bill.number}.`, amount, dueDate, priority: 'Medium', destination: 'Payables', action: 'Review bill' })
    } else if (bill.status === 'Due Soon') {
      add({ id: `${bill.id}-soon`, type: 'Payables', kind: 'bill-due-soon', issue: 'Bill due soon', description: `${bill.vendor} bill ${bill.number} is due soon.`, amount, dueDate, priority: 'Medium', destination: 'Payables', action: 'Review bill' })
    } else if (bill.status === 'Needs Review') {
      add({ id: `${bill.id}-review`, type: 'Payables', kind: 'bill-needs-review', issue: 'Bill needs review', description: `${bill.vendor} bill ${bill.number} needs review.`, amount, dueDate, priority: 'High', destination: 'Payables', action: 'Review bill' })
    }
  })

  records.accounts
    .filter((account) => account.active && (account.accountType === 'Bank' || account.accountType === 'Credit Card') && account.currentBalance < 0)
    .forEach((account) => {
      add({ id: `${account.quickBooksId || account.name}-balance`, type: 'Reconciliation', kind: 'negative-balance', issue: 'Account balance needs review', description: `${account.name} shows a negative QuickBooks balance. This may be expected, so it is worth a look.`, amount: Math.abs(account.currentBalance), priority: 'Medium', suspected: true, destination: 'Reconcile', action: 'Review account' })
    })

  records.reconciliations
    .filter((account) => Math.abs(account.statementBalance - account.quickBooksBalance) >= 0.005)
    .forEach((account) => {
      add({ id: `${account.id}-difference`, type: 'Reconciliation', kind: 'reconciliation-difference', issue: 'Reconciliation difference', description: `${account.name}: the books and the statement differ.`, amount: Math.abs(account.statementBalance - account.quickBooksBalance), priority: 'High', destination: 'Reconcile', action: 'Find the difference' })
    })

  // Task ids are `${client}/${record id}-${rule}`, so the record a task is about can be read back from them.
  const recordIds = new Set([...records.transactions, ...records.invoices, ...records.bills].map((record) => record.id))
  for (const task of tasks) {
    const local = task.id.slice(records.client.id.length + 1)
    const match = [...recordIds].find((recordId) => local.startsWith(`${recordId}-`))
    if (match && ['Transactions', 'Receivables', 'Payables'].includes(task.destination)) task.recordId = match
  }

  return tasks
}

/** Clients known only by their summary figures (no individual records) get honest summary-level tasks. */
export function buildSummaryTasks(clients: Client[]): WorkTask[] {
  const tasks: WorkTask[] = []
  clients.forEach((client) => {
    const add = taskFactory({ id: client.id, name: client.name }, tasks)
    if (client.attention > 0) {
      add({ id: 'summary-flagged', type: 'Transactions', kind: 'summary-flagged', issue: 'Items flagged', description: `${client.attention} items flagged for review. Summary only: the individual items are not in the demo data.`, count: client.attention, priority: client.attention >= 5 ? 'High' : 'Medium', destination: 'Transactions', action: 'Open client' })
    }
    if (!['Complete', 'Ready to complete'].includes(client.reconciliation)) {
      const waiting = /waiting/i.test(client.reconciliation)
      add({ id: 'summary-reconciliation', type: 'Reconciliation', kind: 'summary-reconciliation', issue: 'Reconciliation open', description: `Reconciliation status: ${client.reconciliation}.`, priority: waiting ? 'Medium' : 'High', status: waiting ? 'Waiting on client' : 'Open', destination: 'Reconcile', action: 'Open client' })
    }
    if (client.monthEnd < 100) {
      add({ id: 'summary-month-end', type: 'Month End', kind: 'summary-month-end', issue: 'Month end open', description: `Month end is ${client.monthEnd}% complete.`, priority: 'Medium', destination: 'Month End', action: 'Open client' })
    }
  })
  return tasks
}

function buildRequestTasks(records: ClientRecords): WorkTask[] {
  const tasks: WorkTask[] = []
  const add = taskFactory(records.client, tasks)
  records.requests
    .filter((request) => openRequest(request))
    .forEach((request) => {
      const related = request.relatedTransaction ? ` (${[request.relatedTransaction, request.relatedAmount].filter(Boolean).join(', ')})` : ''
      add({
        id: `${request.id}-question`,
        type: 'Client Requests',
        kind: 'client-question',
        issue: request.requestType,
        description: `${request.question}${related} · ${summarizeRequest(request)}`,
        priority: requestTaskPriority(request),
        status: requestTaskStatus(request),
        dueDate: request.dueDate,
        destination: 'Client Requests',
        action: request.status === 'Client Responded' || request.status === 'Needs Follow-Up' ? 'Review response' : request.status === 'Draft' ? 'Finish draft' : 'Open request',
        requestId: request.id,
      })
    })
  return tasks
}

function buildMonthEndTasks(records: ClientRecords): WorkTask[] {
  const open = records.monthEnd.filter((item) => item.status === 'Needs Attention' || item.status === 'Not Started').length
  if (open === 0) return []
  const unavailable = records.monthEnd.filter((item) => item.status === 'Not Available').length
  const tasks: WorkTask[] = []
  taskFactory(records.client, tasks)({ id: 'month-end', type: 'Month End', kind: 'month-end-open', issue: 'Month end open', description: `${open} of ${records.monthEnd.length} month-end checks still need work.${unavailable ? ` ${unavailable} cannot be checked yet.` : ''}`, priority: 'Medium', destination: 'Month End', action: 'Finish month end' })
  return tasks
}

/** Highest priority first, then earliest due date (overdue first), then largest amount. Tasks without a due date follow dated ones. */
export function sortTasks(tasks: WorkTask[]): WorkTask[] {
  return [...tasks].sort(
    (left, right) =>
      priorityRank[left.priority] - priorityRank[right.priority] ||
      (left.dueDate ?? '9999-12-31').localeCompare(right.dueDate ?? '9999-12-31') ||
      (right.amount ?? 0) - (left.amount ?? 0) ||
      left.client.localeCompare(right.client) ||
      left.id.localeCompare(right.id),
  )
}

/** The single source for the Dashboard, Inbox and Bookkeeping Review. */
export function buildWorkTasks(records: ClientRecords, summaryClients: Client[] = []): WorkTask[] {
  return sortTasks([...buildReviewTasks(records), ...buildRequestTasks(records), ...buildMonthEndTasks(records), ...buildSummaryTasks(summaryClients)])
}

/** Demo requests and QuickBooks requests must never appear together. */
export function scopeRequests(requests: ClientRequest[], source: DataSource) {
  return requests.filter((request) => (source === 'quickbooks' ? Boolean(request.quickBooksId) : !request.quickBooksId))
}

/** Tasks that are rule-found checks, as opposed to client questions and month-end tracking that have their own pages. */
export function isReviewTask(task: WorkTask) {
  return task.kind !== 'client-question' && task.kind !== 'month-end-open' && task.kind !== 'summary-month-end'
}

export type TaskFilters = {
  clientId?: string | null
  priority?: TaskPriority | 'All'
  status?: TaskStatus | 'All'
  type?: TaskType | 'All'
}

export function filterTasks(tasks: WorkTask[], filters: TaskFilters): WorkTask[] {
  return tasks.filter(
    (task) =>
      (!filters.clientId || task.clientId === filters.clientId) &&
      (!filters.priority || filters.priority === 'All' || task.priority === filters.priority) &&
      (!filters.status || filters.status === 'All' || task.status === filters.status) &&
      (!filters.type || filters.type === 'All' || task.type === filters.type),
  )
}

const sumCounts = (tasks: WorkTask[]) => tasks.reduce((total, task) => total + task.count, 0)

export function countByType(tasks: WorkTask[]): Record<TaskType, number> {
  return Object.fromEntries(taskTypes.map((type) => [type, sumCounts(tasks.filter((task) => task.type === type))])) as Record<TaskType, number>
}

export function countByClient(tasks: WorkTask[]): Record<string, number> {
  return tasks.reduce<Record<string, number>>((counts, task) => ({ ...counts, [task.clientId]: (counts[task.clientId] ?? 0) + task.count }), {})
}

export type QueueSummary = {
  total: number
  high: number
  transactions: number
  reconciliation: number
  clientQuestions: number
  overdueInvoices: number
  overdueBills: number
  possibleDuplicates: number
  clientsNeedingAttention: number
  clientsWithMonthEndOpen: number
}

export function summarizeTasks(tasks: WorkTask[]): QueueSummary {
  const byKind = (...kinds: TaskKind[]) => sumCounts(tasks.filter((task) => kinds.includes(task.kind)))
  const byType = countByType(tasks)
  return {
    total: sumCounts(tasks),
    high: sumCounts(tasks.filter((task) => task.priority === 'High')),
    transactions: byType.Transactions,
    reconciliation: byType.Reconciliation,
    clientQuestions: byType['Client Requests'],
    overdueInvoices: byKind('overdue-invoice'),
    overdueBills: byKind('overdue-bill'),
    possibleDuplicates: byKind('possible-duplicate'),
    clientsNeedingAttention: new Set(tasks.map((task) => task.clientId)).size,
    clientsWithMonthEndOpen: new Set(tasks.filter((task) => task.type === 'Month End').map((task) => task.clientId)).size,
  }
}

/** Percent complete among checks that can actually be evaluated; null when none can. */
export function monthEndPercent(items: MonthEndItem[]): number | null {
  const checkable = items.filter((item) => item.status !== 'Not Available')
  if (checkable.length === 0) return null
  return Math.round((checkable.filter((item) => item.status === 'Complete').length / checkable.length) * 100)
}
