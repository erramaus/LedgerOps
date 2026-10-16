import { describe, expect, it } from 'vitest'
import type { ClientDocument, ClientRequest, Transaction } from './bookkeepingTypes'
import {
  addDays,
  applyReceiptMatch,
  createSubmittedDocument,
  draftClientMessageRequest,
  draftRequest,
  fixturesForRequest,
  normalizeRequest,
  openRequest,
  receiptMatchCandidates,
  requestTaskPriority,
  requestTaskStatus,
  seededDocumentsFor,
} from './clientPortal'

const request = (overrides: Partial<ClientRequest> = {}): ClientRequest =>
  normalizeRequest({
    id: 'req-1',
    client: 'ABC Plumbing',
    clientId: 'abc-plumbing',
    requestType: 'Missing Receipt',
    dateCreated: 'August 18, 2026',
    dueDate: '2026-08-21',
    question: 'Please send the receipt.',
    status: 'Waiting for Client',
    relatedTransactionId: 'txn-1',
    relatedTransaction: 'Home Depot',
    relatedAmount: '$341.22',
    ...overrides,
  })

const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'txn-1',
  date: 'Aug 18, 2026',
  payee: 'Home Depot',
  description: 'PVC pipe',
  amount: '$341.22',
  category: 'Materials',
  status: 'Needs Receipt',
  clientId: 'abc-plumbing',
  ...overrides,
})

describe('client portal helpers', () => {
  it('normalizes legacy-style requests and creates a default message history', () => {
    const normalized = normalizeRequest({
      id: 'legacy',
      client: 'ABC Plumbing',
      clientId: 'abc-plumbing',
      requestType: 'Transaction Question',
      dateCreated: 'August 18, 2026',
      question: 'Who sent this deposit?',
      status: 'Client Responded',
      answer: 'Westview Apartments paid it.',
    })
    expect(normalized.messages).toHaveLength(2)
    expect(normalized.messages?.[1].sender).toBe('Client')
  })

  it('keeps seeded documents isolated per client', () => {
    expect(seededDocumentsFor('abc-plumbing', 'ABC Plumbing').every((document) => document.clientId === 'abc-plumbing')).toBe(true)
    expect(seededDocumentsFor('green-leaf-landscaping', 'Green Leaf Landscaping').some((document) => document.clientId === 'abc-plumbing')).toBe(false)
  })

  it('suggests receipt matches by vendor, amount, and date', () => {
    const submitted = createSubmittedDocument(request(), fixturesForRequest(request())[0], '2026-08-19T09:00:00.000Z')
    const matches = receiptMatchCandidates(submitted, [transaction(), transaction({ id: 'txn-2', payee: 'Amazon', amount: '$47.82' })])
    expect(matches[0]).toMatchObject({ transactionId: 'txn-1', payee: 'Home Depot' })
    expect(matches[0].reasons.join(' ')).toContain('Amount matches')
  })

  it('applies an approved receipt match without changing accounting data', () => {
    const submitted = createSubmittedDocument(request(), fixturesForRequest(request())[0], '2026-08-19T09:00:00.000Z')
    const result = applyReceiptMatch(submitted, transaction())
    expect(result.document.matchStatus).toBe('Matched')
    expect(result.transaction.status).toBe('Matched')
    expect(result.transaction.category).toBe('Materials')
  })

  it('derives task status and priority from request workflow state', () => {
    expect(requestTaskStatus(request({ status: 'Waiting for Client' }))).toBe('Waiting on client')
    expect(requestTaskStatus(request({ status: 'Client Responded' }))).toBe('Ready to review')
    expect(requestTaskPriority(request({ status: 'Client Responded' }))).toBe('High')
  })

  it('creates demo client-initiated messages as request threads', () => {
    const created = draftClientMessageRequest({ client: 'ABC Plumbing', clientId: 'abc-plumbing', subject: 'Need help', message: 'Please explain the bill.', at: '2026-10-15T20:00:00.000Z' })
    expect(created.status).toBe('Client Responded')
    expect(created.messages?.[0].sender).toBe('Client')
    expect(openRequest(created)).toBe(true)
  })

  it('creates draft requests with due dates', () => {
    const created = draftRequest({
      client: 'ABC Plumbing',
      clientId: 'abc-plumbing',
      requestType: 'Statement Request',
      question: 'Please upload the August bank statement.',
      dateCreated: 'October 15, 2026',
      dueDate: addDays('2026-10-15', 2),
      status: 'Draft',
    })
    expect(created.status).toBe('Draft')
    expect(created.dueDate).toBe('2026-10-17')
  })
})
