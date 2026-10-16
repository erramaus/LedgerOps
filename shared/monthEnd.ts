// Month-end closing rules shared by the browser and the server. Pure: no I/O, no clock.
// A step is Complete only when it is verified from data, or when a person has signed it off against figures that
// have not changed since. Nothing is complete merely because an account, a report or a record exists.
import { formatCents } from './reconciliation.js'
import { monthLabel, parsePeriodKey, periodEnd, type Period } from './period.js'

export type Source = 'demo' | 'quickbooks'
export type StepStatus = 'Not Started' | 'In Progress' | 'Blocked' | 'Complete'
export type StepView = 'Transactions' | 'Bookkeeping Review' | 'Reconcile' | 'Receivables' | 'Payables' | 'Reports' | 'Client Requests'
export type StepId = 'uncategorized' | 'duplicates' | 'missing-info' | 'reconcile-bank' | 'reconcile-card' | 'receivables' | 'payables' | 'unusual-balances' | 'statements' | 'approval'
export type SignoffStep = 'duplicates' | 'missing-info' | 'receivables' | 'payables' | 'unusual-balances' | 'statements'
export const SIGNOFF_STEPS: SignoffStep[] = ['duplicates', 'missing-info', 'receivables', 'payables', 'unusual-balances', 'statements']

/** Figures that may be unknown. Unknown is never treated as zero. */
export type Availability<T> = { available: true; value: T } | { available: false; reason: string }
export const known = <T>(value: T): Availability<T> => ({ available: true, value })
export const unknown = <T>(reason: string): Availability<T> => ({ available: false, reason })

export type TransactionFacts = { total: number; uncategorized: number; possibleDuplicates: number; missingReceipts: number; missingPayees: number; openClientRequests: number }
export type ReconRecordFacts = { id: string; status: 'draft' | 'completed'; periodEnd: string; version: number; completedAt?: string; completedBy?: string; differenceCents?: number; reopenedAt?: string; reopenReason?: string }
export type AccountRecon = { accountId: string; name: string; kind: 'bank' | 'credit_card'; record?: ReconRecordFacts }
export type OpenItemFacts = { totalCents: number; itemCount: number; overdueCount: number; overdueCents: number; reportVerified: boolean; reportProblems: string[]; /** What one item is, when it is not an invoice or bill (for example a customer balance). */ unit?: string }
export type UnusualFacts = { accountsChecked: number; findings: string[] }
export type StatementFacts = { netIncomeCents: number | null; totalAssetsCents: number | null; failed: string[]; unavailable: string[] }

export type Signoff = { by: string; at: string; note: string; fingerprint: string; figures: string }
export type MonthEndEvent = { at: string; by: string; action: 'signed_off' | 'signoff_cleared' | 'closed' | 'reopened'; step?: SignoffStep; reason?: string; note?: string }
export type ClosedItem = { id: StepId; number: number; title: string; status: StepStatus; evidence: string[] }
export type ClosingRecord = {
  closedAt: string
  closedBy: string
  checklist: ClosedItem[]
  exceptions: string[]
  reconciliations: { accountId: string; accountName: string; recordId: string; version: number; completedAt?: string }[]
}
export type MonthEndRecord = {
  id: string
  source: Source
  clientId: string
  clientName: string
  period: string
  status: 'open' | 'closed'
  version: number
  createdAt: string
  updatedAt: string
  signoffs: Partial<Record<SignoffStep, Signoff>>
  closing?: ClosingRecord
  history: MonthEndEvent[]
}

export const MONTH_END_ID_PATTERN = /^(demo|quickbooks):[\w-]{1,60}:\d{4}-(0[1-9]|1[0-2])$/
export const monthEndId = (source: Source, clientId: string, period: string) => `${source}:${clientId}:${period}`

export type MonthEndInputs = {
  period: string
  transactions: Availability<TransactionFacts>
  bankAccounts: Availability<AccountRecon[]>
  cardAccounts: Availability<AccountRecon[]>
  receivables: Availability<OpenItemFacts>
  payables: Availability<OpenItemFacts>
  unusual: Availability<UnusualFacts>
  statements: Availability<StatementFacts>
  signoffs: Partial<Record<SignoffStep, Signoff>>
  closing?: ClosingRecord
}

