import { describe, expect, it } from 'vitest'
import { buildChecklist, validateClose, type MonthEndRecord, type Signoff } from './monthEnd'
import { buildDemoMonthEndRecords, buildDemoReconciliations, demoMonthEndInputs, demoUnusual, hasDemoBooks, SEED_USER } from './demoMonthEnd'
import { DEMO_CLIENT_ID } from './demoBooks'
import { parsePeriodKey } from './period'
import { previousFrom, validateCompletion, type ReconciliationRecord } from './reconciliation'

const seeds = buildDemoReconciliations()
const period = (key: string) => parsePeriodKey(key)!
const inputsFor = (key: string, over: { records?: ReconciliationRecord[]; signoffs?: MonthEndRecord['signoffs']; live?: Parameters<typeof demoMonthEndInputs>[1]['liveTransactions'] } = {}) =>
  demoMonthEndInputs(period(key), { records: over.records ?? seeds, signoffs: over.signoffs ?? {}, liveTransactions: over.live })
const checklistFor = (key: string, over: Parameters<typeof inputsFor>[1] = {}) => buildChecklist(inputsFor(key, over))
const byId = (key: string, id: string, over: Parameters<typeof inputsFor>[1] = {}) => checklistFor(key, over).items.find((item) => item.id === id)!

/** Signs off every step that asks for it, exactly as a bookkeeper would after reviewing the figures. */
const signAll = (key: string, over: Parameters<typeof inputsFor>[1] = {}) => {
  const signoffs: MonthEndRecord['signoffs'] = {}
  for (const item of checklistFor(key, over).items) {
    if (item.signoff?.allowed) signoffs[item.id as 'receivables'] = { by: 'pat@example.com', at: '2026-09-03T09:00:00.000Z', note: 'Reviewed', fingerprint: item.signoff.fingerprint, figures: item.signoff.figures } satisfies Signoff
  }
  return signoffs
}

describe('seeded demo reconciliations obey the real reconciliation rules', () => {
  it('every seeded reconciliation is balanced to the penny and passes the same completion check the server applies', () => {
    expect(seeds).toHaveLength(6)
    const completed: ReconciliationRecord[] = []
    for (const record of [...seeds].sort((left, right) => left.periodEnd.localeCompare(right.periodEnd))) {
      const previous = completed.filter((other) => other.accountId === record.accountId).slice(-1)[0]
      const verdict = validateCompletion({ ...record, status: 'draft' }, { previous: previous ? previousFrom(previous) : undefined, today: '2026-10-15' })
      expect(verdict.blocking.map((issue) => issue.message), `${record.accountName} ${record.periodEnd}`).toEqual([])
      expect(verdict.computation.differenceCents).toBe(0)
      completed.push(record)
    }
  })

  it('each month starts from the previous month ending balance, for both accounts', () => {
    for (const account of ['chase-checking', 'chase-card']) {
      const chain = seeds.filter((record) => record.accountId === account).sort((left, right) => left.periodEnd.localeCompare(right.periodEnd))
      expect(chain.map((record) => record.periodEnd)).toEqual(['2026-05-31', '2026-06-30', '2026-07-31'])
      expect(chain[1].beginningCents).toBe(chain[0].endingCents)
      expect(chain[2].beginningCents).toBe(chain[1].endingCents)
    }
    const july = seeds.find((record) => record.accountId === 'chase-checking' && record.periodEnd === '2026-07-31')!
    expect(july.endingCents).toBe(4_700_000)
    expect(seeds.find((record) => record.accountId === 'chase-card' && record.periodEnd === '2026-07-31')!.endingCents).toBe(552_420)
  })

  it('belong to the demo source and the demo client only', () => {
    expect(seeds.every((record) => record.source === 'demo' && record.clientId === DEMO_CLIENT_ID && record.id.startsWith(`demo:${DEMO_CLIENT_ID}:`))).toBe(true)
    expect(seeds.every((record) => record.completedBy === SEED_USER)).toBe(true)
  })
})

describe('scenario: a month ready to close (July 2026)', () => {
  it('passes every automatic check, needs the reviews signed off, and then can be closed', () => {
    const checklist = checklistFor('2026-07')
    for (const id of ['uncategorized', 'duplicates', 'missing-info', 'reconcile-bank', 'reconcile-card', 'unusual-balances']) expect(checklist.items.find((item) => item.id === id)!.status, id).toBe('Complete')
    for (const id of ['receivables', 'payables', 'statements']) expect(checklist.items.find((item) => item.id === id)!.status, id).toBe('Not Started')
    expect(checklist.readyToClose).toBe(false)
    const ready = demoMonthEndInputs(period('2026-07'), { records: seeds, signoffs: signAll('2026-07') })
    expect(buildChecklist(ready).readyToClose).toBe(true)
    const verdict = validateClose(ready)
    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.closing.reconciliations).toHaveLength(2)
      // The Riverside invoice is due Aug 27, so it is not overdue at July 31.
      expect(verdict.closing.exceptions).toEqual([])
    }
  })

  it('overdue items at the month end are recorded as remaining exceptions, not hidden', () => {
    const august = buildChecklist(inputsFor('2026-08', { signoffs: signAll('2026-08') }))
    expect(august.exceptions.join(' ')).toContain('1 overdue invoice totalling $2,840.00')
    expect(august.exceptions.join(' ')).toContain('overdue bill')
  })
})

