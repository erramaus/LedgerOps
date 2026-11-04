import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AdjustingEntryType, DemoJournalEntryInput, DemoJournalRecord } from '../shared/demoJournalEntries'
import type { DemoWorkpaperInput, DemoWorkpaperRecord, WorkpaperStatus } from '../shared/demoWorkpapers'
import { periodEnd, type Period } from '../shared/period'
import { formatCents } from '../shared/reconciliation'
import { journalReadiness, parseAmountCents as parseAmount } from './services/journalForm'

type AccountantAccount = { id: string; name: string; active: boolean; accountType: string }

type JournalLineDraft = { accountId: string; debit: string; credit: string; memo: string }
type JournalFormState = {
  date: string
  description: string
  referenceNumber: string
  adjustmentType: '' | AdjustingEntryType
  explanation: string
  lines: JournalLineDraft[]
}

type WorkpaperFormState = {
  title: string
  period: string
  accountId: string
  note: string
  supportingDocumentRefs: string
  reconciliationLinks: string
  adjustingEntryIds: string
  reviewStatus: WorkpaperStatus
  preparedBy: string
  reviewedBy: string
  workDate: string
}

const amountText = (cents: number) => (cents === 0 ? '' : (cents / 100).toFixed(2))
const periodKey = (period: Period) => `${period.year}-${String(period.month).padStart(2, '0')}`
const splitList = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean)
const accountOptions = (accounts: AccountantAccount[]) => accounts.filter((account) => account.active).sort((left, right) => left.name.localeCompare(right.name))

function emptyJournal(period: Period): JournalFormState {
  return {
    date: periodEnd(period),
    description: '',
    referenceNumber: '',
    adjustmentType: '',
    explanation: '',
    lines: [
      { accountId: '', debit: '', credit: '', memo: '' },
      { accountId: '', debit: '', credit: '', memo: '' },
    ],
  }
}

function journalToForm(record: DemoJournalRecord): JournalFormState {
  return {
    date: record.input.date,
    description: record.input.description,
    referenceNumber: record.input.referenceNumber,
    adjustmentType: record.input.adjustmentType ?? '',
    explanation: record.input.explanation ?? '',
    lines: record.input.lines.map((line) => ({ accountId: line.accountId, debit: amountText(line.debitCents), credit: amountText(line.creditCents), memo: line.memo })),
  }
}

function workpaperToForm(record: DemoWorkpaperRecord): WorkpaperFormState {
  return {
    title: record.input.title,
    period: record.input.period,
    accountId: record.input.accountId,
    note: record.input.note,
    supportingDocumentRefs: record.input.supportingDocumentRefs.join(', '),
    reconciliationLinks: record.input.reconciliationLinks.join(', '),
    adjustingEntryIds: record.input.adjustingEntryIds.join(', '),
    reviewStatus: record.input.reviewStatus,
    preparedBy: record.input.preparedBy,
    reviewedBy: record.input.reviewedBy ?? '',
    workDate: record.input.workDate,
  }
}

function emptyWorkpaper(period: Period, preparedBy: string): WorkpaperFormState {
  return {
    title: '',
    period: periodKey(period),
    accountId: '',
    note: '',
    supportingDocumentRefs: '',
    reconciliationLinks: '',
    adjustingEntryIds: '',
    reviewStatus: 'Open',
    preparedBy,
    reviewedBy: '',
    workDate: periodEnd(period),
  }
}

function Disclosure({ id, title, countLabel, open, onToggle, unsaved, action, children }: { id: string; title: string; countLabel: string; open: boolean; onToggle: () => void; unsaved: boolean; action: ReactNode; children: ReactNode }) {
  return (
    <section className="panel accountant-panel" aria-label={title}>
      <div className="disclosure-header">
        <button type="button" className="disclosure-toggle" aria-expanded={open} aria-controls={id} onClick={onToggle}>
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          <strong>{title}</strong>
          <span className="count-badge">{countLabel}</span>
          {unsaved && <span className="count-badge warning">Unsaved changes</span>}
        </button>
        {action}
      </div>
      <div id={id} hidden={!open}>{children}</div>
    </section>
  )
}

