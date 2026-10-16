import crypto from 'node:crypto'
import express, { type Response } from 'express'
import { validateLedger } from '../shared/accounting.js'
import { DEMO_CLIENT_ID, DEMO_RECONCILIATION_ACCOUNTS, demoLedger } from '../shared/demoBooks.js'
import { ADDITIONAL_DEMO_CLIENT_IDS, getAdditionalDemoCompany } from '../shared/demoCompanyBooks.js'
import {
  ENTRY_TYPE_LABELS, activeRevision, createRecord, editRecord, findPossibleDuplicates, mergedLedger, reverseRecord, validateEntryInput,
  type DemoEntryInput, type DemoEntryRecord, type EntryType,
} from '../shared/demoEntries.js'
import { monthEndId } from '../shared/monthEnd.js'
import { monthLabel, parsePeriodKey } from '../shared/period.js'
import type { MonthEndStore } from './monthEndStore.js'
import type { ReconciliationStore } from './reconciliationStore.js'
import type { DemoEntryStore } from './demoEntryStore.js'

type Problem = { status: number; code: string; error: string; extra?: Record<string, unknown> }
const problem = (status: number, code: string, error: string, extra?: Record<string, unknown>): Problem => ({ status, code, error, extra })
const isProblem = (value: unknown): value is Problem => typeof value === 'object' && value !== null && 'code' in value && 'status' in value && 'error' in value

const TYPES = Object.keys(ENTRY_TYPE_LABELS) as EntryType[]
const text = (value: unknown, max: number) => (typeof value === 'string' && value.length <= max ? value : null)

/** Reads only the fields a person may supply; anything else in the request is ignored. */
function readInput(value: unknown, clientId = DEMO_CLIENT_ID): DemoEntryInput | Problem {
  const body = (value ?? {}) as Record<string, unknown>
  const accountId = text(body.accountId, 40), date = text(body.date, 10), payee = text(body.payee, 200), categoryId = text(body.categoryId, 40), memo = text(body.memo ?? '', 600)
  const type = TYPES.find((candidate) => candidate === body.type)
  const amountCents = typeof body.amountCents === 'number' ? body.amountCents : NaN
  if (accountId === null || date === null || payee === null || categoryId === null || memo === null || !type || !Number.isFinite(amountCents)) return problem(400, 'INVALID', 'The transaction details are not valid.')
  const input: DemoEntryInput = { accountId, type, date, payee, amountCents, categoryId, memo }
  const fields = validateEntryInput(input, undefined, clientId)
  return Object.keys(fields).length > 0 ? problem(400, 'INVALID', Object.values(fields)[0] as string, { fields }) : input
}

/**
 * Manually entered DEMO transactions. These exist only in LedgerOps' demo books: nothing here can reach QuickBooks.
 * The server, not the browser, decides whether a change is allowed: closed months, reconciled periods and duplicates.
 */
