import crypto from 'node:crypto'

// Shapes follow Intuit's documented Purchase entity: expense lines live in Line[] with an
// AccountBasedExpenseLineDetail; the header AccountRef is the account the money was paid from.
export type QbRef = { value?: string; name?: string }
export type QbLine = {
  Id?: string
  Amount?: number
  Description?: string
  DetailType?: string
  AccountBasedExpenseLineDetail?: { AccountRef?: QbRef; [key: string]: unknown }
  [key: string]: unknown
}
export type QbTransaction = {
  Id?: string
  SyncToken?: string
  TxnDate?: string
  TotalAmt?: number
  Amount?: number
  PaymentType?: string
  PrivateNote?: string
  Memo?: string
  AccountRef?: QbRef
  EntityRef?: QbRef
  VendorRef?: QbRef
  CustomerRef?: QbRef
  CurrencyRef?: QbRef
  Line?: QbLine[]
  TxnTaxDetail?: { TotalTax?: number }
  [key: string]: unknown
}
export type QbAccount = { Id?: string; Name?: string; AccountType?: string; Active?: boolean }

export type NormalizedLine = { id: string; description: string; amount: number; category: string; categoryId?: string }
export type NormalizedTransaction = {
  id: string
  quickBooksId?: string
  date: string
  payee: string
  description: string
  amount: string
  totalAmount: number
  category: string
  status: 'Needs Review' | 'Categorized'
  transactionType: string
  source: 'quickbooks'
  account?: string
  lines: NormalizedLine[]
  syncToken?: string
  readOnlyReason?: string
}

export type LineChangeRequest = {
  transactionType: string
  transactionId: string
  syncToken: string
  expectedTotal: number
  changes: { lineId: string; accountId: string }[]
}

export const WRITABLE_TYPES = ['Purchase', 'Check']
// Only expense-like accounts may receive an expense line; the UI mirrors this list.
export const CATEGORY_ACCOUNT_TYPES = ['Expense', 'Other Expense', 'Cost of Goods Sold', 'Fixed Asset', 'Other Current Asset', 'Other Asset']

export class TransactionUpdateError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, status: number, message: string) {
    super(message)
    this.name = 'TransactionUpdateError'
    this.code = code
    this.status = status
  }
}

const cents = (amount: number | undefined) => Math.round(Number(amount ?? 0) * 100)
export const isUncategorized = (category: string | undefined) => !category || /^uncategorized/i.test(category.trim())
const money = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)

/** Why a transaction cannot be safely categorized line by line, or undefined when it can. */
export function getReadOnlyReason(transactionType: string, item: QbTransaction): string | undefined {
  if (!WRITABLE_TYPES.includes(transactionType)) return 'Deposits, transfers and payments are read-only here.'
  if (!item.Id) return 'QuickBooks did not return an id for this transaction.'
  if (!item.SyncToken) return 'QuickBooks did not return a SyncToken, so the transaction cannot be updated safely.'
  const lines = item.Line ?? []
  if (lines.length === 0) return 'This transaction has no lines to categorize.'
  if (lines.some((line) => line.DetailType !== 'AccountBasedExpenseLineDetail')) return 'This transaction has item-based or other line types, which are read-only here.'
  if (lines.some((line) => !line.Id)) return 'Some lines have no QuickBooks id, so they cannot be updated individually.'
  if (lines.some((line) => !line.AccountBasedExpenseLineDetail?.AccountRef?.value)) return 'Some lines have no account, so the structure is not supported.'
  if (item.TxnTaxDetail && Number(item.TxnTaxDetail.TotalTax ?? 0) !== 0) return 'Transactions with tax are read-only here.'
  if (item.CurrencyRef?.value && item.CurrencyRef.value !== 'USD') return 'Foreign-currency transactions are read-only here.'
  const lineTotal = lines.reduce((sum, line) => sum + cents(line.Amount), 0)
  if (lineTotal !== cents(item.TotalAmt)) return 'The line amounts do not add up to the transaction total.'
  return undefined
}

export function summarizeCategory(lines: NormalizedLine[]) {
  const names = new Set(lines.map((line) => line.category))
  return names.size === 1 ? lines[0].category : 'Split'
}

export function normalizeTransaction(transactionType: string, item: QbTransaction): NormalizedTransaction {
  const payee = item.EntityRef?.name || item.VendorRef?.name || item.CustomerRef?.name || 'Unknown'
  const totalAmount = Number(item.Amount ?? item.TotalAmt ?? 0)
  const isExpenseType = WRITABLE_TYPES.includes(transactionType)
  const lines: NormalizedLine[] = isExpenseType
    ? (item.Line ?? [])
        .filter((line) => line.DetailType === 'AccountBasedExpenseLineDetail')
        .map((line, index) => ({
          id: line.Id ?? `line-${index + 1}`,
          description: line.Description ?? '',
          amount: Number(line.Amount ?? 0),
          category: line.AccountBasedExpenseLineDetail?.AccountRef?.name || 'Uncategorized',
          categoryId: line.AccountBasedExpenseLineDetail?.AccountRef?.value,
        }))
    : []
  // For other types the old behaviour is kept: the header account stands in for the category.
  const category = lines.length > 0 ? summarizeCategory(lines) : item.AccountRef?.name || 'Uncategorized'
  const needsReview = lines.length > 0 ? lines.some((line) => isUncategorized(line.category)) : isUncategorized(category)
  const readOnlyReason = getReadOnlyReason(transactionType, item)
  return {
    id: `quickbooks-${transactionType}-${item.Id || crypto.randomUUID()}`,
    quickBooksId: item.Id,
    date: item.TxnDate || 'Unknown date',
    payee,
    description: item.PrivateNote || item.Memo || `${transactionType} from QuickBooks`,
    amount: money(totalAmount),
    totalAmount,
    category,
    status: needsReview ? 'Needs Review' : 'Categorized',
    transactionType,
    source: 'quickbooks',
    account: isExpenseType ? item.AccountRef?.name : undefined,
    lines,
    syncToken: item.SyncToken,
    ...(readOnlyReason ? { readOnlyReason } : {}),
  }
}

