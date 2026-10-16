import express, { type Response } from 'express'
import { DEMO_CLIENT_ID, DEMO_RECONCILIATION_ACCOUNTS } from '../shared/demoBooks.js'
import { hasDemoBooks } from '../shared/demoMonthEnd.js'
import {
  MONTH_END_ID_PATTERN,
  NOTE_REQUIRED_STEPS,
  SIGNOFF_STEPS,
  STEP_ORDER,
  STEP_TITLES,
  isSignoffStep,
  type ClosedItem,
  type MonthEndRecord,
  type Source,
} from '../shared/monthEnd.js'
import { parsePeriodKey, periodEnd } from '../shared/period.js'
import type { ReconciliationStore } from './reconciliationStore.js'
import type { MonthEndStore } from './monthEndStore.js'

type Problem = { status: number; code: string; error: string }
const problem = (status: number, code: string, error: string): Problem => ({ status, code, error })

export type AccountLister = { getAccounts(): Promise<{ quickBooksId?: string; name: string; accountType: string; active: boolean }[]> }

const text = (value: unknown, max: number) => (typeof value === 'string' && value.length <= max ? value : null)

function parseId(id: string) {
  if (!MONTH_END_ID_PATTERN.test(id)) return null
  const [source, clientId, period] = id.split(':')
  const parsed = parsePeriodKey(period)
  return parsed ? { source: source as Source, clientId, period, end: periodEnd(parsed) } : null
}

/**
 * Month-end records are LedgerOps' own: nothing here reads a QuickBooks transaction or writes anything to
 * QuickBooks. Closing re-checks every reconciliation against the reconciliation store, so the browser cannot
 * claim a reconciliation that does not exist.
 */
