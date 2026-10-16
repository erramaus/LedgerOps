import crypto from 'node:crypto'
import express, { type Response } from 'express'
import { DEMO_CLIENT_ID } from '../shared/demoBooks.js'
import { ADDITIONAL_DEMO_CLIENT_IDS } from '../shared/demoCompanyBooks.js'
import { createWorkpaperRecord, updateWorkpaperRecord, validateWorkpaperInput, workpaperAccounts, type DemoWorkpaperInput } from '../shared/demoWorkpapers.js'
import type { DemoWorkpaperStore } from './demoWorkpaperStore.js'

type Problem = { status: number; code: string; error: string; extra?: Record<string, unknown> }
const problem = (status: number, code: string, error: string, extra?: Record<string, unknown>): Problem => ({ status, code, error, extra })
const isProblem = (value: unknown): value is Problem => typeof value === 'object' && value !== null && 'code' in value && 'status' in value && 'error' in value
const text = (value: unknown, max: number) => (typeof value === 'string' && value.length <= max ? value : null)
const array = (value: unknown) => Array.isArray(value) ? value : null

function readInput(value: unknown): DemoWorkpaperInput | Problem {
  const body = (value ?? {}) as Record<string, unknown>
  const title = text(body.title, 120)
  const period = text(body.period, 7)
  const accountId = text(body.accountId, 60)
  const note = text(body.note, 1200)
  const preparedBy = text(body.preparedBy, 120)
  const reviewedBy = text(body.reviewedBy ?? '', 120) || undefined
  const workDate = text(body.workDate, 10)
  const reviewStatus = text(body.reviewStatus, 20)
  const supportingDocumentRefs = array(body.supportingDocumentRefs)
  const reconciliationLinks = array(body.reconciliationLinks)
  const adjustingEntryIds = array(body.adjustingEntryIds)
  if (title === null || period === null || accountId === null || note === null || preparedBy === null || workDate === null || !reviewStatus || !supportingDocumentRefs || !reconciliationLinks || !adjustingEntryIds) return problem(400, 'INVALID', 'The workpaper details are not valid.')
  return {
    title,
    period,
    accountId,
    note,
    supportingDocumentRefs: supportingDocumentRefs.filter((item): item is string => typeof item === 'string'),
    reconciliationLinks: reconciliationLinks.filter((item): item is string => typeof item === 'string'),
    adjustingEntryIds: adjustingEntryIds.filter((item): item is string => typeof item === 'string'),
    reviewStatus: reviewStatus as DemoWorkpaperInput['reviewStatus'],
    preparedBy,
    ...(reviewedBy ? { reviewedBy } : {}),
    workDate,
  }
}

export function createDemoWorkpaperRouter(deps: { store: DemoWorkpaperStore; now: () => number }) {
  const { store, now } = deps
  const router = express.Router()
  const iso = () => new Date(now()).toISOString()
  const actor = (request: express.Request) => request.session?.user?.email ?? 'unknown'
  const send = (response: Response, failure: Problem) => response.status(failure.status).json({ error: failure.error, code: failure.code, ...failure.extra })
  const guard = (handler: (request: express.Request, response: Response) => Promise<void>): express.RequestHandler => async (request, response) => {
    try {
      await handler(request, response)
    } catch (error) {
      console.error('[demo workpapers] request failed:', error instanceof Error ? error.message : error)
      send(response, problem(500, 'UNEXPECTED', 'The workpaper could not be saved. Nothing was changed.'))
    }
  }

  const demoOnly = (clientId: unknown): Problem | null =>
    clientId === DEMO_CLIENT_ID || (typeof clientId === 'string' && ADDITIONAL_DEMO_CLIENT_IDS.includes(clientId)) ? null : problem(422, 'NO_BOOKS', 'Detailed demo books exist only for the five listed demo companies.')

  const validate = (clientId: string, input: DemoWorkpaperInput) => {
    const fields = validateWorkpaperInput(input, workpaperAccounts(clientId), clientId)
    return Object.keys(fields).length === 0 ? null : problem(400, 'INVALID', Object.values(fields)[0] as string, { fields })
  }

  router.get('/', guard(async (request, response) => {
    const clientId = request.query.clientId
    if (typeof clientId !== 'string' || !/^[\w-]{1,60}$/.test(clientId)) return void send(response, problem(400, 'INVALID', 'A client is required.'))
    response.json({ durable: store.durable, records: await store.list(clientId) })
  }))

  router.post('/', guard(async (request, response) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    const notDemo = demoOnly(body.clientId)
    if (notDemo) return void send(response, notDemo)
    const input = readInput(body.input)
    if (isProblem(input)) return void send(response, input)
    const invalid = validate(body.clientId as string, input)
    if (invalid) return void send(response, invalid)
    const record = createWorkpaperRecord(`workpaper-${crypto.randomBytes(6).toString('hex')}`, body.clientId as string, input, actor(request), iso())
    if (!await store.put(record, 0)) return void send(response, problem(409, 'CONFLICT', 'That workpaper could not be saved. Try again.'))
    response.status(201).json({ durable: store.durable, record })
  }))

  router.post('/:id/update', guard(async (request, response) => {
    const id = String(request.params.id)
    const expectedVersion = request.body?.expectedVersion
    if (!Number.isInteger(expectedVersion) || (expectedVersion as number) <= 0) return void send(response, problem(400, 'INVALID', 'The workpaper version is not valid.'))
    const current = await store.get(id)
    if (!current) return void send(response, problem(404, 'NOT_FOUND', 'That workpaper was not found.'))
    if (current.version !== expectedVersion) return void send(response, problem(409, 'CONFLICT', 'This workpaper changed. Reload it and try again.'))
    const input = readInput(request.body?.input)
    if (isProblem(input)) return void send(response, input)
    const invalid = validate(current.clientId, input)
    if (invalid) return void send(response, invalid)
    const next = updateWorkpaperRecord(current, input, actor(request), iso())
    if (!await store.put(next, current.version)) return void send(response, problem(409, 'CONFLICT', 'This workpaper changed. Reload it and try again.'))
    response.json({ durable: store.durable, record: next })
  }))

  return router
}