function DiscardWarning({ what, onDiscard, onKeep }: { what: string; onDiscard: () => void; onKeep: () => void }) {
  return (
    <div className="data-state-message error" role="alert" data-testid="discard-warning">
      <strong>Discard unsaved changes?</strong> Your {what} has edits that have not been saved. Continuing will replace them.
      <div className="reset-actions">
        <button type="button" className="secondary-button" onClick={onDiscard}>Discard changes</button>
        <button type="button" className="primary-button" onClick={onKeep}>Keep editing</button>
      </div>
    </div>
  )
}

export function AccountantTools({
  source,
  clientName,
  period,
  accounts,
  journals,
  workpapers,
  userDisplay,
  onCreateJournal,
  onUpdateJournal,
  onPostJournal,
  onReverseJournal,
  onCreateWorkpaper,
  onUpdateWorkpaper,
}: {
  source: 'demo' | 'quickbooks'
  clientName: string
  period: Period
  accounts: AccountantAccount[]
  journals: DemoJournalRecord[]
  workpapers: DemoWorkpaperRecord[]
  userDisplay: string
  onCreateJournal: (input: DemoJournalEntryInput) => Promise<void>
  onUpdateJournal: (record: DemoJournalRecord, input: DemoJournalEntryInput) => Promise<void>
  onPostJournal: (record: DemoJournalRecord) => Promise<void>
  onReverseJournal: (record: DemoJournalRecord, reason: string) => Promise<void>
  onCreateWorkpaper: (input: DemoWorkpaperInput) => Promise<void>
  onUpdateWorkpaper: (record: DemoWorkpaperRecord, input: DemoWorkpaperInput) => Promise<void>
}) {
  const selectableAccounts = useMemo(() => accountOptions(accounts), [accounts])
  const [selectedJournalId, setSelectedJournalId] = useState<string | null>(null)
  const [journalForm, setJournalForm] = useState<JournalFormState>(() => emptyJournal(period))
  const [journalErrors, setJournalErrors] = useState<Record<string, string>>({})
  const [journalMessage, setJournalMessage] = useState<string | null>(null)
  const [journalBusy, setJournalBusy] = useState(false)
  const [reverseReason, setReverseReason] = useState('')
  const [selectedWorkpaperId, setSelectedWorkpaperId] = useState<string | null>(null)
  const [workpaperForm, setWorkpaperForm] = useState<WorkpaperFormState>(() => emptyWorkpaper(period, userDisplay))
  const [workpaperErrors, setWorkpaperErrors] = useState<Record<string, string>>({})
  const [workpaperMessage, setWorkpaperMessage] = useState<string | null>(null)
  const [workpaperBusy, setWorkpaperBusy] = useState(false)

  const [journalBase, setJournalBase] = useState(() => JSON.stringify(emptyJournal(period)))
  const [workpaperBase, setWorkpaperBase] = useState(() => JSON.stringify(emptyWorkpaper(period, userDisplay)))
  const [journalOpen, setJournalOpen] = useState(false)
  const [workpaperOpen, setWorkpaperOpen] = useState(false)
  const [pendingJournal, setPendingJournal] = useState<(() => void) | null>(null)
  const [pendingWorkpaper, setPendingWorkpaper] = useState<(() => void) | null>(null)

  const selectedJournal = journals.find((record) => record.id === selectedJournalId) ?? null
  const selectedWorkpaper = workpapers.find((record) => record.id === selectedWorkpaperId) ?? null
  const journalDirty = JSON.stringify(journalForm) !== journalBase
  const workpaperDirty = JSON.stringify(workpaperForm) !== workpaperBase

  const loadJournal = (id: string | null, form: JournalFormState) => {
    setSelectedJournalId(id)
    setJournalForm(form)
    setJournalBase(JSON.stringify(form))
    setJournalErrors({})
    setJournalMessage(null)
    setPendingJournal(null)
    setJournalOpen(true)
  }
  const loadWorkpaper = (id: string | null, form: WorkpaperFormState) => {
    setSelectedWorkpaperId(id)
    setWorkpaperForm(form)
    setWorkpaperBase(JSON.stringify(form))
    setWorkpaperErrors({})
    setWorkpaperMessage(null)
    setPendingWorkpaper(null)
    setWorkpaperOpen(true)
  }
  // Replacing a form that has unsaved edits needs explicit confirmation.
  const guardJournal = (action: () => void) => { if (journalDirty) setPendingJournal(() => action); else action() }
  const guardWorkpaper = (action: () => void) => { if (workpaperDirty) setPendingWorkpaper(() => action); else action() }

  // Reload the form when the open record itself changes (for example after posting or reversing it).
  useEffect(() => {
    if (!selectedJournal) return
    const form = journalToForm(selectedJournal)
    setJournalForm(form)
    setJournalBase(JSON.stringify(form))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJournal?.id, selectedJournal?.version])

  useEffect(() => {
    if (!selectedWorkpaper) return
    const form = workpaperToForm(selectedWorkpaper)
    setWorkpaperForm(form)
    setWorkpaperBase(JSON.stringify(form))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkpaper?.id, selectedWorkpaper?.updatedAt])

  // A new, untouched form follows the selected period; edited work is never overwritten.
  useEffect(() => {
    if (!selectedJournalId && !journalDirty) {
      const form = emptyJournal(period)
      setJournalForm(form)
      setJournalBase(JSON.stringify(form))
    }
    if (!selectedWorkpaperId && !workpaperDirty) {
      const form = emptyWorkpaper(period, userDisplay)
      setWorkpaperForm(form)
      setWorkpaperBase(JSON.stringify(form))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.year, period.month, userDisplay])

  const readiness = useMemo(() => journalReadiness(journalForm.lines), [journalForm.lines])
  const balanceLabel = readiness.state === 'balanced' ? 'Balanced' : readiness.state === 'empty' ? 'Nothing entered' : 'Not balanced'
  const postedEntries = journals.filter((record) => record.status !== 'Draft')
  const periodWorkpapers = workpapers.filter((record) => record.input.period === periodKey(period))

  const template = (type: AdjustingEntryType): JournalFormState => {
    const expense = selectableAccounts.find((account) => /expense/i.test(account.accountType) || /expense/i.test(account.name)) ?? selectableAccounts.find((account) => account.name === 'Depreciation Expense')
    const income = selectableAccounts.find((account) => /income/i.test(account.accountType) || /revenue/i.test(account.name))
    const ar = selectableAccounts.find((account) => /receivable/i.test(account.name))
    const prepaid = selectableAccounts.find((account) => account.name === 'Prepaid Expenses')
    const accrued = selectableAccounts.find((account) => account.name === 'Accrued Liabilities')
    const contra = selectableAccounts.find((account) => account.name === 'Accumulated Depreciation')
    const depreciationExpense = selectableAccounts.find((account) => account.name === 'Depreciation Expense') ?? expense
    const base = emptyJournal(period)
    switch (type) {
      case 'Accrued Expense':
        return { ...base, description: 'Accrue month-end operating expense', referenceNumber: 'ADJ-ACCRUAL', adjustmentType: type, explanation: 'Records an expense incurred this month but not billed until next month.', lines: [{ accountId: expense?.id ?? '', debit: '325.00', credit: '', memo: 'Month-end accrual' }, { accountId: accrued?.id ?? '', debit: '', credit: '325.00', memo: 'Accrued liability' }] }
      case 'Prepaid Expense':
        return { ...base, description: 'Amortize prepaid insurance', referenceNumber: 'ADJ-PREPAID', adjustmentType: type, explanation: 'Moves the used portion of a prepaid asset into expense for this month.', lines: [{ accountId: expense?.id ?? '', debit: '180.00', credit: '', memo: 'Insurance expense' }, { accountId: prepaid?.id ?? '', debit: '', credit: '180.00', memo: 'Reduce prepaid balance' }] }
      case 'Depreciation':
        return { ...base, description: 'Record monthly equipment depreciation', referenceNumber: 'ADJ-DEPR', adjustmentType: type, explanation: 'Recognizes this month’s depreciation on shop and field equipment.', lines: [{ accountId: depreciationExpense?.id ?? '', debit: '250.00', credit: '', memo: 'Monthly depreciation' }, { accountId: contra?.id ?? '', debit: '', credit: '250.00', memo: 'Accumulated depreciation' }] }
      case 'Accrued Income':
        return { ...base, description: 'Accrue unbilled service revenue', referenceNumber: 'ADJ-INCOME', adjustmentType: type, explanation: 'Recognizes earned revenue that has not been invoiced yet.', lines: [{ accountId: ar?.id ?? '', debit: '410.00', credit: '', memo: 'Unbilled receivable' }, { accountId: income?.id ?? '', debit: '', credit: '410.00', memo: 'Accrued revenue' }] }
      case 'Correction':
        return { ...base, description: 'Correct prior miscoding', referenceNumber: 'ADJ-CORR', adjustmentType: type, explanation: 'Moves a prior posting into the correct account without changing cash.', lines: [{ accountId: expense?.id ?? '', debit: '95.00', credit: '', memo: 'Correct target account' }, { accountId: selectableAccounts.find((account) => account.id !== expense?.id)?.id ?? '', debit: '', credit: '95.00', memo: 'Reverse prior coding' }] }
      default:
        return { ...base, description: 'Reclassify current-period balance', referenceNumber: 'ADJ-RECLASS', adjustmentType: type, explanation: 'Reclassifies a balance between accounts with no cash effect.', lines: [{ accountId: expense?.id ?? '', debit: '120.00', credit: '', memo: 'Receiving account' }, { accountId: selectableAccounts.find((account) => account.id !== expense?.id)?.id ?? '', debit: '', credit: '120.00', memo: 'Giving account' }] }
    }
  }

  const toJournalInput = (): DemoJournalEntryInput => ({
    date: journalForm.date,
    description: journalForm.description,
    referenceNumber: journalForm.referenceNumber,
    ...(journalForm.adjustmentType ? { adjustmentType: journalForm.adjustmentType } : {}),
    ...(journalForm.explanation.trim() ? { explanation: journalForm.explanation.trim() } : {}),
    lines: journalForm.lines.map((line) => ({
      accountId: line.accountId,
      debitCents: parseAmount(line.debit),
      creditCents: parseAmount(line.credit),
      memo: line.memo,
    })),
  })

  const toWorkpaperInput = (): DemoWorkpaperInput => ({
    title: workpaperForm.title,
    period: workpaperForm.period,
    accountId: workpaperForm.accountId,
    note: workpaperForm.note,
    supportingDocumentRefs: splitList(workpaperForm.supportingDocumentRefs),
    reconciliationLinks: splitList(workpaperForm.reconciliationLinks),
    adjustingEntryIds: splitList(workpaperForm.adjustingEntryIds),
    reviewStatus: workpaperForm.reviewStatus,
    preparedBy: workpaperForm.preparedBy,
    ...(workpaperForm.reviewedBy.trim() ? { reviewedBy: workpaperForm.reviewedBy.trim() } : {}),
    workDate: workpaperForm.workDate,
  })

  const applyErrors = (error: unknown, setter: (value: Record<string, string>) => void, fallback: string) => {
    const fields = typeof error === 'object' && error !== null && 'fields' in error ? (error as { fields?: Record<string, string> }).fields : undefined
    setter(fields ?? {})
    return error instanceof Error ? error.message : fallback
  }

  const saveJournal = async () => {
    setJournalBusy(true)
    setJournalErrors({})
    setJournalMessage(null)
    try {
      if (selectedJournal?.status === 'Draft') await onUpdateJournal(selectedJournal, toJournalInput())
      else await onCreateJournal(toJournalInput())
      loadJournal(null, emptyJournal(period))
      setJournalMessage(selectedJournal?.status === 'Draft' ? 'Draft journal updated.' : 'Draft journal created.')
    } catch (error) {
      setJournalMessage(applyErrors(error, setJournalErrors, 'The journal entry could not be saved.'))
    } finally {
      setJournalBusy(false)
    }
  }

  const postJournal = async () => {
    if (!selectedJournal || selectedJournal.status !== 'Draft') return
    setJournalBusy(true)
    setJournalErrors({})
    setJournalMessage(null)
    try {
      await onPostJournal(selectedJournal)
      setJournalMessage('Journal entry posted to the demo books.')
    } catch (error) {
      setJournalMessage(applyErrors(error, setJournalErrors, 'The journal entry could not be posted.'))
    } finally {
      setJournalBusy(false)
    }
  }

  const reverseJournal = async () => {
    if (!selectedJournal || selectedJournal.status !== 'Posted') return
    setJournalBusy(true)
    setJournalMessage(null)
    try {
      await onReverseJournal(selectedJournal, reverseReason)
      setReverseReason('')
      setJournalMessage('Posted journal entry reversed.')
    } catch (error) {
      setJournalMessage(error instanceof Error ? error.message : 'The journal entry could not be reversed.')
    } finally {
      setJournalBusy(false)
    }
  }

  const saveWorkpaper = async () => {
    setWorkpaperBusy(true)
    setWorkpaperErrors({})
    setWorkpaperMessage(null)
    try {
      if (selectedWorkpaper) await onUpdateWorkpaper(selectedWorkpaper, toWorkpaperInput())
      else await onCreateWorkpaper(toWorkpaperInput())
      loadWorkpaper(null, emptyWorkpaper(period, userDisplay))
      setWorkpaperMessage(selectedWorkpaper ? 'Workpaper updated.' : 'Workpaper saved.')
    } catch (error) {
      setWorkpaperMessage(applyErrors(error, setWorkpaperErrors, 'The workpaper could not be saved.'))
    } finally {
      setWorkpaperBusy(false)
    }
  }

  if (source === 'quickbooks') {
    return (
      <div className="accountant-tools-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Journal Entries</h2>
              <p className="muted">Read-only in QuickBooks Sandbox mode.</p>
            </div>
          </div>
          <p className="muted">LedgerOps does not create, post, or reverse QuickBooks journal entries here. Use demo mode to test journal workflows safely.</p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Workpapers</h2>
              <p className="muted">Demo-only preparation workflow.</p>
            </div>
          </div>
          <p className="muted">Workpapers stay in LedgerOps demo storage. QuickBooks mode continues to show reports and ledgers as read-only information only.</p>
        </section>
      </div>
    )
  }

  return (
    <div className="accountant-tools-grid">
      <Disclosure
        id="journal-section"
        title="Journal Entries"
        countLabel={`${journals.length} ${journals.length === 1 ? 'entry' : 'entries'}`}
        open={journalOpen}
        onToggle={() => setJournalOpen(!journalOpen)}
        unsaved={journalDirty}
        action={<button type="button" className="primary-button" onClick={() => guardJournal(() => loadJournal(null, emptyJournal(period)))}>New journal entry</button>}
      >
        <p className="muted">Draft, post, reverse, and review adjusting entries for {clientName}. Posted demo entries flow into the General Ledger, Trial Balance, Balance Sheet, and Profit and Loss.</p>
        <fieldset className="accountant-templates">
          <legend>Adjusting entry templates</legend>
          <p className="muted">Choosing a template only fills in the form below. Nothing is posted: every journal entry needs your review, and a saved draft must be posted separately.</p>
          <div className="accountant-template-row" aria-label="Adjusting entry templates">
            {(['Accrued Expense', 'Prepaid Expense', 'Depreciation', 'Accrued Income', 'Correction', 'Reclassification'] as const).map((option) => (
              <button type="button" key={option} className="filter-button" onClick={() => guardJournal(() => loadJournal(null, template(option)))}>
                {option}
              </button>
            ))}
          </div>
        </fieldset>
        {pendingJournal && <DiscardWarning what="journal entry" onDiscard={() => { const next = pendingJournal; setPendingJournal(null); next() }} onKeep={() => setPendingJournal(null)} />}
        <div className="accountant-split">
          <div className="accountant-form">
            <div className="queue-filters">
              <label>
                Entry date
                <input aria-label="Entry date" type="date" value={journalForm.date} onChange={(event) => setJournalForm({ ...journalForm, date: event.target.value })} />
              </label>
              <label>
                Reference number
                <input aria-label="Reference number" value={journalForm.referenceNumber} onChange={(event) => setJournalForm({ ...journalForm, referenceNumber: event.target.value })} />
              </label>
              <label>
                Adjustment type
                <select aria-label="Adjustment type" value={journalForm.adjustmentType} onChange={(event) => setJournalForm({ ...journalForm, adjustmentType: event.target.value as JournalFormState['adjustmentType'] })}>
                  <option value="">General journal entry</option>
                  {(['Accrued Expense', 'Prepaid Expense', 'Depreciation', 'Accrued Income', 'Correction', 'Reclassification'] as const).map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
            </div>
            <label>
              Description
              <input aria-label="Journal description" value={journalForm.description} onChange={(event) => setJournalForm({ ...journalForm, description: event.target.value })} />
            </label>
            <label>
              Explanation
              <textarea aria-label="Journal explanation" value={journalForm.explanation} onChange={(event) => setJournalForm({ ...journalForm, explanation: event.target.value })} />
            </label>
            <div className="journal-line-list">
              <div className="journal-line-heading">
                <strong>Journal lines</strong>
                <small data-testid="journal-balance-status" className={`balance-pill ${readiness.state}`}>{balanceLabel}</small>
              </div>
              <div className="journal-table-scroll">
                <table className="journal-lines-table">
                  <thead>
                    <tr><th scope="col">Account</th><th scope="col">Debit</th><th scope="col">Credit</th><th scope="col">Memo</th><th scope="col">Remove</th></tr>
                  </thead>
                  <tbody>
                    {journalForm.lines.map((line, index) => (
                      <tr key={`${index}-${selectedJournalId ?? 'new'}`}>
                        <td>
                          <select aria-label={`Line ${index + 1} account`} value={line.accountId} onChange={(event) => setJournalForm({ ...journalForm, lines: journalForm.lines.map((item, row) => row === index ? { ...item, accountId: event.target.value } : item) })}>
                            <option value="">Choose account</option>
                            {selectableAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                          </select>
                        </td>
                        <td><input inputMode="decimal" aria-label={`Line ${index + 1} debit`} value={line.debit} onChange={(event) => setJournalForm({ ...journalForm, lines: journalForm.lines.map((item, row) => row === index ? { ...item, debit: event.target.value } : item) })} /></td>
                        <td><input inputMode="decimal" aria-label={`Line ${index + 1} credit`} value={line.credit} onChange={(event) => setJournalForm({ ...journalForm, lines: journalForm.lines.map((item, row) => row === index ? { ...item, credit: event.target.value } : item) })} /></td>
                        <td><input aria-label={`Line ${index + 1} memo`} value={line.memo} onChange={(event) => setJournalForm({ ...journalForm, lines: journalForm.lines.map((item, row) => row === index ? { ...item, memo: event.target.value } : item) })} /></td>
                        <td><button type="button" className="secondary-button" aria-label={`Remove line ${index + 1}`} disabled={journalForm.lines.length <= 2} onClick={() => setJournalForm({ ...journalForm, lines: journalForm.lines.filter((_, row) => row !== index) })}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="reset-actions">
              <button type="button" className="secondary-button" onClick={() => setJournalForm({ ...journalForm, lines: [...journalForm.lines, { accountId: '', debit: '', credit: '', memo: '' }] })}>Add line</button>
            </div>
            <div className="journal-totals" data-testid="journal-totals">
              <span>Total debits: <strong data-testid="total-debits">{formatCents(readiness.debitCents)}</strong></span>
              <span>Total credits: <strong data-testid="total-credits">{formatCents(readiness.creditCents)}</strong></span>
              <span>Difference: <strong data-testid="journal-difference">{formatCents(Math.abs(readiness.differenceCents))}</strong></span>
            </div>
            {!readiness.ready && <ul className="muted journal-readiness" data-testid="journal-readiness">{readiness.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
            {journalMessage && <div className={`data-state-message ${Object.keys(journalErrors).length > 0 ? 'error' : ''}`}>{journalMessage}</div>}
            <div className="reset-actions">
              <button type="button" className="primary-button" disabled={journalBusy} onClick={() => void saveJournal()}>{selectedJournal?.status === 'Draft' ? 'Update draft' : 'Save draft'} <span>→</span></button>
              {selectedJournal?.status === 'Draft' && <button type="button" className="secondary-button" disabled={journalBusy || journalDirty || !readiness.ready} onClick={() => void postJournal()}>Post journal entry</button>}
            </div>
            {selectedJournal?.status === 'Draft' && journalDirty && <p className="muted">Update the draft before posting so the posted entry matches what you see.</p>}
            {selectedJournal?.status === 'Posted' && (
              <div className="portal-compose">
                <label>
                  Reversal reason
                  <textarea aria-label="Reversal reason" value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} placeholder="Explain why this posted journal is being reversed." />
                </label>
                <div className="reset-actions">
                  <button className="secondary-button" disabled={journalBusy} onClick={() => void reverseJournal()}>Reverse entry</button>
                </div>
              </div>
            )}
          </div>
          <div className="accountant-sidebar">
            <div className="accountant-summary">
              <strong>{journals.length}</strong>
              <span>journal records</span>
            </div>
            <div className="audit-log-list">
              {journals.map((record) => (
                <button type="button" className={`audit-log-row selectable ${selectedJournalId === record.id ? 'selected' : ''}`} key={record.id} onClick={() => guardJournal(() => loadJournal(record.id, journalToForm(record)))}>
                  <strong>{record.input.description}</strong>
                  <span>{record.status} · {record.input.date}</span>
                  <span>{record.input.referenceNumber || 'No reference'} · {formatCents(record.input.lines.reduce((sum, line) => sum + line.debitCents, 0))}</span>
                </button>
              ))}
              {journals.length === 0 && <p className="muted">No journal entries yet.</p>}
            </div>
            {selectedJournal && (
              <div className="history-panel">
                <h3>History</h3>
                <div className="audit-log-list">
                  {selectedJournal.history.map((item) => (
                    <div className="audit-log-row" key={`${selectedJournal.id}-${item.at}-${item.action}`}>
                      <strong>{item.summary}</strong>
                      <span>{item.by} · {new Date(item.at).toLocaleString()}</span>
                      {item.reason && <span>{item.reason}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {postedEntries.length > 0 && (
              <div className="history-panel">
                <h3>Period activity</h3>
                <p className="muted">{postedEntries.filter((record) => record.input.date.startsWith(periodKey(period))).length} posted journal entries fall in {periodKey(period)}.</p>
              </div>
            )}
          </div>
        </div>
      </Disclosure>

      <Disclosure
        id="workpaper-section"
        title="Workpapers"
        countLabel={`${workpapers.length} ${workpapers.length === 1 ? 'workpaper' : 'workpapers'}`}
        open={workpaperOpen}
        onToggle={() => setWorkpaperOpen(!workpaperOpen)}
        unsaved={workpaperDirty}
        action={<button type="button" className="primary-button" onClick={() => guardWorkpaper(() => loadWorkpaper(null, emptyWorkpaper(period, userDisplay)))}>New workpaper</button>}
      >
        <p className="muted">Account review notes, supporting references, reconciliation links, and adjusting-entry references for {clientName}. Documents are referenced by name only; LedgerOps does not upload files.</p>
        {pendingWorkpaper && <DiscardWarning what="workpaper" onDiscard={() => { const next = pendingWorkpaper; setPendingWorkpaper(null); next() }} onKeep={() => setPendingWorkpaper(null)} />}
        <div className="accountant-split">
          <div className="accountant-form">
            <fieldset className="accountant-fieldset">
              <legend>Basic information</legend>
              <div className="queue-filters">
                <label>
                  Title
                  <input aria-label="Workpaper title" value={workpaperForm.title} onChange={(event) => setWorkpaperForm({ ...workpaperForm, title: event.target.value })} />
                </label>
                <label>
                  Period
                  <input aria-label="Workpaper period" value={workpaperForm.period} onChange={(event) => setWorkpaperForm({ ...workpaperForm, period: event.target.value })} />
                </label>
                <label>
                  Account
                  <select aria-label="Workpaper account" value={workpaperForm.accountId} onChange={(event) => setWorkpaperForm({ ...workpaperForm, accountId: event.target.value })}>
                    <option value="">Choose account</option>
                    {selectableAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                  </select>
                </label>
              </div>
            </fieldset>
            <fieldset className="accountant-fieldset">
              <legend>Review details</legend>
              <label>
                Account review notes
                <textarea aria-label="Account review notes" value={workpaperForm.note} onChange={(event) => setWorkpaperForm({ ...workpaperForm, note: event.target.value })} />
              </label>
              <div className="queue-filters">
                <label>
                  Supporting document references
                  <input aria-label="Supporting document references" value={workpaperForm.supportingDocumentRefs} onChange={(event) => setWorkpaperForm({ ...workpaperForm, supportingDocumentRefs: event.target.value })} placeholder="Receipt-114, BankStmt-Aug" />
                </label>
                <label>
                  Reconciliation links
                  <input aria-label="Reconciliation links" value={workpaperForm.reconciliationLinks} onChange={(event) => setWorkpaperForm({ ...workpaperForm, reconciliationLinks: event.target.value })} placeholder="chase-checking-2026-08" />
                </label>
                <label>
                  Adjusting entry references
                  <input aria-label="Adjusting entry references" value={workpaperForm.adjustingEntryIds} onChange={(event) => setWorkpaperForm({ ...workpaperForm, adjustingEntryIds: event.target.value })} placeholder="journal-123, journal-456" />
                </label>
              </div>
            </fieldset>
            <fieldset className="accountant-fieldset">
              <legend>Approval</legend>
              <div className="queue-filters">
                <label>
                  Review status
                  <select aria-label="Workpaper status" value={workpaperForm.reviewStatus} onChange={(event) => setWorkpaperForm({ ...workpaperForm, reviewStatus: event.target.value as WorkpaperStatus })}>
                    <option value="Open">Open</option>
                    <option value="Prepared">Prepared</option>
                    <option value="Reviewed">Reviewed</option>
                  </select>
                </label>
                <label>
                  Prepared by
                  <input aria-label="Prepared by" value={workpaperForm.preparedBy} onChange={(event) => setWorkpaperForm({ ...workpaperForm, preparedBy: event.target.value })} />
                </label>
                <label>
                  Reviewed by
                  <input aria-label="Reviewed by" value={workpaperForm.reviewedBy} onChange={(event) => setWorkpaperForm({ ...workpaperForm, reviewedBy: event.target.value })} />
                </label>
                <label>
                  Workpaper date
                  <input aria-label="Workpaper date" type="date" value={workpaperForm.workDate} onChange={(event) => setWorkpaperForm({ ...workpaperForm, workDate: event.target.value })} />
                </label>
              </div>
            </fieldset>
            {workpaperMessage && <div className={`data-state-message ${Object.keys(workpaperErrors).length > 0 ? 'error' : ''}`}>{workpaperMessage}</div>}
            <div className="reset-actions">
              <button type="button" className="primary-button" disabled={workpaperBusy} onClick={() => void saveWorkpaper()}>{selectedWorkpaper ? 'Update workpaper' : 'Save workpaper'} <span>→</span></button>
            </div>
          </div>
          <div className="accountant-sidebar">
            <div className="accountant-summary">
              <strong>{periodWorkpapers.length}</strong>
              <span>workpapers this period</span>
            </div>
            <div className="audit-log-list">
              {workpapers.map((record) => (
                <button type="button" className={`audit-log-row selectable ${selectedWorkpaperId === record.id ? 'selected' : ''}`} key={record.id} onClick={() => guardWorkpaper(() => loadWorkpaper(record.id, workpaperToForm(record)))}>
                  <strong>{record.input.title}</strong>
                  <span>{record.input.period} · {record.input.reviewStatus}</span>
                  <span>{record.input.preparedBy}{record.input.reviewedBy ? ` / ${record.input.reviewedBy}` : ''}</span>
                </button>
              ))}
              {workpapers.length === 0 && <p className="muted">No workpapers yet.</p>}
            </div>
            {selectedWorkpaper && (
              <div className="history-panel">
                <h3>Workpaper history</h3>
                <div className="audit-log-list">
                  {selectedWorkpaper.history.map((item) => (
                    <div className="audit-log-row" key={`${selectedWorkpaper.id}-${item.at}-${item.action}`}>
                      <strong>{item.summary}</strong>
                      <span>{item.by} · {new Date(item.at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </Disclosure>
    </div>
  )
}
