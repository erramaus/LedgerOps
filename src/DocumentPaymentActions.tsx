import { useEffect, useState } from 'react'
import { DEMO_RECONCILIATION_ACCOUNTS } from '../shared/demoBooks'
import { getAdditionalDemoCompany } from '../shared/demoCompanyBooks'
import type { DemoDocumentPayment, DemoPaymentBook, DemoPaymentInput, DocumentPaymentKind } from '../shared/demoPayments'
import { formatCents, isValidIsoDate, parseMoneyToCents } from '../shared/reconciliation'
import { DemoPaymentApiError } from './services/demoPaymentService'

const banksFor = (clientId: string) => clientId === 'abc-plumbing' ? DEMO_RECONCILIATION_ACCOUNTS.filter((account) => account.kind === 'bank') : getAdditionalDemoCompany(clientId)?.reconciliationAccounts.filter((account) => account.kind === 'bank') ?? []
const moneyInput = (cents: number) => (cents / 100).toFixed(2)
const time = (iso: string) => iso.replace('T', ' ').slice(0, 16)

type Props = {
  kind: DocumentPaymentKind
  clientId: string
  book: DemoPaymentBook | undefined
  originalPaidCents: number
  amountCents: number
  dateDefault: string
  readOnly: boolean
  onRecord: (input: DemoPaymentInput) => Promise<void>
  onReverse: (payment: DemoDocumentPayment, reason: string) => Promise<void>
}

export function DocumentPaymentActions({ kind, clientId, book, originalPaidCents, amountCents, dateDefault, readOnly, onRecord, onReverse }: Props) {
  const bankAccounts = banksFor(clientId)
  const remainingCents = Math.max(0, amountCents - originalPaidCents - (book?.payments.reduce((sum, payment) => sum + (payment.status === 'active' ? payment.amountCents : 0), 0) ?? 0))
  const [date, setDate] = useState(dateDefault)
  const [amount, setAmount] = useState(() => moneyInput(remainingCents))
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reversingId, setReversingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const parsedAmountCents = parseMoneyToCents(amount)
  const projectedRemaining = parsedAmountCents === null ? remainingCents : remainingCents - parsedAmountCents
  const inputError = !isValidIsoDate(date)
    ? 'Enter a valid payment date.'
    : parsedAmountCents === null || parsedAmountCents <= 0
      ? 'Enter a payment greater than zero.'
      : parsedAmountCents > remainingCents
        ? `Payment exceeds the remaining balance of ${formatCents(remainingCents)}.`
        : !bankAccountId
          ? 'Choose a bank account.'
          : null

  useEffect(() => {
    setAmount(moneyInput(remainingCents))
  }, [remainingCents])

  const record = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (inputError || parsedAmountCents === null) return setError(inputError ?? 'Enter a valid payment.')
    setBusy(true)
    try {
      await onRecord({ date, amountCents: parsedAmountCents, bankAccountId })
    } catch (failure) {
      setError(failure instanceof DemoPaymentApiError ? failure.message : failure instanceof Error ? failure.message : 'The payment could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const reverse = async (payment: DemoDocumentPayment) => {
    if (reason.trim().length < 5) return setError('Give a reason of at least five characters. It is kept in the payment history.')
    setBusy(true)
    setError(null)
    try {
      await onReverse(payment, reason.trim())
      setReversingId(null)
      setReason('')
    } catch (failure) {
      setError(failure instanceof DemoPaymentApiError ? failure.message : failure instanceof Error ? failure.message : 'The payment could not be reversed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="payment-actions" data-testid={`${kind}-payment-actions`}>
      <h3>Payment history</h3>
      <p className="muted">Total paid: {formatCents(amountCents - remainingCents)} · Remaining: <strong data-testid={`${kind}-remaining`}>{formatCents(remainingCents)}</strong></p>
      {readOnly ? (
        <div className="data-state-message" role="status">QuickBooks Sandbox is read-only here. Record or reverse this payment in QuickBooks; LedgerOps does not create QuickBooks payments.</div>
      ) : remainingCents > 0 ? (
        <form className="recon-form" aria-label={`${kind === 'invoice' ? 'Customer' : 'Vendor'} payment form`} onSubmit={(event) => void record(event)}>
          <div className="recon-fields">
            <label>Payment date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
            <label>Payment amount<input inputMode="decimal" aria-label="Payment amount" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
            <label>Deposit to bank account
              <select aria-label="Deposit to bank account" value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)}>
                <option value="">Choose an account</option>
                {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            </label>
          </div>
          <p className="muted" data-testid={`${kind}-projected-remaining`}>
            {projectedRemaining >= 0 ? `Remaining after payment: ${formatCents(projectedRemaining)}${projectedRemaining === 0 ? ' · Full payment' : parsedAmountCents !== null && parsedAmountCents > 0 ? ' · Partial payment' : ''}` : `Exceeds remaining balance by ${formatCents(-projectedRemaining)}`}
          </p>
          {inputError && amount.trim() && <small className="field-error" role="alert">{inputError}</small>}
          {error && <div className="data-state-message error" role="alert">{error}</div>}
          <button className="primary-button" type="submit" disabled={busy || Boolean(inputError)}>
            {busy ? 'Saving payment…' : parsedAmountCents === remainingCents ? `Record full payment ${formatCents(remainingCents)}` : 'Record partial payment'}
          </button>
        </form>
      ) : <div className="data-state-message" role="status">This document is fully paid.</div>}
      {book?.payments.map((payment) => (
        <div className="payment-history-row" key={payment.id} data-testid="payment-history-row">
          <div>
            <strong>{formatCents(payment.amountCents)}</strong> · {payment.date} · {bankAccounts.find((account) => account.id === payment.bankAccountId)?.name ?? payment.bankAccountId}
            <span className={`inbox-status ${payment.status === 'active' ? 'resolved' : 'open'}`}>{payment.status === 'active' ? 'Recorded' : 'Reversed'}</span>
            {payment.history.map((event, index) => <small key={`${event.at}-${index}`}>{time(event.at)} · {event.by} · {event.action}: {event.summary}{event.reason ? ` Reason: ${event.reason}` : ''}</small>)}
          </div>
          {!readOnly && payment.status === 'active' && (
            <div>
              {reversingId === payment.id ? (
                <div className="recon-form">
                  <label>Reason for reversal<input value={reason} onChange={(event) => setReason(event.target.value)} /></label>
                  <div className="recon-actions">
                    <button className="secondary-button" disabled={busy || reason.trim().length < 5} onClick={() => void reverse(payment)}>Confirm reversal</button>
                    <button className="text-button" disabled={busy} onClick={() => { setReversingId(null); setReason(''); setError(null) }}>Cancel</button>
                  </div>
                </div>
              ) : <button className="text-button" disabled={busy} onClick={() => { setReversingId(payment.id); setError(null) }}>Reverse payment</button>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
