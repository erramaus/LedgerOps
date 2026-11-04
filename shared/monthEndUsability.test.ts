import { describe, expect, it } from 'vitest'
import { buildChecklist, known, progressCounts, unknown, type MonthEndInputs, type OpenItemFacts, type Signoff } from './monthEnd'

const END = '2026-08-31'
const done = (accountId: string, kind: 'bank' | 'credit_card') => ({ accountId, name: accountId, kind, record: { id: `demo:c:${accountId}:${END}`, status: 'completed' as const, periodEnd: END, version: 2, completedAt: '2026-09-02T10:00:00.000Z', completedBy: 'pat@example.com', differenceCents: 0 } })
const ar: OpenItemFacts = { totalCents: 842_000, itemCount: 4, overdueCount: 1, overdueCents: 284_000, reportVerified: true, reportProblems: [], asOf: END, unit: 'invoice' }
const clean = { total: 20, uncategorized: 0, possibleDuplicates: 0, missingReceipts: 0, missingPayees: 0, openClientRequests: 0 }
const base = (over: Partial<MonthEndInputs> = {}): MonthEndInputs => ({
  period: '2026-08',
  transactions: known(clean),
  bankAccounts: known([done('chk', 'bank')]),
  cardAccounts: known([done('card', 'credit_card')]),
  receivables: known(ar),
  payables: known({ ...ar, totalCents: 255_644, overdueCount: 0, overdueCents: 0, unit: 'bill' }),
  unusual: known({ accountsChecked: 18, findings: [] }),
  statements: known({ netIncomeCents: 414_918, totalAssetsCents: 6_884_172, failed: [], unavailable: [] }),
  signoffs: {},
  ...over,
})
const item = (inputs: MonthEndInputs, id: string) => buildChecklist(inputs).items.find((candidate) => candidate.id === id)!
const signedFor = (id: string, inputs: MonthEndInputs): Signoff => ({ by: 'pat@example.com', at: '2026-09-03T09:00:00.000Z', note: 'ok', fingerprint: item(inputs, id).signoff!.fingerprint, figures: item(inputs, id).signoff!.figures })

describe('progress counts', () => {
  it('count the nine required checks by status and leave the final approval out', () => {
    const counts = progressCounts(buildChecklist(base()))
    expect(counts.required).toBe(9)
    expect(counts.Complete + counts['In Progress'] + counts['Not Started'] + counts.Blocked).toBe(9)
    // Everything automatic is complete; the three reviews (receivables, payables, statements) have not been done.
    expect(counts).toMatchObject({ Complete: 6, 'Not Started': 3, 'In Progress': 0, Blocked: 0 })
  })

  it('show unavailable information as Blocked, never as complete or zero', () => {
    const counts = progressCounts(buildChecklist(base({ receivables: unknown('QuickBooks could not be read.'), transactions: unknown('Not loaded.') })))
    expect(counts.Blocked).toBe(4)
    expect(counts.Complete).toBe(3)
  })

  it('count a partly finished step as In Progress', () => {
    const counts = progressCounts(buildChecklist(base({ transactions: known({ ...clean, uncategorized: 3 }) })))
    expect(counts['In Progress']).toBe(1)
  })
})

describe('review confirmation details', () => {
  it('receivables show the as-of date, the exception being accepted and require a note because of it', () => {
    const step = item(base(), 'receivables')
    expect(step.attention).toContain('as of 2026-08-31')
    expect(step.signoff).toMatchObject({ noteRequired: true, asOf: END })
    expect(step.signoff!.exceptions).toEqual(['1 overdue invoice totalling $2,840.00 as of 2026-08-31.'])
  })

  it('a review with no exception needs no note', () => {
    const step = item(base(), 'payables')
    expect(step.signoff).toMatchObject({ noteRequired: false, exceptions: [] })
    expect(item(base(), 'statements').signoff).toMatchObject({ noteRequired: false, exceptions: [] })
  })

  it('unusual balances and duplicates always list what is being accepted and need a note', () => {
    const unusual = item(base({ unusual: known({ accountsChecked: 18, findings: ['Accounts Receivable has a credit balance.'] }) }), 'unusual-balances')
    expect(unusual.signoff).toMatchObject({ noteRequired: true, exceptions: ['Accounts Receivable has a credit balance.'] })
    const duplicates = item(base({ transactions: known({ ...clean, possibleDuplicates: 2 }) }), 'duplicates')
    expect(duplicates.signoff).toMatchObject({ noteRequired: true, exceptions: ['2 possible duplicates'] })
  })

  it('today figures are shown beside the month-end figures but are not part of the review fingerprint', () => {
    const withToday = base({ receivables: known({ ...ar, today: { date: '2026-10-15', totalCents: 700_000, itemCount: 3, overdueCount: 2, overdueCents: 500_000 } }) })
    const step = item(withToday, 'receivables')
    expect(step.details.join(' ')).toContain('Today (2026-10-15) on the Receivables tab: 3 open invoices totalling $7,000.00, 2 overdue ($5,000.00)')
    expect(step.attention).toContain('as of 2026-08-31')
    expect(step.signoff!.fingerprint).toBe(item(base(), 'receivables').signoff!.fingerprint)
  })

  it('a review recorded for earlier figures goes stale when the figures change, whatever the note says', () => {
    const first = base()
    const reviewed = base({ signoffs: { receivables: signedFor('receivables', first) } })
    expect(item(reviewed, 'receivables').status).toBe('Complete')
    const changed = base({ signoffs: reviewed.signoffs, receivables: known({ ...ar, totalCents: 900_000 }) })
    expect(item(changed, 'receivables')).toMatchObject({ status: 'In Progress', signoff: { stale: true } })
  })

  it('a review never overrides a blocking control: unreconciled accounts keep approval blocked', () => {
    const first = base()
    const signoffs = { receivables: signedFor('receivables', first), payables: signedFor('payables', first), statements: signedFor('statements', first) }
    const blocked = buildChecklist(base({ signoffs, bankAccounts: known([{ accountId: 'chk', name: 'chk', kind: 'bank' as const }]) }))
    expect(blocked.readyToClose).toBe(false)
    expect(blocked.items.find((candidate) => candidate.id === 'approval')!.status).toBe('Blocked')
    expect(blocked.blockers.join(' ')).toContain('Reconcile all bank accounts')
  })
})