export function createDemoEntryRouter(deps: { store: DemoEntryStore; reconciliations: ReconciliationStore; monthEnd: MonthEndStore; now: () => number }) {
  const { store, reconciliations, monthEnd, now } = deps
  const router = express.Router()
  const iso = () => new Date(now()).toISOString()
  const actor = (request: express.Request) => request.session?.user?.email ?? 'unknown'
  const send = (response: Response, failure: Problem) => response.status(failure.status).json({ error: failure.error, code: failure.code, ...failure.extra })
  const guard = (handler: (request: express.Request, response: Response) => Promise<void>): express.RequestHandler => async (request, response) => {
    try {
      await handler(request, response)
    } catch (error) {
      console.error('[demo entries] request failed:', error instanceof Error ? error.message : error)
      send(response, problem(500, 'UNEXPECTED', 'The transaction could not be saved. Nothing was changed.'))
    }
  }

  const demoOnly = (clientId: unknown): Problem | null =>
    clientId === DEMO_CLIENT_ID || (typeof clientId === 'string' && ADDITIONAL_DEMO_CLIENT_IDS.includes(clientId)) ? null : problem(422, 'NO_BOOKS', 'Detailed demo books exist only for the five listed demo companies.')
  const ledgerFor = (clientId: string) => getAdditionalDemoCompany(clientId)?.ledger ?? demoLedger
  const accountFor = (clientId: string, accountId: string) => clientId === DEMO_CLIENT_ID
    ? DEMO_RECONCILIATION_ACCOUNTS.find((account) => account.id === accountId)
    : getAdditionalDemoCompany(clientId)?.reconciliationAccounts.find((account) => account.id === accountId)

  /** Rules that depend on other records: the books for this month must be open and the account not yet reconciled past the date. */
  const checkDate = async (clientId: string, accountId: string, date: string): Promise<Problem | null> => {
    const month = date.slice(0, 7)
    const closed = await monthEnd.get(monthEndId('demo', clientId, month))
    if (closed?.status === 'closed') return problem(409, 'PERIOD_CLOSED', `${monthLabel(parsePeriodKey(month)!)} is closed. Reopen the month in Month End, with a reason, before changing its books.`)
    const reconciled = (await reconciliations.list({ source: 'demo', clientId })).find((record) => record.accountId === accountId && record.status === 'completed' && record.periodEnd >= date)
    if (reconciled) {
      const name = accountFor(clientId, accountId)?.name ?? 'This account'
      return problem(409, 'ACCOUNT_RECONCILED', `${name} is reconciled through ${reconciled.periodEnd}. Reopen that reconciliation, with a reason, before changing its books.`)
    }
    return null
  }

  const duplicateCheck = (clientId: string, input: DemoEntryInput, records: DemoEntryRecord[], confirmed: boolean, excludeEntryId?: string): Problem | null => {
    if (confirmed) return null
    const matches = findPossibleDuplicates(input, records.filter((record) => record.status === 'active'), excludeEntryId, clientId)
    return matches.length === 0 ? null : problem(409, 'POSSIBLE_DUPLICATE', `This looks like a transaction that is already recorded: ${matches.map((match) => `${match.payee} on ${match.date}`).join('; ')}. If it really is a separate transaction, confirm that and save again.`, { matches })
  }

  const ledgerStaysValid = (clientId: string, records: DemoEntryRecord[]): Problem | null => {
    const merged = mergedLedger(records, ledgerFor(clientId), clientId)
    return validateLedger(merged.accounts, merged.entries).length === 0 ? null : problem(500, 'UNBALANCED', 'This change would leave the ledger out of balance, so it was not saved.')
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
    const clientId = body.clientId as string
    const input = readInput(body.input, clientId)
    if (isProblem(input)) return void send(response, input)
    const blocked = await checkDate(clientId, input.accountId, input.date)
    if (blocked) return void send(response, blocked)
    const existing = await store.list(clientId)
    const duplicate = duplicateCheck(clientId, input, existing, body.confirmedNotDuplicate === true)
    if (duplicate) return void send(response, duplicate)
    const record = createRecord(`entry-${crypto.randomBytes(6).toString('hex')}`, clientId, input, actor(request), iso())
    const unbalanced = ledgerStaysValid(clientId, [...existing, record])
    if (unbalanced) return void send(response, unbalanced)
    if (!(await store.put(record, 0))) return void send(response, problem(409, 'CONFLICT', 'That transaction could not be saved. Try again.'))
    response.status(201).json({ durable: store.durable, record })
  }))

  /** Loads an active record this client owns, or says why it cannot be changed. */
  const loadActive = async (id: string, expectedVersion: unknown): Promise<DemoEntryRecord | Problem> => {
    const stored = await store.get(id)
    if (!stored) return problem(404, 'NOT_FOUND', 'That transaction could not be found.')
    if (stored.status !== 'active') return problem(409, 'ALREADY_REVERSED', 'That transaction was already reversed.')
    if (!Number.isInteger(expectedVersion) || stored.version !== expectedVersion) return problem(409, 'CONFLICT', 'That transaction changed elsewhere. Reload it before making changes.')
    return stored
  }
  const reasonOf = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

  router.post('/:id/edit', guard(async (request, response) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    const reason = reasonOf(body.reason)
    if (reason.length < 5 || reason.length > 1000) return void send(response, problem(400, 'REASON_REQUIRED', 'Give a reason for the change. It is kept in the history.'))
    const stored = await loadActive(String(request.params.id), body.expectedVersion)
    if (isProblem(stored)) return void send(response, stored)
    const input = readInput(body.input, stored.clientId)
    if (isProblem(input)) return void send(response, input)
    const previous = activeRevision(stored)!
    for (const [accountId, date] of [[previous.accountId, previous.date], [input.accountId, input.date]] as const) {
      const blocked = await checkDate(stored.clientId, accountId, date)
      if (blocked) return void send(response, blocked)
    }
    const others = (await store.list(stored.clientId)).filter((record) => record.id !== stored.id)
    const duplicate = duplicateCheck(stored.clientId, input, others, body.confirmedNotDuplicate === true)
    if (duplicate) return void send(response, duplicate)
    const next = editRecord(stored, input, actor(request), iso(), reason)
    const unbalanced = ledgerStaysValid(stored.clientId, [...others, next])
    if (unbalanced) return void send(response, unbalanced)
    if (!(await store.put(next, stored.version))) return void send(response, problem(409, 'CONFLICT', 'That transaction changed elsewhere. Reload it before making changes.'))
    response.json({ durable: store.durable, record: next })
  }))

  router.post('/:id/reverse', guard(async (request, response) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    const reason = reasonOf(body.reason)
    if (reason.length < 5 || reason.length > 1000) return void send(response, problem(400, 'REASON_REQUIRED', 'Give a reason for reversing it. It is kept in the history.'))
    const stored = await loadActive(String(request.params.id), body.expectedVersion)
    if (isProblem(stored)) return void send(response, stored)
    const previous = activeRevision(stored)!
    const blocked = await checkDate(stored.clientId, previous.accountId, previous.date)
    if (blocked) return void send(response, blocked)
    const next = reverseRecord(stored, actor(request), iso(), reason)
    const others = (await store.list(stored.clientId)).filter((record) => record.id !== stored.id)
    const unbalanced = ledgerStaysValid(stored.clientId, [...others, next])
    if (unbalanced) return void send(response, unbalanced)
    if (!(await store.put(next, stored.version))) return void send(response, problem(409, 'CONFLICT', 'That transaction changed elsewhere. Reload it before making changes.'))
    response.json({ durable: store.durable, record: next })
  }))

  return router
}
