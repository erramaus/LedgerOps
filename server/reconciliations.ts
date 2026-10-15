import express, { type Response } from 'express'
import {
  MAX_ITEMS,
  RECORD_ID_PATTERN,
  isValidIsoDate,
  previousFrom,
  sameTransactions,
  splitEligible,
  summarizeResult,
  validateCompletion,
  type Completeness,
  type Direction,
  type ReconTxn,
  type ReconciliationRecord,
  type Source,
  type StatementLine,
} from '../shared/reconciliation.js'
import type { ReconciliationStore } from './reconciliationStore.js'

export type RegisterReader = {
  getReconciliationData(accountId: string, through: string): Promise<{ transactions: ReconTxn[]; completeness: Completeness }>
}

type Problem = { status: number; code: string; error: string }
const problem = (status: number, code: string, error: string): Problem => ({ status, code, error })
const isProblem = (value: unknown): value is Problem => typeof value === 'object' && value !== null && 'code' in value && 'status' in value

const text = (value: unknown, max: number) => (typeof value === 'string' && value.length <= max ? value : null)
const int = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= 1e13 ? value : null)
const isDirection = (value: unknown): value is Direction => value === 'increase' || value === 'decrease'

function sanitizeLine(value: unknown): StatementLine | null {
  const item = (value ?? {}) as Record<string, unknown>
  const id = text(item.id, 40), date = text(item.date, 10), description = text(item.description, 300), amountCents = int(item.amountCents)
  return id && date && description !== null && amountCents !== null && amountCents >= 0 && isDirection(item.direction) ? { id, date, description, amountCents, direction: item.direction } : null
}

function sanitizeTxn(value: unknown): ReconTxn | null {
  const item = (value ?? {}) as Record<string, unknown>
  const id = text(item.id, 60), date = text(item.date, 10), payee = text(item.payee, 300), memo = text(item.memo, 500), amountCents = int(item.amountCents)
  const type = item.type === undefined ? undefined : text(item.type, 40)
  return id && date && payee !== null && memo !== null && amountCents !== null && amountCents >= 0 && isDirection(item.direction) && type !== null ? { id, date, payee, memo, amountCents, direction: item.direction, ...(type ? { type } : {}) } : null
}

function all<T>(value: unknown, convert: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return null
  const out = value.map(convert)
  return out.every((item) => item !== null) ? (out as T[]) : null
}

type Editable = Pick<ReconciliationRecord, 'clientName' | 'accountName' | 'accountKind' | 'periodStart' | 'statementDate' | 'beginningCents' | 'endingCents' | 'openingConfirmed' | 'statementMode' | 'statementLines' | 'transactions' | 'clearedIds' | 'matches' | 'completeness'>

/** Accepts only the fields a user may edit; everything else is set by the server. */
function sanitizeEditable(input: unknown): Editable | Problem {
  const body = (input ?? {}) as Record<string, unknown>
  const invalid = problem(400, 'INVALID', 'The reconciliation details are not valid.')
  const clientName = text(body.clientName, 200), accountName = text(body.accountName, 200)
  const periodStart = text(body.periodStart, 10), statementDate = text(body.statementDate, 10)
  const beginningCents = int(body.beginningCents), endingCents = int(body.endingCents)
  const statementLines = all(body.statementLines, sanitizeLine)
  const transactions = all(body.transactions, sanitizeTxn)
  const clearedIds = all(body.clearedIds, (id) => text(id, 60))
  const matches = all(body.matches, (match) => {
    const item = (match ?? {}) as Record<string, unknown>
    const lineId = text(item.lineId, 40), txnId = text(item.txnId, 60)
    return lineId && txnId ? { lineId, txnId } : null
  })
  const completenessBody = (body.completeness ?? {}) as Record<string, unknown>
  const reasons = Array.isArray(completenessBody.reasons) && completenessBody.reasons.length <= 20 ? completenessBody.reasons.map((reason) => text(reason, 300)) : null
  if (
    !clientName || !accountName || periodStart === null || statementDate === null || beginningCents === null || endingCents === null ||
    typeof body.openingConfirmed !== 'boolean' || (body.statementMode !== 'manual' && body.statementMode !== 'csv') ||
    (body.accountKind !== 'bank' && body.accountKind !== 'credit_card') || !statementLines || !transactions || !clearedIds || !matches ||
    typeof completenessBody.complete !== 'boolean' || !reasons || reasons.includes(null)
  ) return invalid
  return {
    clientName, accountName, accountKind: body.accountKind, periodStart, statementDate, beginningCents, endingCents,
    openingConfirmed: body.openingConfirmed, statementMode: body.statementMode, statementLines, transactions, clearedIds, matches,
    completeness: { complete: completenessBody.complete, reasons: reasons as string[] },
  }
}

