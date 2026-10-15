import type { AccountKind, Completeness, Direction, ReconTxn } from '../shared/reconciliation.js'

// Read-only mapping of QuickBooks entities onto one bank or credit-card account's register.
type Ref = { value?: string; name?: string }
export type QbEntity = {
  Id?: string
  TxnDate?: string
  TotalAmt?: number
  Amount?: number
  PrivateNote?: string
  Memo?: string
  PaymentType?: string
  PayType?: string
  Credit?: boolean
  AccountRef?: Ref
  DepositToAccountRef?: Ref
  FromAccountRef?: Ref
  ToAccountRef?: Ref
  BankAccountRef?: Ref
  CreditCardAccountRef?: Ref
  CheckPayment?: { BankAccountRef?: Ref }
  CreditCardPayment?: { CCAccountRef?: Ref }
  EntityRef?: Ref
  VendorRef?: Ref
  CustomerRef?: Ref
  DocNumber?: string
  [key: string]: unknown
}

/** Entities that can be turned into register lines. */
export const SUPPORTED_ENTITIES = ['Purchase', 'Deposit', 'Payment', 'Transfer', 'CreditCardPayment', 'BillPayment'] as const
/** Entities we cannot interpret; if any touches the account, the data is incomplete. */
export const UNSUPPORTED_ENTITIES = ['SalesReceipt', 'RefundReceipt', 'JournalEntry'] as const
export const READ_ENTITIES = [...SUPPORTED_ENTITIES, ...UNSUPPORTED_ENTITIES]

const cents = (value: number | undefined) => Math.round(Number(value ?? 0) * 100)
const flowToDirection = (kind: AccountKind, flow: 'in' | 'out'): Direction => (kind === 'bank' ? (flow === 'in' ? 'increase' : 'decrease') : flow === 'in' ? 'decrease' : 'increase')

/** True when any *AccountRef anywhere inside the entity points at the account. */
export function referencesAccount(node: unknown, accountId: string): boolean {
  if (Array.isArray(node)) return node.some((child) => referencesAccount(child, accountId))
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).some(([key, child]) => {
      if (/AccountRef$/.test(key) && child && typeof child === 'object' && (child as Ref).value === accountId) return true
      return referencesAccount(child, accountId)
    })
  }
  return false
}

function flowFor(entity: string, item: QbEntity, accountId: string): { flow: 'in' | 'out'; amount: number } | null {
  const is = (ref?: Ref) => ref?.value === accountId
  switch (entity) {
    case 'Purchase': return is(item.AccountRef) ? { flow: item.Credit === true ? 'in' : 'out', amount: cents(item.TotalAmt ?? item.Amount) } : null
    case 'Deposit':
    case 'Payment': return is(item.DepositToAccountRef) ? { flow: 'in', amount: cents(item.TotalAmt ?? item.Amount) } : null
    case 'Transfer': return is(item.FromAccountRef) ? { flow: 'out', amount: cents(item.Amount) } : is(item.ToAccountRef) ? { flow: 'in', amount: cents(item.Amount) } : null
    case 'CreditCardPayment': return is(item.BankAccountRef) ? { flow: 'out', amount: cents(item.Amount) } : is(item.CreditCardAccountRef) ? { flow: 'in', amount: cents(item.Amount) } : null
    case 'BillPayment': return is(item.CheckPayment?.BankAccountRef) || is(item.CreditCardPayment?.CCAccountRef) ? { flow: 'out', amount: cents(item.TotalAmt) } : null
    default: return null
  }
}

export type EntityRead = { entity: string; items: QbEntity[]; error?: string; truncated?: boolean; expected?: number }

export function buildAccountRegister(account: { id: string; kind: AccountKind }, reads: EntityRead[], through: string) {
  const transactions: ReconTxn[] = []
  const reasons: string[] = []
  for (const read of reads) {
    if (read.error) { reasons.push(`Could not read ${read.entity} records (${read.error}).`); continue }
    if (read.truncated) reasons.push(`${read.entity} records were cut off at the page limit.`)
    if (read.expected !== undefined && read.expected !== read.items.length) reasons.push(`Read ${read.items.length} of ${read.expected} ${read.entity} records.`)
    const supported = (SUPPORTED_ENTITIES as readonly string[]).includes(read.entity)
    let unsupported = 0
    for (const item of read.items) {
      if (!item.Id) continue
      const date = (item.TxnDate ?? '').slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > through) continue
      if (!supported) {
        if (referencesAccount(item, account.id)) unsupported += 1
        continue
      }
      const hit = flowFor(read.entity, item, account.id)
      if (!hit) continue
      if (hit.amount === 0) continue
      transactions.push({
        id: `${read.entity}-${item.Id}`,
        date,
        payee: item.EntityRef?.name || item.VendorRef?.name || item.CustomerRef?.name || (read.entity === 'Transfer' ? 'Transfer' : read.entity === 'CreditCardPayment' ? 'Credit card payment' : ''),
        memo: item.PrivateNote || item.Memo || item.DocNumber || '',
        amountCents: Math.abs(hit.amount),
        direction: flowToDirection(account.kind, hit.flow),
        type: read.entity,
      })
    }
    if (unsupported > 0) reasons.push(`${unsupported} ${read.entity} record${unsupported === 1 ? '' : 's'} affect this account but cannot be read here. Reconcile this account in QuickBooks.`)
  }
  const completeness: Completeness = { complete: reasons.length === 0, reasons }
  return { transactions: transactions.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id)), completeness }
}