export function createMonthEndRouter(deps: { store: MonthEndStore; reconciliations: ReconciliationStore; quickbooks: AccountLister; now: () => number }) {
  const { store, reconciliations, quickbooks, now } = deps
  const router = express.Router()
  const iso = () => new Date(now()).toISOString()
  const send = (response: Response, failure: Problem) => response.status(failure.status).json({ error: failure.error, code: failure.code })
  const actor = (request: express.Request) => request.session?.user?.email ?? 'unknown'

  const guard = (handler: (request: express.Request, response: Response) => Promise<void>): express.RequestHandler => async (request, response) => {
    try {
      await handler(request, response)
    } catch (error) {
      console.error('[month end] request failed:', error instanceof Error ? error.message : error)
      send(response, problem(500, 'UNEXPECTED', 'The month-end record could not be processed. Nothing was changed.'))
    }
  }

  router.get('/storage', (_request, response) => {
    response.json({
      durable: store.durable,
      description: store.durable
        ? 'Month-end records are saved in the LedgerOps database.'
        : 'Temporary local development records. They are lost when the server restarts. Set DATABASE_URL for durable storage.',
    })
  })

  router.get('/', guard(async (request, response) => {
    const source = request.query.source, clientId = request.query.clientId
    if ((source !== 'demo' && source !== 'quickbooks') || typeof clientId !== 'string' || !/^[\w-]{1,60}$/.test(clientId)) return void send(response, problem(400, 'INVALID', 'A source and client are required.'))
    response.json({ durable: store.durable, records: await store.list({ source, clientId }) })
  }))

  router.get('/:id', guard(async (request, response) => {
    const id = String(request.params.id)
    if (!parseId(id)) return void send(response, problem(400, 'INVALID', 'Invalid month-end id.'))
    const record = await store.get(id)
    if (!record) return void send(response, problem(404, 'NOT_FOUND', 'No month-end record for this client and month yet.'))
    response.json({ durable: store.durable, record })
  }))

  /** Loads the record or starts a new open one (only at version 0). */
  const loadForUpdate = async (id: string, expectedVersion: unknown, clientName?: string): Promise<{ record: MonthEndRecord; isNew: boolean } | Problem> => {
    const parts = parseId(id)
    if (!parts || !Number.isInteger(expectedVersion) || (expectedVersion as number) < 0) return problem(400, 'INVALID', 'A valid id and expected version are required.')
    const stored = await store.get(id)
    if ((stored?.version ?? 0) !== expectedVersion) return problem(409, 'CONFLICT', 'This month-end record changed elsewhere. Reload it before making changes.')
    if (stored) return { record: stored, isNew: false }
    if (!clientName) return problem(404, 'NOT_FOUND', 'There is no month-end record for this month yet.')
    const at = iso()
    return { record: { id, source: parts.source, clientId: parts.clientId, clientName, period: parts.period, status: 'open', version: 0, createdAt: at, updatedAt: at, signoffs: {}, history: [] }, isNew: true }
  }
  const isProblem = (value: unknown): value is Problem => typeof value === 'object' && value !== null && 'code' in value && 'status' in value && !('signoffs' in value)

  router.post('/:id/signoff', guard(async (request, response) => {
    const id = String(request.params.id)
    const { step, note, fingerprint, figures, clientName, expectedVersion } = (request.body ?? {}) as Record<string, unknown>
    const cleanNote = text(note, 1000)?.trim() ?? null, cleanFingerprint = text(fingerprint, 300), cleanFigures = text(figures, 400), name = text(clientName, 200)
    if (!isSignoffStep(step) || cleanNote === null || !cleanFingerprint || !cleanFigures || !name) return void send(response, problem(400, 'INVALID', 'The review details are not valid.'))
    if (NOTE_REQUIRED_STEPS.includes(step) && cleanNote.length < 5) return void send(response, problem(400, 'NOTE_REQUIRED', 'Explain why this is acceptable. The note is kept with the month-end record.'))
    const loaded = await loadForUpdate(id, expectedVersion, name)
    if (isProblem(loaded)) return void send(response, loaded)
    const { record } = loaded
    if (record.status === 'closed') return void send(response, problem(409, 'CLOSED', 'This month is closed. Reopen it, with a reason, before changing a review.'))
    const at = iso(), by = actor(request)
    const next: MonthEndRecord = {
      ...record, version: record.version + 1, updatedAt: at,
      signoffs: { ...record.signoffs, [step]: { by, at, note: cleanNote, fingerprint: cleanFingerprint, figures: cleanFigures } },
      history: [...record.history, { at, by, action: 'signed_off', step, note: cleanNote || undefined }],
    }
    if (!(await store.put(next, record.version))) return void send(response, problem(409, 'CONFLICT', 'This month-end record changed elsewhere. Reload it before making changes.'))
    response.json({ durable: store.durable, record: next })
  }))

  router.post('/:id/clear-signoff', guard(async (request, response) => {
    const id = String(request.params.id)
    const { step, expectedVersion } = (request.body ?? {}) as Record<string, unknown>
    if (!isSignoffStep(step)) return void send(response, problem(400, 'INVALID', 'The review step is not valid.'))
    const loaded = await loadForUpdate(id, expectedVersion)
    if (isProblem(loaded)) return void send(response, loaded)
    const { record } = loaded
    if (record.status === 'closed') return void send(response, problem(409, 'CLOSED', 'This month is closed. Reopen it, with a reason, before changing a review.'))
    if (!record.signoffs[step]) return void send(response, problem(404, 'NOT_FOUND', 'There is no recorded review for that step.'))
    const { [step]: _removed, ...rest } = record.signoffs
    const at = iso()
    const next: MonthEndRecord = { ...record, version: record.version + 1, updatedAt: at, signoffs: rest, history: [...record.history, { at, by: actor(request), action: 'signoff_cleared', step }] }
    if (!(await store.put(next, record.version))) return void send(response, problem(409, 'CONFLICT', 'This month-end record changed elsewhere. Reload it before making changes.'))
    response.json({ durable: store.durable, record: next })
  }))

  router.post('/:id/close', guard(async (request, response) => {
    const id = String(request.params.id)
    const parts = parseId(id)
    const body = (request.body ?? {}) as Record<string, unknown>
    const loaded = await loadForUpdate(id, body.expectedVersion)
    if (isProblem(loaded) || !parts) return void send(response, isProblem(loaded) ? loaded : problem(400, 'INVALID', 'Invalid month-end id.'))
    const { record } = loaded
    if (loaded.isNew) return void send(response, problem(404, 'NOT_FOUND', 'Review the month before closing it.'))
    if (record.status === 'closed') return void send(response, problem(409, 'CLOSED', 'This month is already closed.'))
    const at = iso()
    if (parts.end >= at.slice(0, 10)) return void send(response, problem(422, 'PERIOD_NOT_ENDED', 'This month has not ended yet, so it cannot be closed.'))
    if (parts.source === 'demo' && (parts.clientId !== DEMO_CLIENT_ID || !hasDemoBooks(parsePeriodKey(parts.period)!))) {
      return void send(response, problem(422, 'NO_BOOKS', 'There are no demo books for this client and month, so it cannot be closed.'))
    }

    // The checklist the user saw: every one of the nine steps must be present and Complete.
    const claimed = Array.isArray(body.checklist) ? (body.checklist as Record<string, unknown>[]) : null
    const required = STEP_ORDER.filter((step) => step !== 'approval')
    if (!claimed || claimed.length !== required.length || claimed.some((item, index) => item?.id !== required[index] || item?.status !== 'Complete')) {
      return void send(response, problem(422, 'NOT_COMPLETABLE', 'Every checklist step must be complete before the month can be closed.'))
    }
    const checklist: ClosedItem[] = []
    for (const [index, item] of claimed.entries()) {
      const evidence = Array.isArray(item.evidence) && item.evidence.length <= 10 && item.evidence.every((line) => text(line, 800) !== null) ? (item.evidence as string[]) : null
      if (!evidence || evidence.length === 0) return void send(response, problem(422, 'NOT_COMPLETABLE', `${STEP_TITLES[required[index]]} has no completion evidence.`))
      checklist.push({ id: required[index], number: index + 1, title: STEP_TITLES[required[index]], status: 'Complete', evidence })
    }
    // Reviews that people sign must really be on record, and must be the ones the checklist relied on.
    for (const step of SIGNOFF_STEPS) {
      const relied = checklist.find((item) => item.id === step)!.evidence.some((line) => line.startsWith('Reviewed by'))
      if (relied && !record.signoffs[step]) return void send(response, problem(422, 'NOT_COMPLETABLE', `${STEP_TITLES[step]} was not signed off.`))
    }
    for (const step of ['receivables', 'payables', 'statements'] as const) {
      if (!record.signoffs[step]) return void send(response, problem(422, 'NOT_COMPLETABLE', `${STEP_TITLES[step]} must be reviewed and signed off.`))
    }
    const exceptions = Array.isArray(body.exceptions) && body.exceptions.length <= 50 && body.exceptions.every((line) => text(line, 500) !== null) ? (body.exceptions as string[]) : null
    if (!exceptions) return void send(response, problem(400, 'INVALID', 'The remaining exceptions are not valid.'))

    // Reconciliation is verified here, from the reconciliation store, never taken from the browser.
    let required_accounts: { id: string; name: string }[]
    if (parts.source === 'demo') {
      required_accounts = DEMO_RECONCILIATION_ACCOUNTS.map((account) => ({ id: account.id, name: account.name }))
    } else {
      let accounts
      try {
        accounts = await quickbooks.getAccounts()
      } catch (error) {
        console.error('[month end] QuickBooks account read failed:', error instanceof Error ? error.message : error)
        return void send(response, problem(502, 'SOURCE_UNAVAILABLE', 'QuickBooks could not be read, so the month was not closed.'))
      }
      required_accounts = accounts.filter((account) => account.active && account.quickBooksId && (account.accountType === 'Bank' || account.accountType === 'Credit Card')).map((account) => ({ id: account.quickBooksId!, name: account.name }))
    }
    const saved = await reconciliations.list({ source: parts.source, clientId: parts.clientId })
    const relied: NonNullable<MonthEndRecord['closing']>['reconciliations'] = []
    for (const account of required_accounts) {
      const match = saved.find((candidate) => candidate.accountId === account.id && candidate.periodEnd === parts.end)
      if (!match || match.status !== 'completed' || (match.result?.differenceCents ?? 1) !== 0) {
        return void send(response, problem(422, 'NOT_COMPLETABLE', `${account.name} does not have a completed reconciliation ending ${parts.end}.`))
      }
      relied.push({ accountId: account.id, accountName: account.name, recordId: match.id, version: match.version, completedAt: match.completedAt })
    }
    const next: MonthEndRecord = {
      ...record, status: 'closed', version: record.version + 1, updatedAt: at,
      closing: { closedAt: at, closedBy: actor(request), checklist, exceptions, reconciliations: relied },
      history: [...record.history, { at, by: actor(request), action: 'closed' }],
    }
    if (!(await store.put(next, record.version))) return void send(response, problem(409, 'CONFLICT', 'This month-end record changed elsewhere. Reload it before closing.'))
    response.json({ durable: store.durable, record: next })
  }))

  router.post('/:id/reopen', guard(async (request, response) => {
    const id = String(request.params.id)
    const body = (request.body ?? {}) as Record<string, unknown>
    const reason = text(body.reason, 1000)?.trim() ?? ''
    if (reason.length < 5) return void send(response, problem(400, 'REASON_REQUIRED', 'Give a reason for reopening this month. It is kept in the history.'))
    const loaded = await loadForUpdate(id, body.expectedVersion)
    if (isProblem(loaded)) return void send(response, loaded)
    const { record } = loaded
    if (loaded.isNew || record.status !== 'closed') return void send(response, problem(409, 'NOT_CLOSED', 'This month is not closed.'))
    const at = iso()
    const { closing: _closing, ...rest } = record
    // Reviews stay on record; any whose figures change stop counting by themselves.
    const next: MonthEndRecord = { ...rest, status: 'open', version: record.version + 1, updatedAt: at, history: [...record.history, { at, by: actor(request), action: 'reopened', reason }] }
    if (!(await store.put(next, record.version))) return void send(response, problem(409, 'CONFLICT', 'This month-end record changed elsewhere. Reload it before reopening.'))
    response.json({ durable: store.durable, record: next })
  }))

  return router
}
