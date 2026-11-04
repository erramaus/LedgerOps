import { describe, expect, it } from 'vitest'
import type { ClientDocument, ClientRequest } from './bookkeepingTypes'
import {
  draftIsDirty,
  draftMessage,
  emptyRequestDraft,
  emptyRequestFilters,
  filterRequests,
  hasActiveRequestFilters,
  nextStep,
  requestCounts,
  requestDue,
  sortRequests,
  suggestedMessage,
} from './requestsView'

const TODAY = '2026-10-15'
const make = (overrides: Partial<ClientRequest>): ClientRequest => ({
  id: 'r', client: 'ABC Plumbing', clientId: 'abc', requestType: 'Missing Receipt', status: 'Sent', question: 'Please upload the receipt.',
  dateCreated: '2026-10-01', relatedTransaction: 'Home Depot', relatedAmount: '$341.22', ...overrides,
} as ClientRequest)
const name = (request: ClientRequest) => request.client

const requests = [
  make({ id: 'a', status: 'Client Responded', dueDate: '2026-10-10' }),
  make({ id: 'b', status: 'Waiting for Client', dueDate: '2026-10-16', client: 'Smith Construction', clientId: 'smith', relatedTransaction: 'Northstar Electric', relatedAmount: '$1,200.00', question: 'What was this?' }),
  make({ id: 'c', status: 'Completed', dueDate: '2026-09-01' }),
  make({ id: 'd', status: 'Draft', dueDate: '2026-10-20' }),
  make({ id: 'e', status: 'Needs Follow-Up' }),
]

describe('requestCounts', () => {
  it('separates active from total from the real records', () => {
    const counts = requestCounts(requests, TODAY)
    expect(counts.total).toBe(5)
    expect(counts.active).toBe(4)
    expect(counts.completed).toBe(1)
    expect(counts.byStatus['Client Responded']).toBe(1)
    expect(counts.byStatus.Completed).toBe(1)
  })

  it('never counts a completed request as overdue', () => {
    expect(requestCounts(requests, TODAY).overdue).toBe(1)
    expect(requestDue(requests[2], TODAY)).toBeUndefined()
  })
})

describe('requestDue', () => {
  it('uses the supplied local date for relative labels', () => {
    expect(requestDue(requests[0], TODAY)?.label).toBe('Overdue by 5 days')
    expect(requestDue(requests[1], TODAY)?.label).toBe('Due tomorrow')
    expect(requestDue(requests[0], '2026-10-09')?.tone).not.toBe('overdue')
  })

  it('returns nothing for missing or invalid dates', () => {
    expect(requestDue(requests[4], TODAY)).toBeUndefined()
    expect(requestDue(make({ dueDate: 'not a date' }), TODAY)?.tone ?? 'none').not.toBe('overdue')
  })
})

describe('nextStep', () => {
  it('maps each status to the bookkeeper action', () => {
    expect(nextStep(make({ status: 'Draft' })).action).toBe('Send Request')
    expect(nextStep(make({ status: 'Client Responded' })).action).toBe('Review Response')
    expect(nextStep(make({ status: 'Needs Follow-Up' })).action).toBe('Send Follow-Up')
    expect(nextStep(make({ status: 'Completed' })).action).toBe('View Request')
  })

  it('marks sent and waiting requests as waiting on the client', () => {
    for (const status of ['Sent', 'Waiting for Client'] as const) {
      const step = nextStep(make({ status }))
      expect(step.waiting).toBe(true)
      expect(step.needsBookkeeper).toBe(false)
    }
  })
})

describe('filterRequests', () => {
  it('returns everything with empty filters', () => {
    expect(filterRequests(requests, emptyRequestFilters, [], name)).toHaveLength(5)
    expect(hasActiveRequestFilters(emptyRequestFilters)).toBe(false)
  })

  it('filters by client, status and Active', () => {
    expect(filterRequests(requests, { ...emptyRequestFilters, clientId: 'smith' }, [], name).map((item) => item.id)).toEqual(['b'])
    expect(filterRequests(requests, { ...emptyRequestFilters, status: 'Active' }, [], name)).toHaveLength(4)
    expect(filterRequests(requests, { ...emptyRequestFilters, status: 'Completed' }, [], name).map((item) => item.id)).toEqual(['c'])
  })

  it('searches client, vendor, request text and amounts together with status', () => {
    expect(filterRequests(requests, { ...emptyRequestFilters, search: 'smith' }, [], name).map((item) => item.id)).toEqual(['b'])
    expect(filterRequests(requests, { ...emptyRequestFilters, search: 'northstar' }, [], name)).toHaveLength(1)
    expect(filterRequests(requests, { ...emptyRequestFilters, search: '$1200.00' }, [], name)).toHaveLength(1)
    expect(filterRequests(requests, { ...emptyRequestFilters, search: 'home depot', status: 'Draft' }, [], name).map((item) => item.id)).toEqual(['d'])
    expect(filterRequests(requests, { ...emptyRequestFilters, search: 'nothing-matches' }, [], name)).toHaveLength(0)
  })

  it('searches attached document references', () => {
    const documents = [{ id: 'doc', requestId: 'b', name: 'statement-sept.pdf', type: 'Bank Statement' }] as ClientDocument[]
    expect(filterRequests(requests, { ...emptyRequestFilters, search: 'statement-sept' }, documents, name).map((item) => item.id)).toEqual(['b'])
  })

  it('ignores the status filter when asked, for chip counts', () => {
    expect(filterRequests(requests, { ...emptyRequestFilters, status: 'Draft' }, [], name, { ignoreStatus: true })).toHaveLength(5)
  })
})

describe('sortRequests', () => {
  it('puts bookkeeper work first, waiting next and completed last', () => {
    expect(sortRequests(requests).map((item) => item.id)).toEqual(['a', 'd', 'e', 'b', 'c'])
  })
})

describe('suggestions and drafts', () => {
  it('suggests text per type and leaves Custom Question empty', () => {
    expect(suggestedMessage('Missing Receipt', { transaction: 'Home Depot', amount: '$10' })).toContain('Home Depot')
    expect(suggestedMessage('Statement Request')).toContain('bank statement')
    expect(suggestedMessage('Custom Question')).toBe('')
  })

  it('shows the suggestion until the text is edited', () => {
    expect(draftMessage({ ...emptyRequestDraft, type: 'Invoice Request' })).toContain('invoice')
    expect(draftMessage({ ...emptyRequestDraft, type: 'Invoice Request', message: 'Mine' })).toBe('Mine')
  })

  it('detects unsaved changes', () => {
    expect(draftIsDirty(emptyRequestDraft)).toBe(false)
    expect(draftIsDirty({ ...emptyRequestDraft, open: true })).toBe(false)
    expect(draftIsDirty({ ...emptyRequestDraft, message: 'hello' })).toBe(true)
    expect(draftIsDirty({ ...emptyRequestDraft, type: 'Missing Receipt' })).toBe(true)
  })
})
