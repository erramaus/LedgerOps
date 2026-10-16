import { describe, expect, it } from 'vitest'
import { buildChecklist, completionPercent, known, unknown, validateClose, type AccountRecon, type MonthEndInputs, type OpenItemFacts, type Signoff, type TransactionFacts } from './monthEnd'
import { reconFactsFor, unusualBalances, type ReconRecordLike } from './monthEndFacts'

const END = '2026-08-31'
const clean: TransactionFacts = { total: 20, uncategorized: 0, possibleDuplicates: 0, missingReceipts: 0, missingPayees: 0, openClientRequests: 0 }
const done = (accountId: string, name: string, kind: 'bank' | 'credit_card'): AccountRecon => ({ accountId, name, kind, record: { id: `demo:c:${accountId}:${END}`, status: 'completed', periodEnd: END, version: 2, completedAt: '2026-09-02T10:00:00.000Z', completedBy: 'pat@example.com', differenceCents: 0 } })
const openItems: OpenItemFacts = { totalCents: 842_000, itemCount: 4, overdueCount: 1, overdueCents: 284_000, reportVerified: true, reportProblems: [] }
const signed = (fingerprint: string, figures: string, note = ''): Signoff => ({ by: 'pat@example.com', at: '2026-09-03T09:00:00.000Z', note, fingerprint, figures })

const base = (override: Partial<MonthEndInputs> = {}): MonthEndInputs => ({
  period: '2026-08',
  transactions: known(clean),
  bankAccounts: known([done('chk', 'Checking', 'bank')]),
  cardAccounts: known([done('card', 'Card', 'credit_card')]),
  receivables: known(openItems),
  payables: known({ ...openItems, totalCents: 255_644, itemCount: 4, overdueCount: 0, overdueCents: 0 }),
  unusual: known({ accountsChecked: 18, findings: [] }),
  statements: known({ netIncomeCents: 414_918, totalAssetsCents: 6_884_172, failed: [], unavailable: [] }),
  signoffs: {},
  ...override,
})

const readyInputs = (override: Partial<MonthEndInputs> = {}): MonthEndInputs => {
  const first = buildChecklist(base(override))
  const signoffs: MonthEndInputs['signoffs'] = {}
  for (const item of first.items) if (item.signoff && ['receivables', 'payables', 'statements'].includes(item.id)) signoffs[item.id as 'receivables'] = signed(item.signoff.fingerprint, item.signoff.figures)
  return base({ ...override, signoffs })
}
const status = (inputs: MonthEndInputs, id: string) => buildChecklist(inputs).items.find((item) => item.id === id)!