describe('scenario: a month with unreconciled accounts (August 2026)', () => {
  it('no August reconciliation exists, so both reconciliation steps are Not Started and closing is blocked', () => {
    expect(byId('2026-08', 'reconcile-bank').status).toBe('Not Started')
    expect(byId('2026-08', 'reconcile-card').status).toBe('Not Started')
    expect(byId('2026-08', 'approval').status).toBe('Blocked')
    expect(validateClose(inputsFor('2026-08', { signoffs: signAll('2026-08') })).ok).toBe(false)
  })

  it('a completed August bank reconciliation updates the checklist; a reopened one takes it back', () => {
    const checking = seeds.filter((record) => record.accountId === 'chase-checking').find((record) => record.periodEnd === '2026-07-31')!
    const august = { ...checking, id: 'demo:abc-plumbing:chase-checking:2026-08-31', periodEnd: '2026-08-31', periodStart: '2026-08-01', statementDate: '2026-08-31', beginningCents: 4_700_000, endingCents: 4_842_172, result: undefined, history: [] }
    expect(byId('2026-08', 'reconcile-bank', { records: [...seeds, august] }).status).toBe('Complete')
    const reopened: ReconciliationRecord = { ...august, status: 'draft', completedAt: undefined, completedBy: undefined, history: [{ at: '2026-09-09T00:00:00.000Z', by: 'pat', action: 'reopened', reason: 'Bank corrected the Shell charge' }] }
    const item = byId('2026-08', 'reconcile-bank', { records: [...seeds, reopened] })
    expect(item.status).toBe('In Progress')
    expect(item.details.join(' ')).toContain('Bank corrected the Shell charge')
  })

  it('flags money sitting in Undeposited Funds as an unusual balance to confirm', () => {
    expect(demoUnusual(period('2026-08')).findings.join(' ')).toContain('Undeposited Funds: $400.00')
  })
})

describe('scenario: a month with missing transaction information (June 2026)', () => {
  it('shows what is missing, blocks completion of the information step, and does not offer to accept a missing payee', () => {
    expect(byId('2026-06', 'uncategorized').status).toBe('In Progress')
    expect(byId('2026-06', 'uncategorized').attention).toBe('1 transaction still needs a category.')
    expect(byId('2026-06', 'duplicates').status).toBe('Not Started')
    const info = byId('2026-06', 'missing-info')
    expect(info.status).toBe('In Progress')
    expect(info.attention).toContain('1 transaction has no payee')
    expect(info.attention).toContain('1 client question is still open')
    expect(info.signoff?.allowed).toBe(false)
    expect(checklistFor('2026-06').readyToClose).toBe(false)
  })

  it('the uncategorized charge also shows up as an unusual balance for that month only', () => {
    expect(demoUnusual(period('2026-06')).findings.join(' ')).toContain('Uncategorized Expense: $150.00')
    expect(demoUnusual(period('2026-07')).findings).toEqual([])
  })
})

describe('scenario: a reopened month (May 2026)', () => {
  const [record] = buildDemoMonthEndRecords()

  it('was closed, then reopened with a reason that is kept in its history', () => {
    expect(record).toMatchObject({ id: `demo:${DEMO_CLIENT_ID}:2026-05`, status: 'open', period: '2026-05' })
    expect(record.closing).toBeUndefined()
    expect(record.history.map((event) => event.action)).toEqual(['closed', 'reopened'])
    expect(record.history[1].reason).toContain('corrected May bank statement')
  })

  it('its earlier reviews still apply while the figures are unchanged, so it can be approved again', () => {
    const checklist = checklistFor('2026-05', { signoffs: record.signoffs })
    expect(checklist.readyToClose).toBe(true)
    expect(checklist.items.find((item) => item.id === 'approval')!.status).toBe('Not Started')
  })

  it('and loses them the moment a figure they rested on changes', () => {
    const tampered = { ...record.signoffs, statements: { ...record.signoffs.statements!, fingerprint: 'stmt:1:1' } }
    expect(byId('2026-05', 'statements', { signoffs: tampered }).status).toBe('In Progress')
  })
})

describe('demo books never invent data for other months', () => {
  it('September has no demo books, so every step is Blocked and nothing is complete', () => {
    expect(hasDemoBooks(period('2026-09'))).toBe(false)
    expect(hasDemoBooks(period('2026-04'))).toBe(false)
    const checklist = checklistFor('2026-09')
    expect(checklist.items.filter((item) => item.id !== 'approval').every((item) => item.status === 'Blocked')).toBe(true)
    expect(checklist.completeCount).toBe(0)
    expect(checklist.items[0].attention).toContain('only cover May to August 2026')
  })
})

describe('live demo transactions replace the scenario figures for the month they belong to', () => {
  it('uses the supplied counts, and a live problem blocks the month', () => {
    const live = { total: 17, uncategorized: 3, possibleDuplicates: 0, missingReceipts: 1, missingPayees: 0, openClientRequests: 0 }
    expect(byId('2026-08', 'uncategorized', { live }).attention).toBe('3 transactions still need a category.')
    expect(byId('2026-08', 'uncategorized', { live: { ...live, uncategorized: 0 } }).status).toBe('Complete')
  })
})
