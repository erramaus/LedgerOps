import crypto from 'node:crypto'
import express, { type Response } from 'express'
import { DEMO_CLIENT_ID } from '../shared/demoBooks.js'
import { ADDITIONAL_DEMO_CLIENT_IDS } from '../shared/demoCompanyBooks.js'
import { createDraftJournalRecord, editDraftJournalRecord, journalAccounts, postDraftJournalRecord, reverseJournalRecord, validateJournalInput, type DemoJournalEntryInput } from '../shared/demoJournalEntries.js'
import { monthEndId } from '../shared/monthEnd.js'
import { monthLabel, parsePeriodKey } from '../shared/period.js'
import type { MonthEndStore } from './monthEndStore.js'
import type { DemoJournalStore } from './demoJournalStore.js'

type Problem = { status: number; code: string; error: string; extra?: Record<string, unknown> }
const problem = (status: number, code: string, error: string, extra?: Record<string, unknown>): Problem => ({ status, code, error, extra })
const isProblem = (value: unknown): value is Problem => typeof value === 'object' && value !== null && 'code' in value && 'status' in value && 'error' in value
const text = (value: unknown, max: number) => (typeof value === 'string' && value.length <= max ? value : null)
const lines = (value: unknown) => Array.isArray(value) ? value : null

function readInput(value: unknown): DemoJournalEntryInput | Problem {
  const body = (value ?? {}) as Record<string, unknown>
  const date = text(body.date, 10)
  const description = text(body.description, 160)
  const referenceNumber = text(body.referenceNumber ?? '', 40)
  const adjustmentType = text(body.adjustmentType ?? '', 40) || undefined
  const explanation = text(body.explanation ?? '', 500) || undefined
  const rawLines = lines(body.lines)
  if (date === null || description === null || referenceNumber === null || rawLines === null) return problem(400, 'INVALID', 'The journal entry details are not valid.')
  const parsedLines = rawLines.map((line) => {
    const row = (line ?? {}) as Record<string, unknown>
    return {
      accountId: text(row.accountId, 60) ?? '',
      debitCents: typeof row.debitCents === 'number' ? row.debitCents : NaN,
      creditCents: typeof row.creditCents === 'number' ? row.creditCents : NaN,
      memo: text(row.memo ?? '', 160) ?? '',
    }
  })
  return { date, description, referenceNumber, ...(adjustmentType ? { adjustmentType: adjustmentType as DemoJournalEntryInput['adjustmentType'] } : {}), ...(explanation ? { explanation } : {}), lines: parsedLines }
}

