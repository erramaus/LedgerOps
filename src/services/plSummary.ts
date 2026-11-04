import type { ReportTable } from '../../shared/accounting'

export type PlMetricId = 'income' | 'gross-profit' | 'expenses' | 'net-income'

export type PlMetric = {
  id: PlMetricId
  label: string
  /** One entry per report column; null means the figure is not available (never zero). */
  cells: (number | null)[]
}

const METRICS: { id: PlMetricId; label: string; match: string }[] = [
  { id: 'income', label: 'Total income', match: 'total income' },
  { id: 'gross-profit', label: 'Gross profit', match: 'gross profit' },
  { id: 'expenses', label: 'Total expenses', match: 'total expenses' },
  { id: 'net-income', label: 'Net income', match: 'net income' },
]

/**
 * Reads the summary figures straight from the rows of the report that is on screen, so the summary can never
 * disagree with the table. A row that is absent is zero only when `absentMeansZero` (the demo ledger omits empty
 * sections); for QuickBooks an absent row is unavailable.
 */
export function plSummary(table: ReportTable, absentMeansZero: boolean): PlMetric[] {
  return METRICS.map((metric) => {
    const row = table.rows.find((item) => (item.style === 'total' || item.style === 'grand') && item.label.trim().toLowerCase() === metric.match)
    const cells = table.columns.map((_, index) => (row ? (row.cells[index] ?? null) : absentMeansZero ? 0 : null))
    return { id: metric.id, label: metric.label, cells }
  })
}

/** Percentage change, only where it means something: both figures known and the earlier figure positive. */
export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous <= 0) return null
  return Math.round(((current - previous) * 1000) / previous) / 10
}

export const formatPercent = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
