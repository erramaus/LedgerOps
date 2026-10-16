import type { AutomationSource } from './automationRules'
import type { Transaction } from './bookkeepingTypes'
import type { TaskPriority } from './workQueue'

export type RecurringFrequency = 'Weekly' | 'Monthly' | 'Quarterly'
export type RecurringConfidence = 'High' | 'Medium' | 'Low'

export type RecurringPattern = {
  id: string
  source: AutomationSource
  clientId: string
  vendor: string
  typicalAmountCents: number
  frequency: RecurringFrequency
  expectedNextDate: string
  confidence: RecurringConfidence
  evidence: string[]
  supportingTransactionIds: string[]
  missing: boolean
  reviewPriority: TaskPriority
}

export type RecurringHistoryEntry = {
  id: string
  clientId: string
  source: AutomationSource
  date: string
  payee: string
  description: string
  amountCents: number
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const median = (numbers: number[]) => {
  const sorted = [...numbers].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle]
}
const addDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
const diffDays = (left: string, right: string) => Math.round((Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000)
const formatAmount = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
const parseAmount = (value: string) => Math.round(Number(value.replace(/[$,]/g, '')) * 100)

function detectFrequency(intervals: number[]): { frequency: RecurringFrequency; days: number } | null {
  const average = Math.round(intervals.reduce((sum, value) => sum + value, 0) / intervals.length)
  const within = (target: number, tolerance: number) => intervals.every((value) => Math.abs(value - target) <= tolerance)
  if (average >= 6 && average <= 8 && within(7, 2)) return { frequency: 'Weekly', days: 7 }
  if (average >= 27 && average <= 35 && within(30, 6)) return { frequency: 'Monthly', days: 30 }
  if (average >= 80 && average <= 100 && within(90, 12)) return { frequency: 'Quarterly', days: 90 }
  return null
}

function confidenceFor(count: number, consistentAmount: boolean, frequency: RecurringFrequency): RecurringConfidence {
  if (count >= 4 && consistentAmount && frequency === 'Monthly') return 'High'
  if (count >= 3 && consistentAmount) return 'Medium'
  return 'Low'
}

export function recurringFromHistory(history: RecurringHistoryEntry[], today: string): RecurringPattern[] {
  const byVendor = new Map<string, RecurringHistoryEntry[]>()
  for (const entry of history) {
    const key = `${entry.source}:${entry.clientId}:${normalize(entry.payee)}`
    byVendor.set(key, [...(byVendor.get(key) ?? []), entry])
  }
  const patterns: RecurringPattern[] = []
  for (const entries of byVendor.values()) {
    const sorted = [...entries].sort((left, right) => left.date.localeCompare(right.date))
    if (sorted.length < 3) continue
    const intervals = sorted.slice(1).map((entry, index) => diffDays(entry.date, sorted[index].date))
    const frequency = detectFrequency(intervals)
    if (!frequency) continue
    const amounts = sorted.map((entry) => entry.amountCents)
    const typicalAmountCents = median(amounts)
    const spread = Math.max(...amounts) - Math.min(...amounts)
    const consistentAmount = spread <= Math.max(500, Math.round(typicalAmountCents * 0.1))
    const last = sorted[sorted.length - 1]
    const expectedNextDate = addDays(last.date, frequency.days)
    const missing = expectedNextDate < today
    const confidence = confidenceFor(sorted.length, consistentAmount, frequency.frequency)
    const evidence = [
      `${sorted.length} matching charges found.`,
      `${frequency.frequency} cadence (${intervals.join(', ')} days apart).`,
      `Typical amount ${formatAmount(typicalAmountCents)}.`,
    ]
    patterns.push({
      id: `${last.source}:${last.clientId}:${normalize(last.payee)}:${frequency.frequency.toLowerCase()}`,
      source: last.source,
      clientId: last.clientId,
      vendor: last.payee,
      typicalAmountCents,
      frequency: frequency.frequency,
      expectedNextDate,
      confidence,
      evidence,
      supportingTransactionIds: sorted.map((entry) => entry.id),
      missing,
      reviewPriority: missing ? confidence === 'High' ? 'High' : 'Medium' : 'Low',
    })
  }
  return patterns.sort((left, right) => Number(right.missing) - Number(left.missing) || left.expectedNextDate.localeCompare(right.expectedNextDate) || right.typicalAmountCents - left.typicalAmountCents)
}

export function historyFromTransactions(clientId: string, source: AutomationSource, transactions: Transaction[]): RecurringHistoryEntry[] {
  return transactions.map((transaction) => ({
    id: transaction.id,
    clientId: transaction.clientId ?? clientId,
    source,
    date: /^\d{4}-\d{2}-\d{2}$/.test(transaction.date) ? transaction.date : new Date(transaction.date).toISOString().slice(0, 10),
    payee: transaction.payee,
    description: transaction.description,
    amountCents: parseAmount(transaction.amount),
  }))
}
