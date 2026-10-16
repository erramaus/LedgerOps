// Accounting periods and date handling shared by the browser and the server. No imports, no I/O.
// Dates are ISO yyyy-mm-dd strings; the system time zone never changes which month a date belongs to.

export type Period = { year: number; month: number }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const pad = (value: number) => String(value).padStart(2, '0')

export const PERIOD_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export const periodKey = (period: Period) => `${period.year}-${pad(period.month)}`

export function parsePeriodKey(key: string): Period | null {
  if (!PERIOD_KEY_PATTERN.test(key)) return null
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) }
}

export const monthLabel = (period: Period) => `${MONTHS[period.month - 1]} ${period.year}`

export const daysInMonth = (period: Period) => new Date(Date.UTC(period.year, period.month, 0)).getUTCDate()
export const periodStart = (period: Period) => `${period.year}-${pad(period.month)}-01`
export const periodEnd = (period: Period) => `${period.year}-${pad(period.month)}-${pad(daysInMonth(period))}`

export const previousPeriod = (period: Period): Period => (period.month === 1 ? { year: period.year - 1, month: 12 } : { year: period.year, month: period.month - 1 })
export const nextPeriod = (period: Period): Period => (period.month === 12 ? { year: period.year + 1, month: 1 } : { year: period.year, month: period.month + 1 })

/** The most recent complete month before the given ISO date. */
export function lastCompleteMonth(todayIso: string): Period {
  const year = Number(todayIso.slice(0, 4)), month = Number(todayIso.slice(5, 7))
  return previousPeriod({ year, month })
}

export const isInPeriod = (iso: string, period: Period) => iso >= periodStart(period) && iso <= periodEnd(period)

export function isValidIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3])
}

/** Understands "2026-08-29", "Aug 29, 2026" and "August 01, 2026"; returns null for anything else rather than guessing. */
export function normalizeDate(value: string | undefined): string | null {
  if (!value) return null
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim())
  if (iso) return isValidIsoDate(iso[1]) ? iso[1] : null
  const named = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(value.trim())
  if (!named) return null
  const index = MONTHS.findIndex((name) => name.toLowerCase() === named[1].toLowerCase() || name.slice(0, 3).toLowerCase() === named[1].toLowerCase())
  if (index < 0) return null
  const result = `${named[3]}-${pad(index + 1)}-${pad(Number(named[2]))}`
  return isValidIsoDate(result) ? result : null
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string) {
  const start = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)))
  const end = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)))
  return Math.round((end - start) / 86_400_000)
}

export type RangeMode = 'month' | 'quarter' | 'ytd'
export type DateRange = { start: string; end: string; label: string }

export const shiftPeriod = (period: Period, months: number): Period => {
  const index = period.year * 12 + (period.month - 1) + months
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

const rangeBetween = (first: Period, last: Period): DateRange => ({
  start: periodStart(first),
  end: periodEnd(last),
  label: first.year === last.year && first.month === last.month ? monthLabel(last) : `${monthLabel(first)} to ${monthLabel(last)}`,
})

/** The reporting range that ends with the selected month. */
export function rangeFor(period: Period, mode: RangeMode): DateRange {
  if (mode === 'month') return rangeBetween(period, period)
  if (mode === 'quarter') return rangeBetween({ year: period.year, month: Math.floor((period.month - 1) / 3) * 3 + 1 }, period)
  return rangeBetween({ year: period.year, month: 1 }, period)
}

/** The same range one month, quarter or year earlier, for comparison. */
export function previousRangeFor(period: Period, mode: RangeMode): DateRange {
  const shift = mode === 'month' ? -1 : mode === 'quarter' ? -3 : -12
  const current = rangeFor(period, mode)
  const first = shiftPeriod({ year: Number(current.start.slice(0, 4)), month: Number(current.start.slice(5, 7)) }, shift)
  return rangeBetween(first, shiftPeriod(period, shift))
}