export type SignoffInfo = { allowed: boolean; label: string; noteRequired: boolean; fingerprint: string; figures: string; current?: Signoff; stale: boolean }
export type ChecklistItem = {
  id: StepId
  number: number
  title: string
  status: StepStatus
  attention: string
  details: string[]
  evidence: string[]
  action?: { view: StepView; label: string }
  signoff?: SignoffInfo
}
export type Checklist = {
  items: ChecklistItem[]
  completeCount: number
  /** Steps 1 to 9 all Complete (approval itself excluded). */
  readyToClose: boolean
  blockers: string[]
  exceptions: string[]
  closed: boolean
  /** A closed month whose checks no longer all pass, for example because a reconciliation was reopened. */
  changedSinceClosing: string[]
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
export const STEP_TITLES: Record<StepId, string> = {
  uncategorized: 'Review uncategorized transactions',
  duplicates: 'Review possible duplicate transactions',
  'missing-info': 'Verify missing receipts and transaction information',
  'reconcile-bank': 'Reconcile all bank accounts',
  'reconcile-card': 'Reconcile all credit card accounts',
  receivables: 'Review accounts receivable',
  payables: 'Review accounts payable',
  'unusual-balances': 'Review unusual account balances',
  statements: 'Review financial statements',
  approval: 'Approve and complete month-end closing',
}
export const STEP_ORDER = Object.keys(STEP_TITLES) as StepId[]
/** Steps whose confirmation must always carry a note, because they accept a known problem. */
export const NOTE_REQUIRED_STEPS: SignoffStep[] = ['duplicates', 'missing-info', 'unusual-balances']

type Draft = Omit<ChecklistItem, 'number' | 'title'>
const blocked = (id: StepId, reason: string, action?: ChecklistItem['action']): Draft => ({ id, status: 'Blocked', attention: reason, details: [], evidence: [], action })

function signoffState(step: SignoffStep, inputs: MonthEndInputs, fingerprint: string): { current?: Signoff; fresh: boolean; stale: boolean } {
  const current = inputs.signoffs[step]
  return { current, fresh: Boolean(current) && current!.fingerprint === fingerprint, stale: Boolean(current) && current!.fingerprint !== fingerprint }
}

const signoffEvidence = (current: Signoff) => `Reviewed by ${current.by} on ${current.at.slice(0, 10)} at: ${current.figures}.${current.note ? ` Note: ${current.note}` : ''}`

function transactionSteps(inputs: MonthEndInputs): Draft[] {
  const unavailable = (id: StepId, view: StepView, label: string): Draft | null => (inputs.transactions.available ? null : blocked(id, `Cannot be checked: ${inputs.transactions.reason}`, { view, label }))
  const first = unavailable('uncategorized', 'Transactions', 'Open Transactions')
  if (first || !inputs.transactions.available) return [first!, unavailable('duplicates', 'Bookkeeping Review', 'Open Bookkeeping Review')!, unavailable('missing-info', 'Bookkeeping Review', 'Open Bookkeeping Review')!]
  const facts = inputs.transactions.value

  const uncategorized: Draft = facts.uncategorized === 0
    ? { id: 'uncategorized', status: 'Complete', attention: 'Nothing needs attention.', details: [], evidence: [`${plural(facts.total, 'transaction')} dated in ${monthLabel(parsePeriodKey(inputs.period)!)} checked: none are uncategorized.`], action: { view: 'Transactions', label: 'Open Transactions' } }
    : { id: 'uncategorized', status: facts.uncategorized >= facts.total ? 'Not Started' : 'In Progress', attention: `${plural(facts.uncategorized, 'transaction')} still need${facts.uncategorized === 1 ? 's' : ''} a category.`, details: [`${facts.total - facts.uncategorized} of ${facts.total} are categorized.`], evidence: [], action: { view: 'Transactions', label: 'Categorize transactions' } }

  const dupFingerprint = `dup:${facts.possibleDuplicates}`
  const dupState = signoffState('duplicates', inputs, dupFingerprint)
  const duplicates: Draft = facts.possibleDuplicates === 0
    ? { id: 'duplicates', status: 'Complete', attention: 'Nothing needs attention.', details: [], evidence: [`${plural(facts.total, 'transaction')} compared: no possible duplicates found.`], action: { view: 'Bookkeeping Review', label: 'Open Bookkeeping Review' } }
    : {
        id: 'duplicates', status: dupState.fresh ? 'Complete' : dupState.stale ? 'In Progress' : 'Not Started',
        attention: dupState.fresh ? 'Reviewed.' : `${plural(facts.possibleDuplicates, 'possible duplicate')} to compare. If they are genuine, confirm that below.`,
        details: dupState.stale ? ['The number of possible duplicates changed since you confirmed this.'] : [], evidence: dupState.fresh ? [signoffEvidence(dupState.current!)] : [],
        action: { view: 'Bookkeeping Review', label: 'Compare transactions' },
        signoff: { allowed: true, label: 'Confirm these were reviewed', noteRequired: true, fingerprint: dupFingerprint, figures: plural(facts.possibleDuplicates, 'possible duplicate'), current: dupState.current, stale: dupState.stale },
      }

  const infoFingerprint = `rcpt:${facts.missingReceipts}`
  const infoState = signoffState('missing-info', inputs, infoFingerprint)
  const mustFix: string[] = []
  if (facts.missingPayees > 0) mustFix.push(`${plural(facts.missingPayees, 'transaction')} ${facts.missingPayees === 1 ? 'has' : 'have'} no payee.`)
  if (facts.openClientRequests > 0) mustFix.push(`${plural(facts.openClientRequests, 'client question')} ${facts.openClientRequests === 1 ? 'is' : 'are'} still open.`)
  const receiptsOpen = facts.missingReceipts > 0 && !infoState.fresh
  const missing: Draft = mustFix.length === 0 && !receiptsOpen
    ? { id: 'missing-info', status: 'Complete', attention: 'Nothing needs attention.', details: [], evidence: facts.missingReceipts === 0 ? ['No missing payees, missing receipts or open client questions.'] : [signoffEvidence(infoState.current!)], action: { view: 'Client Requests', label: 'Open Client Requests' }, ...(facts.missingReceipts > 0 ? { signoff: { allowed: true, label: 'Confirm receipts', noteRequired: true, fingerprint: infoFingerprint, figures: plural(facts.missingReceipts, 'missing receipt'), current: infoState.current, stale: false } } : {}) }
    : {
        id: 'missing-info', status: mustFix.length > 0 ? 'In Progress' : infoState.stale ? 'In Progress' : 'Not Started',
        attention: [...mustFix, ...(receiptsOpen ? [`${plural(facts.missingReceipts, 'receipt')} may be missing.`] : [])].join(' '),
        details: [...(receiptsOpen ? ['A receipt you cannot obtain can be accepted as an exception, with a note.'] : []), ...(infoState.stale ? ['The number of missing receipts changed since you confirmed this.'] : [])], evidence: [],
        action: { view: facts.openClientRequests > 0 ? 'Client Requests' : 'Bookkeeping Review', label: facts.openClientRequests > 0 ? 'Open Client Requests' : 'Open Bookkeeping Review' },
        ...(facts.missingReceipts > 0 ? { signoff: { allowed: mustFix.length === 0, label: 'Accept missing receipts as an exception', noteRequired: true, fingerprint: infoFingerprint, figures: plural(facts.missingReceipts, 'missing receipt'), current: infoState.current, stale: infoState.stale } } : {}),
      }
  return [uncategorized, duplicates, missing]
}

function reconciliationStep(id: 'reconcile-bank' | 'reconcile-card', accounts: Availability<AccountRecon[]>, period: string): Draft {
  const kind = id === 'reconcile-bank' ? 'bank' : 'credit card'
  const action = { view: 'Reconcile' as const, label: 'Open Reconcile' }
  if (!accounts.available) return blocked(id, `Cannot be checked: ${accounts.reason}`, action)
  const end = periodEnd(parsePeriodKey(period)!)
  if (accounts.value.length === 0) return { id, status: 'Complete', attention: `No active ${kind} accounts.`, details: [], evidence: [`The account list was read and has no active ${kind} accounts.`], action }
  const details: string[] = []
  const evidence: string[] = []
  let done = 0, started = 0
  for (const account of accounts.value) {
    const record = account.record
    if (record?.status === 'completed' && record.periodEnd === end) {
      if ((record.differenceCents ?? 0) !== 0) {
        details.push(`${account.name}: completed with a difference of ${formatCents(record.differenceCents ?? 0)}. This should not happen; reopen it.`)
        started += 1
        continue
      }
      done += 1
      evidence.push(`${account.name}: reconciled through ${end}, difference ${formatCents(0)}${record.completedBy ? `, completed by ${record.completedBy}` : ''}${record.completedAt ? ` on ${record.completedAt.slice(0, 10)}` : ''}.`)
    } else if (record?.reopenedAt && record.status === 'draft') {
      started += 1
      details.push(`${account.name}: reopened on ${record.reopenedAt.slice(0, 10)}${record.reopenReason ? ` (${record.reopenReason})` : ''}. Complete it again.`)
    } else if (record) {
      started += 1
      details.push(`${account.name}: reconciliation started but not completed.`)
    } else {
      details.push(`${account.name}: no reconciliation ending ${end}.`)
    }
  }
  const total = accounts.value.length
  if (done === total) return { id, status: 'Complete', attention: 'Nothing needs attention.', details: [], evidence, action }
  return { id, status: done + started === 0 ? 'Not Started' : 'In Progress', attention: `${plural(total - done, `${kind} account`)} still ${total - done === 1 ? 'needs' : 'need'} a completed reconciliation ending ${end}.`, details, evidence: done > 0 ? evidence : [], action }
}

function openItemStep(id: 'receivables' | 'payables', facts: Availability<OpenItemFacts>, inputs: MonthEndInputs): Draft {
  const noun = id === 'receivables' ? 'receivable' : 'payable'
  const action = { view: id === 'receivables' ? ('Receivables' as const) : ('Payables' as const), label: id === 'receivables' ? 'Open Receivables' : 'Open Payables' }
  if (!facts.available) return blocked(id, `Cannot be checked: ${facts.reason}`, action)
  const value = facts.value
  if (!value.reportVerified) return { ...blocked(id, `The ${noun}s figures could not be verified.`, action), details: value.reportProblems }
  const fingerprint = `${id}:${value.totalCents}:${value.itemCount}:${value.overdueCount}`
  const state = signoffState(id, inputs, fingerprint)
  const summary = `${plural(value.itemCount, `open ${value.unit ?? 'item'}`)} totalling ${formatCents(value.totalCents)}${value.overdueCount > 0 ? `, ${value.overdueCount} overdue (${formatCents(value.overdueCents)})` : ''}`
  return {
    id, status: state.fresh ? 'Complete' : state.stale ? 'In Progress' : 'Not Started',
    attention: state.fresh ? 'Reviewed.' : state.stale ? 'The figures changed since you reviewed them. Review them again.' : `Review the aging and confirm: ${summary}.`,
    details: value.overdueCount > 0 ? [`${plural(value.overdueCount, `overdue ${value.unit ?? 'item'}`)} will be recorded as a remaining exception.`] : [],
    evidence: state.fresh ? [signoffEvidence(state.current!)] : [], action,
    signoff: { allowed: true, label: `Mark ${noun}s reviewed`, noteRequired: false, fingerprint, figures: summary, current: state.current, stale: state.stale },
  }
}

function unusualStep(inputs: MonthEndInputs): Draft {
  const action = { view: 'Reports' as const, label: 'Open Trial Balance' }
  if (!inputs.unusual.available) return blocked('unusual-balances', `Cannot be checked: ${inputs.unusual.reason}`, action)
  const { findings, accountsChecked } = inputs.unusual.value
  if (findings.length === 0) return { id: 'unusual-balances', status: 'Complete', attention: 'Nothing needs attention.', details: [], evidence: [`${plural(accountsChecked, 'account balance')} checked: none look unusual.`], action }
  const fingerprint = `unusual:${findings.join('|')}`
  const state = signoffState('unusual-balances', inputs, fingerprint)
  return {
    id: 'unusual-balances', status: state.fresh ? 'Complete' : state.stale ? 'In Progress' : 'Not Started',
    attention: state.fresh ? 'Reviewed.' : `${plural(findings.length, 'balance')} look unusual. Check them, then confirm.`, details: findings, evidence: state.fresh ? [signoffEvidence(state.current!)] : [], action,
    signoff: { allowed: true, label: 'Confirm these balances are expected', noteRequired: true, fingerprint, figures: plural(findings.length, 'unusual balance'), current: state.current, stale: state.stale },
  }
}

function statementsStep(inputs: MonthEndInputs): Draft {
  const action = { view: 'Reports' as const, label: 'Open Reports' }
  if (!inputs.statements.available) return blocked('statements', `Cannot be checked: ${inputs.statements.reason}`, action)
  const facts = inputs.statements.value
  if (facts.failed.length > 0) return { ...blocked('statements', 'A financial statement does not agree with its own figures.', action), details: facts.failed }
  if (facts.unavailable.length > 0 || facts.netIncomeCents === null || facts.totalAssetsCents === null) return { ...blocked('statements', 'The financial statements could not be fully verified.', action), details: facts.unavailable }
  const figures = `net income ${formatCents(facts.netIncomeCents)}, total assets ${formatCents(facts.totalAssetsCents)}`
  const fingerprint = `stmt:${facts.netIncomeCents}:${facts.totalAssetsCents}`
  const state = signoffState('statements', inputs, fingerprint)
  return {
    id: 'statements', status: state.fresh ? 'Complete' : state.stale ? 'In Progress' : 'Not Started',
    attention: state.fresh ? 'Reviewed.' : state.stale ? 'The statements changed since you reviewed them. Review them again.' : `Review the Profit and Loss and Balance Sheet (${figures}), then confirm.`,
    details: [], evidence: state.fresh ? [signoffEvidence(state.current!)] : [], action,
    signoff: { allowed: true, label: 'Mark statements reviewed', noteRequired: false, fingerprint, figures, current: state.current, stale: state.stale },
  }
}

export function buildChecklist(inputs: MonthEndInputs): Checklist {
  const drafts: Draft[] = [
    ...transactionSteps(inputs),
    reconciliationStep('reconcile-bank', inputs.bankAccounts, inputs.period),
    reconciliationStep('reconcile-card', inputs.cardAccounts, inputs.period),
    openItemStep('receivables', inputs.receivables, inputs),
    openItemStep('payables', inputs.payables, inputs),
    unusualStep(inputs),
    statementsStep(inputs),
  ]
  const label = (draft: Draft) => `${STEP_ORDER.indexOf(draft.id) + 1}. ${STEP_TITLES[draft.id]}`
  const unfinished = drafts.filter((draft) => draft.status !== 'Complete')
  const ready = unfinished.length === 0
  const closed = Boolean(inputs.closing)

  const approval: Draft = closed && ready
    ? { id: 'approval', status: 'Complete', attention: `Closed ${inputs.closing!.closedAt.slice(0, 10)} by ${inputs.closing!.closedBy}.`, details: inputs.closing!.exceptions.length > 0 ? ['Remaining exceptions were recorded.'] : [], evidence: [`Month end approved by ${inputs.closing!.closedBy} on ${inputs.closing!.closedAt.slice(0, 10)}.`] }
    : closed
      ? { id: 'approval', status: 'In Progress', attention: `Closed ${inputs.closing!.closedAt.slice(0, 10)}, but ${plural(unfinished.length, 'check')} no longer pass. Reopen the month to review again.`, details: unfinished.map(label), evidence: [] }
      : ready
        ? { id: 'approval', status: 'Not Started', attention: 'Every check passes. Review the summary and approve.', details: [], evidence: [] }
        : { id: 'approval', status: 'Blocked', attention: `Finish ${plural(unfinished.length, 'step')} first.`, details: unfinished.map(label), evidence: [] }
  drafts.push(approval)

  const items: ChecklistItem[] = drafts.map((draft) => ({ ...draft, number: STEP_ORDER.indexOf(draft.id) + 1, title: STEP_TITLES[draft.id] }))
  const exceptions: string[] = []
  if (inputs.receivables.available && inputs.receivables.value.overdueCount > 0) exceptions.push(`${plural(inputs.receivables.value.overdueCount, `overdue ${inputs.receivables.value.unit ?? 'invoice'}`)} totalling ${formatCents(inputs.receivables.value.overdueCents)}.`)
  if (inputs.payables.available && inputs.payables.value.overdueCount > 0) exceptions.push(`${plural(inputs.payables.value.overdueCount, `overdue ${inputs.payables.value.unit ?? 'bill'}`)} totalling ${formatCents(inputs.payables.value.overdueCents)}.`)
  for (const step of SIGNOFF_STEPS) {
    const item = items.find((candidate) => candidate.id === step)
    const current = item?.signoff?.current
    if (item?.status === 'Complete' && current && ['duplicates', 'missing-info', 'unusual-balances'].includes(step)) exceptions.push(`${item.title}: ${current.figures}${current.note ? ` (${current.note})` : ''}.`)
  }
  return {
    items,
    completeCount: items.filter((item) => item.status === 'Complete').length,
    readyToClose: ready,
    blockers: unfinished.map(label),
    exceptions,
    closed: closed && ready,
    changedSinceClosing: closed ? unfinished.map(label) : [],
  }
}

export type CloseCheck = { ok: true; closing: Omit<ClosingRecord, 'closedAt' | 'closedBy'> } | { ok: false; problems: string[] }

/** Whether a month may be closed now, and the evidence snapshot to store if so. */
export function validateClose(inputs: MonthEndInputs, options: { today?: string } = {}): CloseCheck {
  const parsed = parsePeriodKey(inputs.period)
  if (!parsed) return { ok: false, problems: ['The accounting period is not valid.'] }
  if (options.today && periodEnd(parsed) >= options.today) return { ok: false, problems: [`${monthLabel(parsed)} has not ended yet, so it cannot be closed.`] }
  if (inputs.closing) return { ok: false, problems: ['This month is already closed. Reopen it, with a reason, before closing it again.'] }
  const checklist = buildChecklist(inputs)
  if (!checklist.readyToClose) return { ok: false, problems: checklist.blockers.map((blocker) => `Not complete: ${blocker}`) }
  const reconciliations: ClosingRecord['reconciliations'] = []
  for (const account of [...(inputs.bankAccounts.available ? inputs.bankAccounts.value : []), ...(inputs.cardAccounts.available ? inputs.cardAccounts.value : [])]) {
    if (account.record) reconciliations.push({ accountId: account.accountId, accountName: account.name, recordId: account.record.id, version: account.record.version, completedAt: account.record.completedAt })
  }
  return {
    ok: true,
    closing: {
      checklist: checklist.items.filter((item) => item.id !== 'approval').map((item) => ({ id: item.id, number: item.number, title: item.title, status: item.status, evidence: item.evidence })),
      exceptions: checklist.exceptions,
      reconciliations,
    },
  }
}

export const isSignoffStep = (value: unknown): value is SignoffStep => typeof value === 'string' && (SIGNOFF_STEPS as string[]).includes(value)

/** Month-end percentage for the existing dashboard widgets: share of the first nine steps that are Complete. */
export const completionPercent = (checklist: Checklist) => Math.round((checklist.items.filter((item) => item.id !== 'approval' && item.status === 'Complete').length / 9) * 100)

export type PeriodRef = Period

/** Inputs for a client or month about which nothing is known: every step is Blocked and says why. */
export function allUnavailable(period: string, reason: string, signoffs: MonthEndInputs['signoffs'] = {}, closing?: ClosingRecord): MonthEndInputs {
  const missing = <T,>() => unknown<T>(reason)
  return { period, transactions: missing(), bankAccounts: missing(), cardAccounts: missing(), receivables: missing(), payables: missing(), unusual: missing(), statements: missing(), signoffs, closing }
}
