import type { ClientDocument, ClientRequest, ClientRequestStatus, ClientRequestType } from './bookkeepingTypes'
import { openRequest } from './clientPortal'
import { describeDue, type DueDescription } from './dueDates'

export const REQUEST_TYPES: ClientRequestType[] = ['Missing Receipt', 'Transaction Question', 'Statement Request', 'Invoice Request', 'Custom Question']
export const REQUEST_STATUSES: ClientRequestStatus[] = ['Draft', 'Sent', 'Waiting for Client', 'Client Responded', 'Needs Follow-Up', 'Completed']

export type RequestStatusFilter = 'All' | 'Active' | ClientRequestStatus
export type RequestFilters = { search: string; status: RequestStatusFilter; clientId: string }
export const ALL_CLIENTS = 'All'
export const emptyRequestFilters: RequestFilters = { search: '', status: 'All', clientId: ALL_CLIENTS }

export const hasActiveRequestFilters = (filters: RequestFilters) => filters.search.trim() !== '' || filters.status !== 'All' || filters.clientId !== ALL_CLIENTS

export type RequestNext = {
  action: 'Review Response' | 'Send Follow-Up' | 'Send Request' | 'View Request'
  text: string
  /** True when the client has to act first, so the bookkeeper has nothing to finish yet. */
  waiting: boolean
  needsBookkeeper: boolean
}

/** What the bookkeeper should do next, from the request's real status. */
export function nextStep(request: ClientRequest): RequestNext {
  switch (request.status) {
    case 'Completed':
      return { action: 'View Request', text: 'Complete. Nothing more to do.', waiting: false, needsBookkeeper: false }
    case 'Draft':
      return { action: 'Send Request', text: 'Review the draft, then send it to the client.', waiting: false, needsBookkeeper: true }
    case 'Client Responded':
      return { action: 'Review Response', text: "Read the client's response, then complete the request or ask for more.", waiting: false, needsBookkeeper: true }
    case 'Needs Follow-Up':
      return { action: 'Send Follow-Up', text: 'More detail is needed. Send the client a follow-up.', waiting: false, needsBookkeeper: true }
    default:
      return { action: 'View Request', text: 'Waiting on the client. Nothing to do until they respond.', waiting: true, needsBookkeeper: false }
  }
}

/** Relative due wording from the caller's local date. Completed requests are never overdue; missing or unreadable dates give nothing. */
export function requestDue(request: ClientRequest, today: string): DueDescription | undefined {
  if (!openRequest(request) || !request.dueDate) return undefined
  return describeDue(request.dueDate, today)
}

export const isOverdueRequest = (request: ClientRequest, today: string) => requestDue(request, today)?.tone === 'overdue'

export type RequestCounts = { total: number; active: number; completed: number; overdue: number; byStatus: Record<ClientRequestStatus, number> }

export function requestCounts(requests: ClientRequest[], today: string): RequestCounts {
  const byStatus = Object.fromEntries(REQUEST_STATUSES.map((status) => [status, 0])) as Record<ClientRequestStatus, number>
  for (const request of requests) byStatus[request.status] += 1
  const active = requests.filter(openRequest).length
  return { total: requests.length, active, completed: requests.length - active, overdue: requests.filter((request) => isOverdueRequest(request, today)).length, byStatus }
}

const plain = (value: string) => value.toLowerCase()
const digitsOnly = (value: string) => plain(value).replace(/[$,]/g, '')

export function requestDocuments(request: ClientRequest, documents: ClientDocument[]) {
  const ids = new Set(request.documentIds ?? [])
  return documents.filter((document) => document.requestId === request.id || ids.has(document.id))
}

