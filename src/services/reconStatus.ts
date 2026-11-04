import type { ReconciliationRecord } from '../../shared/reconciliation'

/** The parts of a saved reconciliation that status and history views need. */
export type StatusRecord = Pick<ReconciliationRecord, 'id' | 'clientId' | 'clientName' | 'accountId' | 'accountName' | 'accountKind' | 'periodStart' | 'periodEnd' | 'status' | 'completeness' | 'endingCents' | 'completedAt'>

export type PeriodStatus = 'Not started' | 'In progress' | 'Completed' | 'Blocked'
export type PeriodStatusResult = { status: PeriodStatus; record?: StatusRecord; reason?: string }
export type MonthRef = { year: number; month: number }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "2026-07-31" becomes "July 31, 2026". Anything that is not a real calendar date is returned unchanged. */
export function formatLongDate(iso: string | undefined | null): string {
  if (!iso) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return iso
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (month < 1 || month > 12 || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return iso
  return `${MONTHS[month - 1]} ${day}, ${year}`
}

export const monthKey = (period: MonthRef) => `${String(period.year).padStart(4, '0')}-${String(period.month).padStart(2, '0')}`

export function formatMonthKey(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key)
  return match && Number(match[2]) >= 1 && Number(match[2]) <= 12 ? `${MONTHS[Number(match[2]) - 1]} ${match[1]}` : key
}

/** A saved record's state: completed, blocked when the books could not be fully checked, otherwise in progress. */
export function recordStatus(record: Pick<StatusRecord, 'status' | 'completeness'>): Exclude<PeriodStatus, 'Not started'> {
  if (record.status === 'completed') return 'Completed'
  return record.completeness && record.completeness.complete === false ? 'Blocked' : 'In progress'
}

/** Status of one account for one accounting month, taken only from stored records. Matching balances never count as complete. */
export function periodStatus(records: StatusRecord[], accountId: string, period: MonthRef): PeriodStatusResult {
  const key = monthKey(period)
  const inMonth = records.filter((record) => record.accountId === accountId && record.periodEnd.slice(0, 7) === key)
  const completed = inMonth.find((record) => record.status === 'completed')
  if (completed) return { status: 'Completed', record: completed }
  const draft = inMonth.sort((left, right) => right.periodEnd.localeCompare(left.periodEnd))[0]
  if (!draft) return { status: 'Not started' }
  const status = recordStatus(draft)
  return { status, record: draft, ...(status === 'Blocked' ? { reason: draft.completeness.reasons[0] ?? 'The books could not be fully checked.' } : {}) }
}

/** The latest completed reconciliation of an account, if any. */
export function lastCompleted(records: StatusRecord[], accountId: string): StatusRecord | undefined {
  return records.filter((record) => record.accountId === accountId && record.status === 'completed').sort((left, right) => left.periodEnd.localeCompare(right.periodEnd)).slice(-1)[0]
}

export type HistoryFilters = { search?: string; clientId?: string; accountId?: string; period?: string; status?: PeriodStatus | 'All' }

export function filterHistory<T extends StatusRecord>(records: T[], filters: HistoryFilters): T[] {
  const search = filters.search?.trim().toLowerCase()
  return records.filter((record) => {
    if (filters.clientId && filters.clientId !== 'All' && record.clientId !== filters.clientId) return false
    if (filters.accountId && filters.accountId !== 'All' && record.accountId !== filters.accountId) return false
    if (filters.period && filters.period !== 'All' && record.periodEnd.slice(0, 7) !== filters.period) return false
    if (filters.status && filters.status !== 'All' && recordStatus(record) !== filters.status) return false
    if (search) {
      const haystack = [record.accountName, record.clientName, record.periodStart, record.periodEnd, formatLongDate(record.periodStart), formatLongDate(record.periodEnd), formatMonthKey(record.periodEnd.slice(0, 7))].join(' ').toLowerCase()
      if (!haystack.includes(search)) return false
    }
    return true
  })
}

/** Distinct months with records, newest first, for the period filter. */
export const historyMonths = (records: StatusRecord[]) => [...new Set(records.map((record) => record.periodEnd.slice(0, 7)))].sort().reverse()

/** Counts per status for a list of accounts in one month. */
export function summarizePeriod(records: StatusRecord[], accountIds: string[], period: MonthRef): Record<PeriodStatus, number> {
  const totals: Record<PeriodStatus, number> = { 'Not started': 0, 'In progress': 0, Completed: 0, Blocked: 0 }
  for (const accountId of accountIds) totals[periodStatus(records, accountId, period).status] += 1
  return totals
}
