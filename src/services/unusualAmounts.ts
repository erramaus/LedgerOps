import type { Transaction } from './bookkeepingTypes'

/**
 * Client-aware "unusually large amount" detection. Every company is judged only against its own history,
 * so a routine construction expense is never compared with a dental practice's normal activity.
 * This is a pattern check, not a statement that a transaction is wrong.
 */
export type UnusualBasis = 'client' | 'vendor' | 'fallback'

export type UnusualAmount = {
  basis: UnusualBasis
  amount: number
  /** The typical amount the transaction was compared with; absent for the fallback. */
  typical?: number
  /** How many other transactions the comparison rests on. */
  sample: number
  explanation: string
}

/** Fewer transactions than this is not enough to say what is "typical" for a client. */
export const MIN_CLIENT_HISTORY = 12
/** At least this many other transactions with the same payee before vendor history is used. */
export const MIN_VENDOR_HISTORY = 4
/** Conservative limit used only when the client has too little history. */
export const FALLBACK_LIMIT = 5000
/** How many robust standard deviations above the client's typical (log) amount counts as unusual. */
const CLIENT_SCORE = 3.5
/** Never flag an amount that is less than this multiple of the client's typical amount, however tight the history. */
const MIN_MULTIPLE = 3

export const parseAmountValue = (value: string) => {
  const amount = Math.abs(Number(value.replace(/[$,()\s-]/g, '')))
  return Number.isFinite(amount) ? amount : 0
}

const money = (value: number) => `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const times = (ratio: number) => (ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10)
const payeeKey = (transaction: Transaction) => (transaction.payee ?? '').trim().toLowerCase()
const knownPayee = (key: string) => key !== '' && key !== 'unknown'

/** Assesses one client's transactions. The result maps a transaction id to why it is unusually large; routine ones are absent. */
export function unusualAmounts(transactions: Transaction[]): Map<string, UnusualAmount> {
  const result = new Map<string, UnusualAmount>()
  const rows = transactions.map((transaction) => ({ transaction, amount: parseAmountValue(transaction.amount), payee: payeeKey(transaction) })).filter((row) => row.amount > 0)
  const enough = rows.length >= MIN_CLIENT_HISTORY

  if (!enough) {
    rows.filter((row) => row.amount >= FALLBACK_LIMIT).forEach((row) => {
      result.set(row.transaction.id, {
        basis: 'fallback', amount: row.amount, sample: rows.length - 1,
        explanation: `This amount (${money(row.amount)}) is at or above ${money(FALLBACK_LIMIT)}. There are only ${rows.length} transactions for this client, which is too little history to know what is typical, so a conservative fixed limit was used.`,
      })
    })
    return result
  }

  const logs = rows.map((row) => Math.log10(row.amount))
  const center = median(logs)
  const spread = Math.max(1.4826 * median(logs.map((value) => Math.abs(value - center))), 0.1)
  const typicalClient = 10 ** center

  rows.forEach((row, index) => {
    const others = rows.filter((other, otherIndex) => otherIndex !== index && knownPayee(row.payee) && other.payee === row.payee).map((other) => other.amount)
    if (others.length >= MIN_VENDOR_HISTORY) {
      const usual = median(others)
      if (row.amount >= 3 * usual && row.amount > 2 * Math.max(...others)) {
        result.set(row.transaction.id, {
          basis: 'vendor', amount: row.amount, typical: usual, sample: others.length,
          explanation: `This amount (${money(row.amount)}) is about ${times(row.amount / usual)} times what this client usually pays or receives with ${row.transaction.payee} (typical ${money(usual)} across ${others.length} other transactions) and larger than any of them.`,
        })
        return
      }
    }
    if ((logs[index] - center) / spread >= CLIENT_SCORE && row.amount >= MIN_MULTIPLE * typicalClient) {
      result.set(row.transaction.id, {
        basis: 'client', amount: row.amount, typical: typicalClient, sample: rows.length - 1,
        explanation: `This amount (${money(row.amount)}) is significantly larger than this client's typical transactions (typical about ${money(typicalClient)}, based on ${rows.length - 1} other transactions; this one is about ${times(row.amount / typicalClient)} times larger).`,
      })
    }
  })
  return result
}

/** Runs the check separately for each client id so one company's activity never sets another's normal. */
export function unusualAmountsByClient(transactions: Transaction[], fallbackClientId = ''): Map<string, UnusualAmount> {
  const groups = new Map<string, Transaction[]>()
  transactions.forEach((transaction) => {
    const key = transaction.clientId ?? fallbackClientId
    groups.set(key, [...(groups.get(key) ?? []), transaction])
  })
  const result = new Map<string, UnusualAmount>()
  groups.forEach((group) => unusualAmounts(group).forEach((value, id) => result.set(id, value)))
  return result
}
