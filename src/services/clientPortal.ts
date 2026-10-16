import { DEMO_CLIENT_ID } from '../../shared/demoBooks'
import type {
  ClientDocument,
  ClientDocumentReviewStatus,
  ClientDocumentType,
  ClientRequest,
  ClientRequestMessage,
  ClientRequestStatus,
  ClientRequestType,
  RequestSender,
  Transaction,
} from './bookkeepingTypes'
import type { DataSource, TaskPriority } from './workQueue'
import { getLines, needsCategory, parseAmount } from './transactionReview'

export type PortalAuditKind =
  | 'request-created'
  | 'request-sent'
  | 'message-sent'
  | 'client-responded'
  | 'document-submitted'
  | 'receipt-matched'
  | 'request-approved'
  | 'request-rejected'
  | 'request-completed'

export type PortalAuditEvent = {
  id: string
  at: string
  source: DataSource
  clientId: string
  requestId?: string
  documentId?: string
  actor: RequestSender
  kind: PortalAuditKind
  summary: string
  detail?: string
}

export type DocumentFixture = {
  id: string
  label: string
  name: string
  type: ClientDocumentType
  vendor?: string
  amount?: string
  notes: string
}

export type ReceiptMatchCandidate = {
  transactionId: string
  payee: string
  date: string
  amount: string
  reasons: string[]
  score: number
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const includesNormalized = (left: string, right: string) => normalize(right).includes(normalize(left))
const isoDisplay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
const requestMessageId = (requestId: string, suffix: string) => `${requestId}-msg-${suffix}`

function priorityFor(type: ClientRequestType): TaskPriority {
  return type === 'Missing Receipt' || type === 'Statement Request' ? 'High' : type === 'Invoice Request' ? 'Medium' : 'Low'
}

export function openRequest(request: ClientRequest) {
  return request.status !== 'Completed'
}

export function requestNeedsReview(request: ClientRequest) {
  return request.status === 'Client Responded' || request.status === 'Needs Follow-Up'
}

export function requestTaskStatus(request: ClientRequest) {
  if (requestNeedsReview(request)) return 'Ready to review' as const
  if (request.status === 'Draft' || request.status === 'Sent') return 'Open' as const
  return 'Waiting on client' as const
}

export function requestTaskPriority(request: ClientRequest): TaskPriority {
  if (requestNeedsReview(request)) return 'High'
  return request.priority ?? priorityFor(request.requestType)
}

export function statusLabel(status: ClientRequestStatus) {
  return status.toLowerCase().replaceAll(' ', '-')
}

export function createRequestMessage(requestId: string, sender: RequestSender, senderLabel: string, message: string, sentAt: string, documentIds?: string[], uniqueSuffix?: string): ClientRequestMessage {
  return {
    id: requestMessageId(requestId, `${sender.toLowerCase()}-${sentAt}${uniqueSuffix ? `-${uniqueSuffix}` : ''}`),
    sender,
    senderLabel,
    sentAt,
    message,
    ...(documentIds && documentIds.length > 0 ? { documentIds } : {}),
  }
}

export function normalizeRequest(request: ClientRequest): ClientRequest {
  const status = request.status === ('Answered' as ClientRequestStatus) ? 'Client Responded' : request.status === ('Resolved' as ClientRequestStatus) ? 'Completed' : request.status
  const requestType = request.requestType ?? (request.requestedDocumentType ? 'Missing Receipt' : 'Transaction Question')
  const priority = request.priority ?? priorityFor(requestType)
  const messages = request.messages && request.messages.length > 0
    ? request.messages
    : [
        createRequestMessage(request.id, 'Bookkeeper', 'LedgerOps Bookkeeper', request.question, `${normalizeDisplayDate(request.dateCreated)}T09:00:00.000Z`),
        ...(request.answer ? [createRequestMessage(request.id, 'Client', request.client, request.answer, `${normalizeDisplayDate(request.dateCreated)}T13:00:00.000Z`)] : []),
      ]
  return {
    ...request,
    requestType,
    priority,
    status,
    messages,
    documentIds: request.documentIds ?? [],
  }
}

function doc(id: string, clientId: string, client: string, type: ClientDocumentType, name: string, date: string, fixtureId: string, extra: Partial<ClientDocument> = {}): ClientDocument {
  return {
    id,
    clientId,
    client,
    type,
    name,
    date,
    uploadedAt: `${normalizeDisplayDate(date)}T10:00:00.000Z`,
    uploadedBy: 'Client',
    fixtureId,
    reviewStatus: 'Approved',
    ...extra,
  }
}

export function seededDocumentsFor(clientId: string, clientName: string): ClientDocument[] {
  if (clientId === DEMO_CLIENT_ID) {
    return [
      doc('doc-abc-vendor-invoice', clientId, clientName, 'Vendor Invoice', 'ABC Supply Co. August invoice', 'August 12, 2026', 'vendor-invoice', { relatedTransaction: 'ABC Supply Co.', relatedAmount: '$860.00', notes: 'Demo fixture metadata only.' }),
      doc('doc-abc-tax-form', clientId, clientName, 'Tax Document', 'ABC Plumbing payroll tax notice', 'August 01, 2026', 'tax-doc', { notes: 'Demo fixture metadata only.' }),
    ]
  }
  if (clientId === 'green-leaf-landscaping') {
    return [
      doc('doc-green-bank', clientId, clientName, 'Bank Statement', 'August operating account statement', 'August 31, 2026', 'bank-statement', { reviewStatus: 'Pending Review', notes: 'Waiting for bookkeeper review.' }),
    ]
  }
  if (clientId === 'smith-construction') {
    return [
      doc('doc-smith-card', clientId, clientName, 'Credit Card Statement', 'August corporate card statement', 'August 31, 2026', 'card-statement', { notes: 'Demo fixture metadata only.' }),
    ]
  }
  if (clientId === 'johnson-dental') {
    return [
      doc('doc-johnson-customer', clientId, clientName, 'Customer Invoice', 'Insurance reimbursement packet', 'August 18, 2026', 'customer-invoice', { notes: 'Demo fixture metadata only.' }),
    ]
  }
  return [
    doc('doc-acme-other', clientId, clientName, 'Other Supporting Document', 'Research platform contract addendum', 'August 09, 2026', 'other-support', { reviewStatus: 'Pending Review', notes: 'Demo fixture metadata only.' }),
  ]
}

export function fixturesForRequest(request: ClientRequest): DocumentFixture[] {
  const receipt: DocumentFixture = { id: 'fixture-receipt', label: 'Phone photo of receipt', name: `${request.relatedTransaction ?? request.client} receipt`, type: 'Receipt', vendor: request.relatedTransaction, amount: request.relatedAmount, notes: 'Simulated receipt metadata only.' }
  const statement: DocumentFixture = { id: 'fixture-bank-statement', label: 'PDF bank statement', name: `${request.client} monthly statement`, type: 'Bank Statement', notes: 'Simulated statement metadata only.' }
  const invoice: DocumentFixture = { id: 'fixture-invoice', label: 'Vendor invoice', name: `${request.relatedTransaction ?? request.client} invoice`, type: 'Vendor Invoice', vendor: request.relatedTransaction, amount: request.relatedAmount, notes: 'Simulated invoice metadata only.' }
  const other: DocumentFixture = { id: 'fixture-other', label: 'Other supporting document', name: `${request.client} supporting document`, type: 'Other Supporting Document', notes: 'Simulated supporting document metadata only.' }
  if (request.requestType === 'Missing Receipt') return [receipt, invoice, other]
  if (request.requestType === 'Statement Request') return [statement, other]
  if (request.requestType === 'Invoice Request') return [invoice, other]
  return [receipt, other]
}

export function createSubmittedDocument(request: ClientRequest, fixture: DocumentFixture, at: string): ClientDocument {
  return {
    id: `${request.id}-${fixture.id}-${at}`,
    client: request.client,
    clientId: request.clientId ?? DEMO_CLIENT_ID,
    name: fixture.name,
    type: fixture.type,
    date: request.transactionDate ?? request.dateCreated,
    uploadedAt: at,
    uploadedBy: 'Client',
    fixtureId: fixture.id,
    relatedTransactionId: request.relatedTransactionId,
    relatedTransaction: request.relatedTransaction,
    relatedAmount: request.relatedAmount,
    vendor: fixture.vendor ?? request.relatedTransaction,
    amount: fixture.amount ?? request.relatedAmount,
    reviewStatus: 'Pending Review',
    matchStatus: fixture.type === 'Receipt' ? 'Unmatched' : undefined,
    requestId: request.id,
    notes: fixture.notes,
  }
}

export function appendMessage(request: ClientRequest, sender: RequestSender, senderLabel: string, message: string, sentAt: string, documentIds?: string[], status?: ClientRequestStatus) {
  const nextIndex = (request.messages?.length ?? 0) + 1
  return {
    ...request,
    status: status ?? request.status,
    messages: [...(request.messages ?? []), createRequestMessage(request.id, sender, senderLabel, message, sentAt, documentIds, String(nextIndex))],
    ...(sender === 'Client' ? { answer: message } : {}),
  }
}

export function summarizeRequest(request: ClientRequest) {
  const due = request.dueDate ? ` · due ${isoDisplay(request.dueDate)}` : ''
  return `${request.requestType}${due}`
}

export function describeDocument(document: ClientDocument) {
  const related = document.relatedTransaction ? ` · ${document.relatedTransaction}` : ''
  return `${document.type}${related}`
}

export function receiptMatchCandidates(document: ClientDocument, transactions: Transaction[]): ReceiptMatchCandidate[] {
  if (document.type !== 'Receipt') return []
  const vendor = document.vendor?.trim()
  const amount = document.amount ? parseAmount(document.amount) : null
  const date = normalizeDisplayDate(document.date)
  return transactions.flatMap((transaction) => {
    const reasons: string[] = []
    let score = 0
    if (vendor && includesNormalized(vendor, transaction.payee || '')) {
      score += 4
      reasons.push(`Vendor matches ${transaction.payee}.`)
    }
    const transactionAmount = parseAmount(transaction.amount)
    if (amount !== null && Math.abs(transactionAmount - amount) < 0.01) {
      score += 3
      reasons.push(`Amount matches ${transaction.amount}.`)
    }
    const transactionDate = normalizeDisplayDate(transaction.date)
    const days = Math.abs(Math.round((Date.parse(`${transactionDate}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000))
    if (days <= 7) {
      score += 2
      reasons.push(`Date is within ${days} day${days === 1 ? '' : 's'}.`)
    }
    if (document.relatedTransactionId && document.relatedTransactionId === transaction.id) {
      score += 5
      reasons.push('Linked to this transaction request.')
    }
    return score === 0 ? [] : [{ transactionId: transaction.id, payee: transaction.payee, date: transaction.date, amount: transaction.amount, reasons, score }]
  }).sort((left, right) => right.score - left.score || left.date.localeCompare(right.date))
}

export function applyReceiptMatch(document: ClientDocument, transaction: Transaction) {
  return {
    document: {
      ...document,
      reviewStatus: 'Approved' as ClientDocumentReviewStatus,
      matchStatus: 'Matched' as const,
      matchedTransactionId: transaction.id,
      relatedTransactionId: transaction.id,
      relatedTransaction: transaction.payee,
      relatedAmount: transaction.amount,
    },
    transaction: transaction.status === 'Needs Receipt'
      ? {
          ...transaction,
          status: needsCategory(transaction) ? ('Needs Review' as const) : ('Matched' as const),
        }
      : transaction,
  }
}

export function reviewDocument(document: ClientDocument, reviewStatus: ClientDocumentReviewStatus, notes: string) {
  return {
    ...document,
    reviewStatus,
    notes,
    ...(document.type === 'Receipt' && reviewStatus === 'Rejected' ? { matchStatus: 'Unmatched' as const, matchedTransactionId: undefined } : {}),
  }
}

export function normalizeDisplayDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '2026-08-01'
  return parsed.toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function draftRequest(input: {
  client: string
  clientId: string
  requestType: ClientRequestType
  question: string
  dateCreated: string
  dueDate?: string
  priority?: TaskPriority
  relatedTransactionId?: string
  relatedTransaction?: string
  relatedAmount?: string
  requestedDocumentType?: ClientDocumentType
  status: ClientRequestStatus
}): ClientRequest {
  const id = `request-${input.clientId}-${Date.now()}`
  return normalizeRequest({
    id,
    client: input.client,
    clientId: input.clientId,
    requestType: input.requestType,
    dateCreated: input.dateCreated,
    dueDate: input.dueDate,
    priority: input.priority,
    relatedTransactionId: input.relatedTransactionId,
    relatedTransaction: input.relatedTransaction,
    relatedAmount: input.relatedAmount,
    question: input.question,
    status: input.status,
    requestedDocumentType: input.requestedDocumentType,
  })
}

export function draftClientMessageRequest(input: {
  client: string
  clientId: string
  subject: string
  message: string
  at: string
}): ClientRequest {
  const id = `request-${input.clientId}-${Date.now()}`
  return normalizeRequest({
    id,
    client: input.client,
    clientId: input.clientId,
    requestType: 'Custom Question',
    dateCreated: isoDisplay(input.at.slice(0, 10)),
    dueDate: addDays(input.at.slice(0, 10), 3),
    priority: 'Medium',
    question: input.subject,
    status: 'Client Responded',
    answer: input.message,
    messages: [
      createRequestMessage(id, 'Client', input.client, input.message, input.at),
    ],
  })
}

export function demoAuditEvent(event: Omit<PortalAuditEvent, 'id'>): PortalAuditEvent {
  return { ...event, id: `${event.kind}-${event.clientId}-${event.at}-${Math.random().toString(36).slice(2, 8)}` }
}

export function requestMatchesClient(request: ClientRequest, clientId: string) {
  return request.clientId === clientId
}

export function documentMatchesClient(document: ClientDocument, clientId: string) {
  return document.clientId === clientId
}

export function pendingDocumentCount(documents: ClientDocument[]) {
  return documents.filter((document) => document.reviewStatus === 'Pending Review').length
}

export function requestDocumentIds(request: ClientRequest, documents: ClientDocument[]) {
  return documents.filter((document) => document.requestId === request.id).map((document) => document.id)
}

export function requestHasResponse(request: ClientRequest) {
  return Boolean(request.messages?.some((message) => message.sender === 'Client'))
}

export function requiresReceiptDocument(request: ClientRequest) {
  return request.requestType === 'Missing Receipt' || request.requestedDocumentType === 'Receipt'
}

export function receiptReadyForMatch(document: ClientDocument) {
  return document.type === 'Receipt' && document.reviewStatus === 'Pending Review'
}

export function latestMessage(request: ClientRequest) {
  return request.messages?.[request.messages.length - 1]
}

export function requestResponseSummary(request: ClientRequest) {
  const latest = latestMessage(request)
  return latest ? `${latest.senderLabel}: ${latest.message}` : request.question
}

export function requestTransactionBlocked(request: ClientRequest) {
  return Boolean(request.relatedTransactionId) && openRequest(request)
}

export function relevantTransactionStatus(transaction: Transaction, requests: ClientRequest[]) {
  const blocking = requests.some((request) => request.relatedTransactionId === transaction.id && request.requestType === 'Missing Receipt' && openRequest(request))
  if (!blocking) return transaction
  return transaction.status === 'Needs Receipt' ? transaction : { ...transaction, status: 'Needs Receipt' as const }
}