function parseId(id: string) {
  if (!RECORD_ID_PATTERN.test(id)) return null
  const [source, clientId, accountId, periodEnd] = id.split(':')
  return isValidIsoDate(periodEnd) ? { source: source as Source, clientId, accountId, periodEnd } : null
}

export function createReconciliationRouter(deps: { store: ReconciliationStore; quickbooks: RegisterReader; now: () => number }) {
  const { store, quickbooks, now } = deps
  const router = express.Router()
  const iso = () => new Date(now()).toISOString()
  const send = (response: Response, failure: Problem) => response.status(failure.status).json({ error: failure.error, code: failure.code })
  const actor = (request: express.Request) => request.session?.user?.email ?? 'unknown'

  const guard = (handler: (request: express.Request, response: Response) => Promise<void>): express.RequestHandler => async (request, response) => {
    try {
      await handler(request, response)
    } catch (error) {
      console.error('[reconciliation] request failed:', error instanceof Error ? error.message : error)
      send(response, problem(500, 'UNEXPECTED', 'The reconciliation could not be processed. Nothing was changed.'))
    }
  }

  const earlierCompleted = async (record: Pick<ReconciliationRecord, 'source' | 'clientId' | 'accountId' | 'periodEnd'>) => {
    const everything = await store.list({ source: record.source, clientId: record.clientId })
    return everything.filter((other) => other.accountId === record.accountId && other.status === 'completed').sort((left, right) => left.periodEnd.localeCompare(right.periodEnd))
  }

  router.get('/storage', (_request, response) => {
    response.json({
      durable: store.durable,
      description: store.durable
        ? 'Records are saved in the LedgerOps database.'
        : 'Temporary local development records. They are lost when the server restarts. Set DATABASE_URL for durable storage.',
    })
  })

  router.get('/', guard(async (request, response) => {
    const source = request.query.source, clientId = request.query.clientId
    if ((source !== 'demo' && source !== 'quickbooks') || typeof clientId !== 'string' || !/^[\w-]{1,60}$/.test(clientId)) return void send(response, problem(400, 'INVALID', 'A source and client are required.'))
    const records = await store.list({ source, clientId })
    response.json({
      durable: store.durable,
      records: records.map(({ transactions, statementLines, matches, clearedIds, ...summary }) => ({ ...summary, clearedCount: clearedIds.length, transactionCount: transactions.length, lineCount: statementLines.length, matchCount: matches.length })),
    })
  }))

  router.get('/:id', guard(async (request, response) => {
    const id = String(request.params.id)
    if (!parseId(id)) return void send(response, problem(400, 'INVALID', 'Invalid reconciliation id.'))
    const record = await store.get(id)
    if (!record) return void send(response, problem(404, 'NOT_FOUND', 'No saved reconciliation for this account and period.'))
    response.json({ durable: store.durable, record })
  }))

  router.put('/:id', guard(async (request, response) => {
    const id = String(request.params.id)
    const parts = parseId(id)
    const expectedVersion = request.body?.expectedVersion
    if (!parts || !Number.isInteger(expectedVersion) || expectedVersion < 0) return void send(response, problem(400, 'INVALID', 'A valid id and expected version are required.'))
    const editable = sanitizeEditable(request.body?.record)
    if (isProblem(editable)) return void send(response, editable)
    if (!isValidIsoDate(editable.periodStart) || editable.periodStart > parts.periodEnd) {
      // Dates are re-checked at completion; a draft may hold partial input but never an unusable period.
      return void send(response, problem(400, 'INVALID', 'The statement start date must be a valid date on or before the period end.'))
    }
    const stored = await store.get(id)
    if (stored?.status === 'completed') return void send(response, problem(409, 'COMPLETED', 'This reconciliation is completed. Reopen it, with a reason, before changing it.'))
    if ((stored?.version ?? 0) !== expectedVersion) return void send(response, problem(409, 'CONFLICT', 'This reconciliation changed elsewhere. Reload it before saving.'))
    const record: ReconciliationRecord = {
      ...editable, id, source: parts.source, clientId: parts.clientId, accountId: parts.accountId, periodEnd: parts.periodEnd,
      status: 'draft', version: expectedVersion + 1, createdAt: stored?.createdAt ?? iso(), updatedAt: iso(), history: stored?.history ?? [],
    }
    if (!(await store.put(record, expectedVersion))) return void send(response, problem(409, 'CONFLICT', 'This reconciliation changed elsewhere. Reload it before saving.'))
    response.json({ durable: store.durable, record })
  }))

  router.post('/:id/complete', guard(async (request, response) => {
    const id = String(request.params.id)
    const parts = parseId(id)
    const expectedVersion = request.body?.expectedVersion
    if (!parts || !Number.isInteger(expectedVersion)) return void send(response, problem(400, 'INVALID', 'A valid id and expected version are required.'))
    const stored = await store.get(id)
    if (!stored) return void send(response, problem(404, 'NOT_FOUND', 'Save the reconciliation before completing it.'))
    if (stored.status === 'completed') return void send(response, problem(409, 'COMPLETED', 'This reconciliation is already completed.'))
    if (stored.version !== expectedVersion) return void send(response, problem(409, 'CONFLICT', 'This reconciliation changed elsewhere. Reload it before completing.'))

    const completed = await earlierCompleted(stored)
    if (completed.some((other) => other.periodEnd >= stored.periodEnd)) return void send(response, problem(409, 'OUT_OF_ORDER', 'A later reconciliation for this account is already completed. Reopen it first.'))
    const previousRecord = completed[completed.length - 1]
    const previouslyClearedIds = new Set(completed.flatMap((other) => other.clearedIds))

    let completeness = stored.completeness
    let sourceTransactions: ReconTxn[] | undefined
    if (stored.source === 'quickbooks') {
      // QuickBooks is re-read now, so the saved snapshot and completeness flag cannot be forged or stale.
      let fresh
      try {
        fresh = await quickbooks.getReconciliationData(stored.accountId, stored.periodEnd)
      } catch (error) {
        console.error('[reconciliation] QuickBooks re-read failed:', error instanceof Error ? error.message : error)
        return void send(response, problem(502, 'SOURCE_UNAVAILABLE', 'QuickBooks could not be read, so the reconciliation was not completed.'))
      }
      completeness = fresh.completeness
      sourceTransactions = fresh.transactions
      const { eligible } = splitEligible(fresh.transactions, { periodStart: stored.periodStart, periodEnd: stored.periodEnd, previouslyClearedIds, hasPrevious: Boolean(previousRecord) })
      if (completeness.complete && !sameTransactions(eligible, stored.transactions)) {
        return void send(response, problem(409, 'DATA_CHANGED', 'The transactions in QuickBooks changed since you loaded them. Reload the data and review again.'))
      }
    }

    const validation = validateCompletion({ ...stored, completeness }, {
      previous: previousRecord ? previousFrom(previousRecord) : undefined,
      sourceTransactions,
      today: iso().slice(0, 10),
    })
    if (!validation.ok) {
      return void response.status(422).json({ error: 'The reconciliation cannot be completed yet.', code: 'NOT_COMPLETABLE', issues: validation.blocking.map((issue) => ({ code: issue.code, message: issue.message })) })
    }
    const at = iso()
    const record: ReconciliationRecord = {
      ...stored, completeness, status: 'completed', completedAt: at, completedBy: actor(request), updatedAt: at, version: stored.version + 1,
      result: summarizeResult(validation.computation),
      history: [...stored.history, { at, by: actor(request), action: 'completed', differenceCents: validation.computation.differenceCents }],
    }
    if (!(await store.put(record, stored.version))) return void send(response, problem(409, 'CONFLICT', 'This reconciliation changed elsewhere. Reload it before completing.'))
    response.json({ durable: store.durable, record })
  }))

  router.post('/:id/reopen', guard(async (request, response) => {
    const id = String(request.params.id)
    const parts = parseId(id)
    const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : ''
    const expectedVersion = request.body?.expectedVersion
    if (!parts || !Number.isInteger(expectedVersion)) return void send(response, problem(400, 'INVALID', 'A valid id and expected version are required.'))
    if (reason.length < 5 || reason.length > 500) return void send(response, problem(400, 'REASON_REQUIRED', 'Give a reason of at least 5 characters for reopening a completed reconciliation.'))
    const stored = await store.get(id)
    if (!stored) return void send(response, problem(404, 'NOT_FOUND', 'No saved reconciliation for this account and period.'))
    if (stored.status !== 'completed') return void send(response, problem(409, 'NOT_COMPLETED', 'Only a completed reconciliation can be reopened.'))
    if (stored.version !== expectedVersion) return void send(response, problem(409, 'CONFLICT', 'This reconciliation changed elsewhere. Reload it first.'))
    const completed = await earlierCompleted(stored)
    if (completed.some((other) => other.periodEnd > stored.periodEnd)) return void send(response, problem(409, 'OUT_OF_ORDER', 'A later reconciliation for this account is completed. Reopen the latest one first.'))
    const at = iso()
    const { completedAt, completedBy, result, ...rest } = stored
    const record: ReconciliationRecord = {
      ...rest, status: 'draft', updatedAt: at, version: stored.version + 1,
      history: [...stored.history, { at, by: actor(request), action: 'reopened', reason, differenceCents: result?.differenceCents }],
    }
    if (!(await store.put(record, stored.version))) return void send(response, problem(409, 'CONFLICT', 'This reconciliation changed elsewhere. Reload it first.'))
    response.json({ durable: store.durable, record })
  }))

  return router
}