/**
 * Builds the full-object update for exactly the requested lines. Every other line and field is
 * copied unchanged, and the original is never mutated.
 */
export function buildLineUpdatePayload(latest: QbTransaction, request: LineChangeRequest, accounts: QbAccount[]): QbTransaction {
  const reason = getReadOnlyReason(request.transactionType, latest)
  if (reason) throw new TransactionUpdateError('UNSUPPORTED', 422, reason)
  if (latest.SyncToken !== request.syncToken) {
    throw new TransactionUpdateError('STALE', 409, 'This transaction changed in QuickBooks after you opened it. Reload it and review the lines again.')
  }
  if (cents(latest.TotalAmt) !== cents(request.expectedTotal)) {
    throw new TransactionUpdateError('STALE', 409, 'The transaction total changed in QuickBooks. Reload it before making changes.')
  }
  const lineIds = request.changes.map((change) => change.lineId)
  if (request.changes.length === 0 || new Set(lineIds).size !== lineIds.length) {
    throw new TransactionUpdateError('INVALID', 400, 'Send each line to change once.')
  }

  const payload = structuredClone(latest)
  const lines = payload.Line ?? []
  let changed = 0
  for (const change of request.changes) {
    const line = lines.find((candidate) => candidate.Id === change.lineId)
    if (!line?.AccountBasedExpenseLineDetail) throw new TransactionUpdateError('INVALID', 400, `Line ${change.lineId} was not found on this transaction.`)
    const account = accounts.find((candidate) => candidate.Id === change.accountId)
    if (!account?.Id) throw new TransactionUpdateError('INVALID', 400, `Account ${change.accountId} was not found in QuickBooks.`)
    if (account.Active === false) throw new TransactionUpdateError('INVALID', 400, `Account "${account.Name}" is inactive.`)
    if (!CATEGORY_ACCOUNT_TYPES.includes(account.AccountType ?? '')) {
      throw new TransactionUpdateError('INVALID', 400, `Account "${account.Name}" cannot be used to categorize an expense line.`)
    }
    if (line.AccountBasedExpenseLineDetail.AccountRef?.value === account.Id) continue
    line.AccountBasedExpenseLineDetail.AccountRef = { value: account.Id, name: account.Name }
    changed += 1
  }
  if (changed === 0) throw new TransactionUpdateError('INVALID', 400, 'None of the lines would change.')

  if (lines.reduce((sum, line) => sum + cents(line.Amount), 0) !== cents(latest.TotalAmt)) {
    throw new TransactionUpdateError('TOTAL_MISMATCH', 422, 'The line amounts would not add up to the transaction total, so the update was stopped.')
  }
  return payload
}

/** Confirms QuickBooks stored exactly what was requested and nothing else changed. */
export function verifyUpdatedTransaction(before: QbTransaction, after: QbTransaction, changes: LineChangeRequest['changes']) {
  const fail = () => new TransactionUpdateError('VERIFY_FAILED', 502, 'QuickBooks returned a transaction that does not match the requested change. Reload it and check it before trying again.')
  const beforeLines = before.Line ?? []
  const afterLines = after.Line ?? []
  if (cents(before.TotalAmt) !== cents(after.TotalAmt) || beforeLines.length !== afterLines.length) throw fail()
  for (const line of beforeLines) {
    const updated = afterLines.find((candidate) => candidate.Id === line.Id)
    if (!updated || cents(updated.Amount) !== cents(line.Amount) || (updated.Description ?? '') !== (line.Description ?? '')) throw fail()
    const requested = changes.find((change) => change.lineId === line.Id)
    const expectedAccount = requested ? requested.accountId : line.AccountBasedExpenseLineDetail?.AccountRef?.value
    if (updated.AccountBasedExpenseLineDetail?.AccountRef?.value !== expectedAccount) throw fail()
  }
}

/** Converts a failed QuickBooks response into an error that is safe to show; never includes tokens. */
export function describeQuickBooksFailure(status: number, body: unknown): TransactionUpdateError {
  const fault = (body as { Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[] } } | undefined)?.Fault?.Error?.[0]
  if (fault?.code === '5010' || /stale/i.test(fault?.Message ?? '')) {
    return new TransactionUpdateError('STALE', 409, 'This transaction changed in QuickBooks after you opened it. Reload it and review the lines again.')
  }
  if (status === 401 || status === 403) return new TransactionUpdateError('AUTH', 502, 'QuickBooks did not accept the connection. Reconnect in Settings and try again.')
  if (status === 429 || status >= 500) return new TransactionUpdateError('UNAVAILABLE', 502, 'QuickBooks is temporarily unavailable. Nothing was changed; try again shortly.')
  const message = fault?.Message ? `: ${fault.Message}`.slice(0, 200) : ''
  return new TransactionUpdateError('REJECTED', 422, `QuickBooks rejected the update${message}`)
}
