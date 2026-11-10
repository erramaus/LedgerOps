import crypto from 'node:crypto'
import express, { type Request, type Response } from 'express'
import { ADDITIONAL_DEMO_CLIENT_IDS, getAdditionalDemoCompany } from '../shared/demoCompanyBooks.js'
import { DEMO_CLIENT_ID, DEMO_CLIENT_NAME } from '../shared/demoBooks.js'
import type { FindingType, ReviewDecisionRecord, ReviewDecisionStatus, ReviewDecisionStore, ReviewPriority, ReviewSource } from './reviewDecisionStore.js'

const FINDING_TYPES: FindingType[] = ['duplicate', 'categorization', 'missing-info', 'unusual-amount', 'inconsistency', 'other']
const STATUSES: ReviewDecisionStatus[] = ['reviewing', 'dismissed', 'reopened']
const PRIORITIES: ReviewPriority[] = ['High', 'Medium', 'Low']
const QUICKBOOKS_CLIENT_ID = 'quickbooks-sandbox'

function isKnownClient(source: ReviewSource, clientId: unknown): clientId is string {
  return source === 'demo'
    ? clientId === DEMO_CLIENT_ID || (typeof clientId === 'string' && ADDITIONAL_DEMO_CLIENT_IDS.includes(clientId))
    : clientId === QUICKBOOKS_CLIENT_ID
}

export type ReviewDecisionInput = {
  clientId: string
  findingId: string
  findingType: FindingType
  issue: string
  description: string
  priority: ReviewPriority
  status: ReviewDecisionStatus
  reason?: string
  fingerprint: string
  expectedVersion: number
}

type Validation = { ok: true; value: ReviewDecisionInput } | { ok: false; error: string }

export function validateReviewDecisionInput(input: unknown, source: ReviewSource): Validation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, error: 'Review decision details are invalid.' }
  const body = input as Record<string, unknown>
  if (!isKnownClient(source, body.clientId)) return { ok: false, error: 'The review client is not available for this source.' }
  const validText = (value: unknown, min: number, max: number): value is string =>
    typeof value === 'string' && value.trim().length >= min && value.length <= max
  if (!validText(body.findingId, 1, 300)
    || !FINDING_TYPES.includes(body.findingType as FindingType)
    || !validText(body.issue, 1, 200)
    || !validText(body.description, 1, 2000)
    || !PRIORITIES.includes(body.priority as ReviewPriority)
    || !STATUSES.includes(body.status as ReviewDecisionStatus)
    || !validText(body.fingerprint, 1, 128)
    || !Number.isSafeInteger(body.expectedVersion)
    || (body.expectedVersion as number) < 0) {
    return { ok: false, error: 'Review decision details are invalid.' }
  }
  if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 2000)) {
    return { ok: false, error: 'The review note is too long or invalid.' }
  }
  if (body.status === 'dismissed' && !validText(body.reason, 1, 2000)) {
    return { ok: false, error: 'A reason is required to dismiss a finding.' }
  }
  return {
    ok: true,
    value: {
      clientId: body.clientId as string,
      findingId: body.findingId.trim(),
      findingType: body.findingType as FindingType,
      issue: body.issue.trim(),
      description: body.description.trim(),
      priority: body.priority as ReviewPriority,
      status: body.status as ReviewDecisionStatus,
      reason: typeof body.reason === 'string' ? body.reason.trim() : undefined,
      fingerprint: body.fingerprint.trim(),
      expectedVersion: body.expectedVersion as number,
    },
  }
}

function clientName(source: ReviewSource, clientId: string) {
  if (source === 'quickbooks') return 'QuickBooks Sandbox'
  if (clientId === DEMO_CLIENT_ID) return DEMO_CLIENT_NAME
  return getAdditionalDemoCompany(clientId)?.clientName ?? ''
}

export function createReviewDecisionRouter(dependencies: { source: ReviewSource; store: ReviewDecisionStore; now: () => number }) {
  const { source, store, now } = dependencies
  const router = express.Router()
  const sendError = (response: Response, status: number, error: string) => response.status(status).json({ error })
  const guard = (handler: (request: Request, response: Response) => Promise<void>): express.RequestHandler => async (request, response) => {
    try {
      await handler(request, response)
    } catch (error) {
      console.error('[review decisions] request failed:', error instanceof Error ? error.message : error)
      sendError(response, 500, 'Review decisions could not be loaded or saved.')
    }
  }

  router.get('/', guard(async (request, response) => {
    const requestedClient = request.query.clientId
    const clientId = requestedClient === undefined ? undefined : typeof requestedClient === 'string' ? requestedClient : null
    if (clientId === null || (clientId !== undefined && !isKnownClient(source, clientId))) {
      return void sendError(response, 400, 'The review client is not available for this source.')
    }
    const records = await store.list(source, clientId)
    const decisions = records.map((record) => ({ ...record, clientName: clientName(source, record.clientId) }))
    response.json({ durable: store.durable, decisions })
  }))

  router.post('/', guard(async (request, response) => {
    const validation = validateReviewDecisionInput(request.body, source)
    if (!validation.ok) return void sendError(response, 400, validation.error)
    const { value } = validation
    const authenticatedUser = request.session?.user
    const bypass = response.locals.devBypass === true
    const actorId = authenticatedUser && !bypass ? authenticatedUser.sub : undefined
    const actor = bypass ? 'Local development bypass' : authenticatedUser?.email
    const record: ReviewDecisionRecord = {
      id: crypto.randomUUID(),
      source,
      clientId: value.clientId,
      clientName: clientName(source, value.clientId),
      findingId: value.findingId,
      findingType: value.findingType,
      issue: value.issue,
      description: value.description,
      priority: value.priority,
      status: value.status,
      reason: value.reason,
      actorId,
      actor,
      at: new Date(now()).toISOString(),
      fingerprint: value.fingerprint,
      version: value.expectedVersion + 1,
    }
    if (!(await store.append(record, value.expectedVersion))) {
      return void sendError(response, 409, 'This review finding changed elsewhere. Reload review decisions and try again.')
    }
    response.status(201).json({ durable: store.durable, decision: record })
  }))

  return router
}