export function createDemoJournalRouter(deps: { store: DemoJournalStore; monthEnd: MonthEndStore; now: () => number }) {
  const { store, monthEnd, now } = deps
  const router = express.Router()
  const iso = () => new Date(now()).toISOString()
  const actor = (request: express.Request) => request.session?.user?.email ?? 'unknown'
  const send = (response: Response, failure: Problem) => response.status(failure.status).json({ error: failure.error, code: failure.code, ...failure.extra })
  const guard = (handler: (request: express.Request, response: Response) => Promise<void>): express.RequestHandler => async (request, response) => {
    try {
      await handler(request, response)
    } catch (error) {
      console.error('[demo journals] request failed:', error instanceof Error ? error.message : error)
      send(response, problem(500, 'UNEXPECTED', 'The journal entry could not be saved. Nothing was changed.'))
    }
  }

  const demoOnly = (clientId: unknown): Problem | null =>
    clientId === DEMO_CLIENT_ID || (typeof clientId === 'string' && ADDITIONAL_DEMO_CLIENT_IDS.includes(clientId)) ? null : problem(422, 'NO_BOOKS', 'Detailed demo books exist only for the five listed demo companies.')

  const validate = (clientId: string, input: DemoJournalEntryInput) => {
    const fields = validateJournalInput(input, journalAccounts(clientId), clientId)
    return Object.keys(fields).length === 0 ? null : problem(400, 'INVALID', Object.values(fields)[0] as string, { fields })
  }

  const ensureOpen = async (clientId: string, date: string) => {
    const month = date.slice(0, 7)
    const record = await monthEnd.get(monthEndId('demo', clientId, month))
    return record?.status === 'closed'
      ? problem(409, 'PERIOD_CLOSED', `${monthLabel(parsePeriodKey(month)!)} is closed. Reopen the month in Month End, with a reason, before posting or reversing this journal entry.`)
      : null
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
    const record = createDraftJournalRecord(`journal-${crypto.randomBytes(6).toString('hex')}`, body.clientId as string, input, actor(request), iso())
    if (!await store.put(record, 0)) return void send(response, problem(409, 'CONFLICT', 'That journal entry could not be saved. Try again.'))
    response.status(201).json({ durable: store.durable, record })
  }))

  const loadDraft = async (id: string, expectedVersion: unknown) => {
    if (!Number.isInteger(expectedVersion) || (expectedVersion as number) <= 0) return problem(400, 'INVALID', 'The journal entry version is not valid.')
    const current = await store.get(id)
    if (!current) return problem(404, 'NOT_FOUND', 'That journal entry was not found.')
    if (current.status !== 'Draft') return problem(409, 'NOT_EDITABLE', 'Only draft journal entries can be edited or posted.')
    if (current.version !== expectedVersion) return problem(409, 'CONFLICT', 'This journal entry changed. Reload it and try again.')
    return current
  }

  router.post('/:id/edit', guard(async (request, response) => {
    const id = String(request.params.id)
    const current = await loadDraft(id, request.body?.expectedVersion)
    if (isProblem(current)) return void send(response, current)
    const input = readInput(request.body?.input)
    if (isProblem(input)) return void send(response, input)
    const invalid = validate(current.clientId, input)
    if (invalid) return void send(response, invalid)
    const next = editDraftJournalRecord(current, input, actor(request), iso())
    if (!await store.put(next, current.version)) return void send(response, problem(409, 'CONFLICT', 'That journal entry changed. Reload it and try again.'))
    response.json({ durable: store.durable, record: next })
  }))

  router.post('/:id/post', guard(async (request, response) => {
    const id = String(request.params.id)
    const current = await loadDraft(id, request.body?.expectedVersion)
    if (isProblem(current)) return void send(response, current)
    const blocked = await ensureOpen(current.clientId, current.input.date)
    if (blocked) return void send(response, blocked)
    const next = postDraftJournalRecord(current, actor(request), iso())
    if (!await store.put(next, current.version)) return void send(response, problem(409, 'CONFLICT', 'That journal entry changed. Reload it and try again.'))
    response.json({ durable: store.durable, record: next })
  }))

  router.post('/:id/reverse', guard(async (request, response) => {
    const id = String(request.params.id)
    const expectedVersion = request.body?.expectedVersion
    const reason = text(request.body?.reason ?? '', 240)
    if (!Number.isInteger(expectedVersion) || (expectedVersion as number) <= 0 || reason === null) return void send(response, problem(400, 'INVALID', 'A reversal reason is required.'))
    const current = await store.get(id)
    if (!current) return void send(response, problem(404, 'NOT_FOUND', 'That journal entry was not found.'))
    if (current.status !== 'Posted') return void send(response, problem(409, 'NOT_REVERSIBLE', 'Only posted journal entries can be reversed.'))
    if (current.version !== expectedVersion) return void send(response, problem(409, 'CONFLICT', 'This journal entry changed. Reload it and try again.'))
    const blocked = await ensureOpen(current.clientId, current.input.date)
    if (blocked) return void send(response, blocked)
    const { original, reversal } = reverseJournalRecord(current, `journal-${crypto.randomBytes(6).toString('hex')}`, actor(request), iso(), reason.trim())
    if (!await store.put(original, current.version)) return void send(response, problem(409, 'CONFLICT', 'That journal entry changed. Reload it and try again.'))
    if (!await store.put(reversal, 0)) {
      await store.put(current, original.version)
      return void send(response, problem(409, 'CONFLICT', 'The reversal could not be saved. Try again.'))
    }
    response.json({ durable: store.durable, record: original, reversal })
  }))

  return router
}