describe('checklist: nothing completes by itself', () => {
  it('lists the ten steps in order, each with a status, what needs attention and a place to go', () => {
    const items = buildChecklist(base()).items
    expect(items.map((item) => item.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(items.map((item) => item.title)).toEqual([
      'Review uncategorized transactions', 'Review possible duplicate transactions', 'Verify missing receipts and transaction information', 'Reconcile all bank accounts',
      'Reconcile all credit card accounts', 'Review accounts receivable', 'Review accounts payable', 'Review unusual account balances', 'Review financial statements', 'Approve and complete month-end closing',
    ])
    for (const item of items) expect(['Not Started', 'In Progress', 'Blocked', 'Complete']).toContain(item.status)
    expect(items.filter((item) => item.id !== 'approval').every((item) => item.action)).toBe(true)
  })

  it('receivables, payables and the statements need a person to review them even when the figures look fine', () => {
    const checklist = buildChecklist(base())
    for (const id of ['receivables', 'payables', 'statements']) expect(checklist.items.find((item) => item.id === id)!.status).toBe('Not Started')
    expect(checklist.readyToClose).toBe(false)
    expect(checklist.items.find((item) => item.id === 'approval')!.status).toBe('Blocked')
  })

  it('is ready only when every step is complete, and then approval is the one remaining action', () => {
    const checklist = buildChecklist(readyInputs())
    expect(checklist.readyToClose).toBe(true)
    expect(checklist.items.filter((item) => item.id !== 'approval').every((item) => item.status === 'Complete')).toBe(true)
    expect(checklist.items.find((item) => item.id === 'approval')!.status).toBe('Not Started')
    expect(completionPercent(checklist)).toBe(100)
  })

  it('every completed step carries evidence', () => {
    const checklist = buildChecklist(readyInputs())
    for (const item of checklist.items.filter((candidate) => candidate.id !== 'approval')) expect(item.evidence.length, item.title).toBeGreaterThan(0)
  })
})

describe('unavailable data blocks; it is never counted as complete or as zero', () => {
  it('a transaction list that could not be read blocks the three transaction steps', () => {
    const checklist = buildChecklist(base({ transactions: unknown('QuickBooks returned only part of the transactions.') }))
    for (const id of ['uncategorized', 'duplicates', 'missing-info']) {
      const item = checklist.items.find((candidate) => candidate.id === id)!
      expect(item.status).toBe('Blocked')
      expect(item.attention).toContain('only part of the transactions')
      expect(item.evidence).toEqual([])
    }
    expect(checklist.readyToClose).toBe(false)
  })

  it('unknown accounts, aging, balances and statements each block their own step', () => {
    const checklist = buildChecklist(base({ bankAccounts: unknown('x'), cardAccounts: unknown('x'), receivables: unknown('x'), payables: unknown('x'), unusual: unknown('x'), statements: unknown('x') }))
    for (const id of ['reconcile-bank', 'reconcile-card', 'receivables', 'payables', 'unusual-balances', 'statements']) expect(checklist.items.find((item) => item.id === id)!.status, id).toBe('Blocked')
  })

  it('an aging or statement that fails its own checks is blocked, with the reasons shown', () => {
    const receivables = status(base({ receivables: known({ ...openItems, reportVerified: false, reportProblems: ['Rows add up to the total: they do not.'] }) }), 'receivables')
    expect(receivables.status).toBe('Blocked')
    expect(receivables.details).toContain('Rows add up to the total: they do not.')
    const statements = status(base({ statements: known({ netIncomeCents: 1, totalAssetsCents: 2, failed: ['Balance Sheet: Assets equal liabilities plus equity. They differ.'], unavailable: [] }) }), 'statements')
    expect(statements.status).toBe('Blocked')
    expect(statements.signoff).toBeUndefined()
  })

  it('statements whose key figures could not be read cannot be signed off', () => {
    const item = status(base({ statements: known({ netIncomeCents: null, totalAssetsCents: 100, failed: [], unavailable: ['Net income could not be read.'] }) }), 'statements')
    expect(item.status).toBe('Blocked')
    expect(item.signoff).toBeUndefined()
  })
})

describe('transaction steps', () => {
  it('uncategorized transactions leave the step In Progress; none categorized yet is Not Started', () => {
    expect(status(base({ transactions: known({ ...clean, uncategorized: 3 }) }), 'uncategorized').status).toBe('In Progress')
    expect(status(base({ transactions: known({ ...clean, total: 3, uncategorized: 3 }) }), 'uncategorized').status).toBe('Not Started')
    expect(status(base({ transactions: known({ ...clean, uncategorized: 3 }) }), 'uncategorized').attention).toBe('3 transactions still need a category.')
  })

  it('possible duplicates need a recorded review; the review goes stale if the count changes', () => {
    const open = base({ transactions: known({ ...clean, possibleDuplicates: 2 }) })
    expect(status(open, 'duplicates').status).toBe('Not Started')
    const reviewed = base({ transactions: known({ ...clean, possibleDuplicates: 2 }), signoffs: { duplicates: signed('dup:2', '2 possible duplicates', 'Both are real: two truck loads') } })
    expect(status(reviewed, 'duplicates').status).toBe('Complete')
    expect(status(reviewed, 'duplicates').evidence[0]).toContain('Both are real')
    const changed = base({ transactions: known({ ...clean, possibleDuplicates: 3 }), signoffs: { duplicates: signed('dup:2', '2 possible duplicates', 'ok') } })
    expect(status(changed, 'duplicates').status).toBe('In Progress')
    expect(status(changed, 'duplicates').signoff?.stale).toBe(true)
  })

  it('a missing payee or an open client question must be fixed; a missing receipt can be accepted as an exception with a note', () => {
    const payee = status(base({ transactions: known({ ...clean, missingPayees: 1, missingReceipts: 1 }) }), 'missing-info')
    expect(payee.status).toBe('In Progress')
    expect(payee.signoff?.allowed).toBe(false)
    const request = status(base({ transactions: known({ ...clean, openClientRequests: 1 }) }), 'missing-info')
    expect(request.status).toBe('In Progress')
    expect(request.action?.view).toBe('Client Requests')
    const receipts = base({ transactions: known({ ...clean, missingReceipts: 2 }) })
    expect(status(receipts, 'missing-info').status).toBe('Not Started')
    expect(status(receipts, 'missing-info').signoff).toMatchObject({ allowed: true, noteRequired: true })
    const accepted = base({ transactions: known({ ...clean, missingReceipts: 2 }), signoffs: { 'missing-info': signed('rcpt:2', '2 missing receipts', 'Client lost them') } })
    expect(status(accepted, 'missing-info').status).toBe('Complete')
    expect(buildChecklist(accepted).exceptions.join(' ')).toContain('Client lost them')
  })
})

describe('reconciliation dependencies', () => {
  const account = (record?: Partial<NonNullable<AccountRecon['record']>>): AccountRecon => ({ accountId: 'chk', name: 'Checking', kind: 'bank', record: record ? { id: 'r', status: 'draft', periodEnd: END, version: 1, ...record } : undefined })
  const bank = (accounts: AccountRecon[]) => status(base({ bankAccounts: known(accounts) }), 'reconcile-bank')

  it('is complete only when every account has a completed reconciliation ending on the last day of the month', () => {
    expect(bank([done('chk', 'Checking', 'bank')]).status).toBe('Complete')
    expect(bank([done('chk', 'Checking', 'bank'), account()]).status).toBe('In Progress')
    expect(bank([account(), { ...account(), accountId: 'sav', name: 'Savings' }]).status).toBe('Not Started')
  })

  it('a reconciliation that is only a draft does not count, and a reopened one says why', () => {
    expect(bank([account({ status: 'draft' })]).status).toBe('In Progress')
    const reopened = bank([account({ status: 'draft', reopenedAt: '2026-09-10T10:00:00.000Z', reopenReason: 'Bank corrected a charge' })])
    expect(reopened.status).toBe('In Progress')
    expect(reopened.details.join(' ')).toContain('reopened on 2026-09-10')
    expect(reopened.details.join(' ')).toContain('Bank corrected a charge')
  })

  it('a completed reconciliation with a leftover difference is rejected rather than trusted', () => {
    expect(bank([account({ status: 'completed', differenceCents: 500 })]).status).toBe('In Progress')
  })

  it('no active accounts of that kind completes with that stated as the evidence', () => {
    const none = bank([])
    expect(none.status).toBe('Complete')
    expect(none.evidence[0]).toContain('no active bank accounts')
  })

  it('reconFactsFor uses only records for the matching account and exact period end', () => {
    const record = (over: Partial<ReconRecordLike>): ReconRecordLike => ({ id: 'x', accountId: 'chk', status: 'completed', periodEnd: END, version: 2, history: [], ...over })
    const accounts = [{ id: 'chk', name: 'Checking', kind: 'bank' as const }, { id: 'sav', name: 'Savings', kind: 'bank' as const }]
    const facts = reconFactsFor(accounts, [record({}), record({ id: 'july', periodEnd: '2026-07-31' }), record({ id: 'other', accountId: 'zzz' })], '2026-08')
    expect(facts[0].record?.id).toBe('x')
    expect(facts[1].record).toBeUndefined()
    expect(reconFactsFor(accounts, [record({ periodEnd: '2026-08-15' })], '2026-08')[0].record).toBeUndefined()
  })

  it('reopening a reconciliation is picked up from its history', () => {
    const facts = reconFactsFor([{ id: 'chk', name: 'Checking', kind: 'bank' }], [{ id: 'x', accountId: 'chk', status: 'draft', periodEnd: END, version: 3, history: [{ action: 'completed', at: 'a' }, { action: 'reopened', at: '2026-09-09T00:00:00.000Z', reason: 'Fix' }] }], '2026-08')
    expect(facts[0].record?.reopenedAt).toBe('2026-09-09T00:00:00.000Z')
    expect(facts[0].record?.reopenReason).toBe('Fix')
  })
})

describe('receivables, payables, balances and statements', () => {
  it('a review is recorded against the figures it saw; changed figures make it stale', () => {
    const fresh = buildChecklist(base()).items.find((item) => item.id === 'receivables')!
    const reviewed = base({ signoffs: { receivables: signed(fresh.signoff!.fingerprint, fresh.signoff!.figures) } })
    expect(status(reviewed, 'receivables').status).toBe('Complete')
    const changed = base({ receivables: known({ ...openItems, totalCents: openItems.totalCents + 1 }), signoffs: reviewed.signoffs })
    expect(status(changed, 'receivables').status).toBe('In Progress')
    expect(status(changed, 'receivables').attention).toContain('changed since you reviewed')
  })

  it('overdue items do not block closing but are listed as remaining exceptions', () => {
    const checklist = buildChecklist(readyInputs())
    expect(checklist.readyToClose).toBe(true)
    expect(checklist.exceptions.join(' ')).toContain('1 overdue invoice totalling $2,840.00')
  })

  it('unusual balances complete automatically only when none are found; findings need a note-backed confirmation', () => {
    expect(status(base(), 'unusual-balances').status).toBe('Complete')
    const flagged = base({ unusual: known({ accountsChecked: 18, findings: ['Undeposited Funds: $400.00.'] }) })
    expect(status(flagged, 'unusual-balances').status).toBe('Not Started')
    expect(status(flagged, 'unusual-balances').signoff?.noteRequired).toBe(true)
  })

  it('statements are reviewed against the figures shown; a changed net income reopens the review', () => {
    const item = status(base(), 'statements')
    const reviewed = base({ signoffs: { statements: signed(item.signoff!.fingerprint, item.signoff!.figures) } })
    expect(status(reviewed, 'statements').status).toBe('Complete')
    const changed = base({ statements: known({ netIncomeCents: 414_919, totalAssetsCents: 6_884_172, failed: [], unavailable: [] }), signoffs: reviewed.signoffs })
    expect(status(changed, 'statements').status).toBe('In Progress')
  })

  it('classifies unusual balances by sign and by name, and never flags a zero balance', () => {
    const facts = unusualBalances([
      { name: 'Checking', klass: 'asset', debitMinusCreditCents: -500 },
      { name: 'Accounts Payable', klass: 'liability', debitMinusCreditCents: 700 },
      { name: 'Service Income', klass: 'income', debitMinusCreditCents: 100 },
      { name: 'Fuel', klass: 'expense', debitMinusCreditCents: -100 },
      { name: 'Uncategorized Expense', klass: 'expense', debitMinusCreditCents: 15_000 },
      { name: 'Undeposited Funds', klass: 'asset', debitMinusCreditCents: 40_000 },
      { name: 'Savings', klass: 'asset', debitMinusCreditCents: 0 },
      { name: 'Cash', klass: 'asset', debitMinusCreditCents: 9_000 },
    ])
    expect(facts.accountsChecked).toBe(8)
    expect(facts.findings).toHaveLength(6)
    expect(facts.findings.join(' ')).not.toContain('Savings')
    expect(facts.findings.join(' ')).not.toContain('Cash:')
  })
})

describe('approval and closing', () => {
  it('cannot close while any step is open, and says which', () => {
    const result = validateClose(base())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.join(' ')).toContain('6. Review accounts receivable')
  })

  it('cannot close an invalid period or a month that is already closed', () => {
    expect(validateClose({ ...readyInputs(), period: '2026-13' })).toMatchObject({ ok: false })
    const closed = readyInputs({ closing: { closedAt: '2026-09-05T00:00:00.000Z', closedBy: 'pat@example.com', checklist: [], exceptions: [], reconciliations: [] } })
    const result = validateClose(closed)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems[0]).toContain('already closed')
  })

  it('records the checklist, the evidence, the exceptions and the reconciliations relied on', () => {
    const result = validateClose(readyInputs())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.closing.checklist).toHaveLength(9)
    expect(result.closing.checklist.every((item) => item.status === 'Complete' && item.evidence.length > 0)).toBe(true)
    expect(result.closing.exceptions.join(' ')).toContain('overdue invoice')
    expect(result.closing.reconciliations.map((item) => item.accountId)).toEqual(['chk', 'card'])
    expect(result.closing.reconciliations[0]).toMatchObject({ recordId: `demo:c:chk:${END}`, version: 2 })
  })

  it('a closed month is Complete while its checks hold, and stops being verified when a reconciliation is reopened', () => {
    const closing = { closedAt: '2026-09-05T00:00:00.000Z', closedBy: 'pat@example.com', checklist: [], exceptions: [], reconciliations: [] }
    const intact = buildChecklist(readyInputs({ closing }))
    expect(intact.closed).toBe(true)
    expect(intact.items.find((item) => item.id === 'approval')!.status).toBe('Complete')
    expect(intact.changedSinceClosing).toEqual([])
    const reopened: AccountRecon = { accountId: 'chk', name: 'Checking', kind: 'bank', record: { id: 'r', status: 'draft', periodEnd: END, version: 3, reopenedAt: '2026-09-09T00:00:00.000Z' } }
    const broken = buildChecklist(readyInputs({ closing, bankAccounts: known([reopened]) }))
    expect(broken.closed).toBe(false)
    expect(broken.changedSinceClosing).toEqual(['4. Reconcile all bank accounts'])
    expect(broken.items.find((item) => item.id === 'approval')!.status).toBe('In Progress')
    expect(broken.items.find((item) => item.id === 'approval')!.attention).toContain('no longer pass')
  })
})