/** Everything a bookkeeper might search for on a request: client, vendor, transaction, document reference, amount and request text. */
export function requestSearchText(request: ClientRequest, documents: ClientDocument[], clientName?: string) {
  const own = requestDocuments(request, documents)
  return [
    clientName, request.client, request.requestType, request.status, request.relatedTransaction, request.relatedTransactionId, request.relatedAmount,
    request.payee, request.amount, request.question, request.answer,
    ...(request.messages ?? []).map((message) => message.message),
    ...own.flatMap((document) => [document.name, document.vendor, document.type, document.amount, document.relatedTransaction, document.notes]),
  ].filter((part): part is string => Boolean(part)).join(' \n ')
}

export function filterRequests(requests: ClientRequest[], filters: RequestFilters, documents: ClientDocument[], clientNameOf: (request: ClientRequest) => string, options: { ignoreStatus?: boolean } = {}) {
  const terms = plain(filters.search).split(/\s+/).filter(Boolean)
  return requests.filter((request) => {
    if (filters.clientId !== ALL_CLIENTS && request.clientId !== filters.clientId) return false
    if (!options.ignoreStatus) {
      if (filters.status === 'Active' && !openRequest(request)) return false
      if (filters.status !== 'All' && filters.status !== 'Active' && request.status !== filters.status) return false
    }
    if (terms.length === 0) return true
    const text = requestSearchText(request, documents, clientNameOf(request))
    const raw = plain(text)
    const numeric = digitsOnly(text)
    return terms.every((term) => raw.includes(term) || numeric.includes(digitsOnly(term)))
  })
}

const rank = (request: ClientRequest) => {
  const next = nextStep(request)
  return next.needsBookkeeper ? 0 : next.waiting ? 1 : 2
}

/** Work the bookkeeper can do now first, then requests waiting on the client, then completed ones; the earliest due date leads within each group. */
export function sortRequests(requests: ClientRequest[]) {
  return requests
    .map((request, index) => ({ request, index }))
    .sort((left, right) => {
      const group = rank(left.request) - rank(right.request)
      if (group !== 0) return group
      const leftDue = left.request.dueDate ?? '9999-12-31'
      const rightDue = right.request.dueDate ?? '9999-12-31'
      return leftDue.localeCompare(rightDue) || left.index - right.index
    })
    .map((item) => item.request)
}

export function suggestedMessage(type: ClientRequestType, context: { transaction?: string; amount?: string } = {}) {
  const transaction = context.transaction?.trim()
  const amount = context.amount?.trim() ? ` (${context.amount.trim()})` : ''
  switch (type) {
    case 'Missing Receipt':
      return `Please upload the receipt for ${transaction ? `the ${transaction} purchase` : 'this purchase'}${amount}.`
    case 'Transaction Question':
      return `Can you tell us what ${transaction ? `the ${transaction} transaction` : 'this transaction'}${amount} was for?`
    case 'Statement Request':
      return 'Please upload the latest bank statement for this account so we can finish the reconciliation.'
    case 'Invoice Request':
      return `Please send the invoice for ${transaction ? `the ${transaction} charge` : 'this expense'}${amount}.`
    default:
      return ''
  }
}

export type RequestDraft = {
  open: boolean
  /** Only used while All clients is selected; otherwise the selected client is used. */
  clientId: string
  type: ClientRequestType
  /** null means the person has not edited the text, so the suggestion for the type is shown. */
  message: string | null
  /** null means the default of three days from today. */
  dueDate: string | null
  transaction: string
  amount: string
}

export const emptyRequestDraft: RequestDraft = { open: false, clientId: '', type: 'Custom Question', message: null, dueDate: null, transaction: '', amount: '' }

export const draftMessage = (draft: RequestDraft) => draft.message ?? suggestedMessage(draft.type, { transaction: draft.transaction, amount: draft.amount })

/** True when there is something a person typed or chose that would be lost. */
export const draftIsDirty = (draft: RequestDraft) =>
  draft.type !== emptyRequestDraft.type || (draft.message !== null && draft.message.trim() !== '') || draft.dueDate !== null || draft.transaction.trim() !== '' || draft.amount.trim() !== ''
