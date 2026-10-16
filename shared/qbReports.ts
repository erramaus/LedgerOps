// Turns a raw QuickBooks Online report response into the same ReportTable the demo books produce, and checks its arithmetic.
// QuickBooks is the authority for the figures; this module only re-adds them. An amount that is blank or cannot be parsed
// becomes null (shown as unavailable), never zero, and a check that cannot be performed is reported as "unavailable".
import type { ReportCheck, ReportColumn, ReportId, ReportRow, ReportTable, RowStyle } from './accounting.js'
import { parseMoneyToCents } from './reconciliation.js'

type ColData = { value?: string }
type QbRow = { type?: string; group?: string; Header?: { ColData?: ColData[] }; ColData?: ColData[]; Summary?: { ColData?: ColData[] }; Rows?: { Row?: QbRow[] } }
export type QbReportJson = {
  Header?: { ReportName?: string; ReportBasis?: string; StartPeriod?: string; EndPeriod?: string; Currency?: string; Time?: string }
  Columns?: { Column?: { ColTitle?: string; ColType?: string }[] }
  Rows?: { Row?: QbRow[] }
}

const money = (cents: number) => `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const normalize = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase()

type Parsed = { rows: ReportRow[]; unparsed: number; sumChecks: { label: string; ok: boolean; detail: string }[] }

export function parseQbReport(id: ReportId, title: string, json: QbReportJson, requested?: { start?: string; end?: string }): ReportTable {
  const columns = json.Columns?.Column ?? []
  const labelIndexes = columns.map((column, index) => (column.ColType === 'Money' ? -1 : index)).filter((index) => index >= 0)
  const moneyIndexes = columns.map((column, index) => (column.ColType === 'Money' ? index : -1)).filter((index) => index >= 0)
  // Reports always lead with a label column; if QuickBooks sends no column metadata, assume one label and numbers after it.
  const labelCols = labelIndexes.length > 0 ? labelIndexes : [0]
  const moneyCols = moneyIndexes.length > 0 ? moneyIndexes : columns.length > 1 ? columns.map((_, index) => index).slice(1) : []
  const outColumns: ReportColumn[] = moneyCols.map((index, position) => ({ key: `c${position}`, label: columns[index]?.ColTitle?.trim() || columns[index]?.ColType || `Column ${position + 1}` }))

  const parsed: Parsed = { rows: [], unparsed: 0, sumChecks: [] }
  const used = new Map<string, number>()
  const uniqueKey = (path: string) => {
    const count = (used.get(path) ?? 0) + 1
    used.set(path, count)
    return count === 1 ? path : `${path}#${count}`
  }
  const labelOf = (cols: ColData[] | undefined) => labelCols.map((index) => cols?.[index]?.value?.trim() ?? '').filter(Boolean).join(' · ')
  const cellsOf = (cols: ColData[] | undefined) =>
    moneyCols.map((index) => {
      const raw = cols?.[index]?.value
      if (raw === undefined || raw.trim() === '') return null
      const cents = parseMoneyToCents(raw)
      if (cents === null) parsed.unparsed += 1
      return cents
    })

  const walk = (rows: QbRow[], level: number, parentPath: string): { contributions: (number | null)[][] } => {
    const contributions: (number | null)[][] = []
    for (const item of rows) {
      const children = item.Rows?.Row ?? []
      const headerLabel = labelOf(item.Header?.ColData)
      if (children.length > 0 || item.Header) {
        const path = `${parentPath}/${headerLabel || item.group || 'section'}`
        if (headerLabel) parsed.rows.push({ key: uniqueKey(path), label: headerLabel, cells: moneyCols.map(() => null), level, style: 'heading' })
        const inner = walk(children, headerLabel ? level + 1 : level, path)
        if (item.Summary?.ColData) {
          const summaryLabel = labelOf(item.Summary.ColData) || `Total ${headerLabel}`
          const cells = cellsOf(item.Summary.ColData)
          const style: RowStyle = level === 0 && !headerLabel ? 'grand' : 'total'
          parsed.rows.push({ key: uniqueKey(`${path}/${summaryLabel}`), label: summaryLabel, cells, level: headerLabel ? level : level, style })
          contributions.push(cells)
          // Sub-total check: the children must add up to the figure QuickBooks reports for the section.
          if (inner.contributions.length > 0) {
            const mismatch = cells.map((cell, column) => {
              const parts = inner.contributions.map((contribution) => contribution[column])
              if (cell === null || parts.some((part) => part === null)) return null
              const total = (parts as number[]).reduce((sum, part) => sum + part, 0)
              return total === cell ? null : { column, total, cell }
            }).find((value) => value !== null)
            parsed.sumChecks.push({ label: summaryLabel, ok: !mismatch, detail: mismatch ? `${summaryLabel}: the lines add up to ${money(mismatch.total)} but QuickBooks reports ${money(mismatch.cell)}.` : '' })
          }
        } else {
          for (const contribution of inner.contributions) contributions.push(contribution)
        }
      } else if (item.ColData) {
        const cells = cellsOf(item.ColData)
        const label = labelOf(item.ColData) || '(no description)'
        parsed.rows.push({ key: uniqueKey(`${parentPath}/${label}`), label, cells, level, style: 'normal' })
        contributions.push(cells)
      } else if (item.Summary?.ColData) {
        // A stand-alone total such as the grand total of an aging report.
        const label = labelOf(item.Summary.ColData) || 'Total'
        parsed.rows.push({ key: uniqueKey(`${parentPath}/${label}`), label, cells: cellsOf(item.Summary.ColData), level: 0, style: 'grand' })
      }
    }
    return { contributions }
  }
  walk(json.Rows?.Row ?? [], 0, '')

  const meta = { basis: json.Header?.ReportBasis, currency: json.Header?.Currency, start: json.Header?.StartPeriod, end: json.Header?.EndPeriod, generatedAt: json.Header?.Time }
  return { id, title, columns: outColumns, rows: parsed.rows, meta, checks: qbChecks(id, parsed, outColumns.length, meta, requested, json) }
}

const find = (rows: ReportRow[], pattern: RegExp, column = 0) => {
  const match = rows.find((item) => pattern.test(normalize(item.label)) && item.cells[column] !== undefined)
  return match ? match.cells[column] : undefined
}

function qbChecks(id: ReportId, parsed: Parsed, columnCount: number, meta: { start?: string; end?: string }, requested: { start?: string; end?: string } | undefined, json: QbReportJson): ReportCheck[] {
  const checks: ReportCheck[] = []
  const { rows } = parsed

  checks.push(
    !json.Rows || columnCount === 0
      ? { id: 'format', label: 'The report has the expected layout', status: 'fail', detail: 'QuickBooks returned a report without columns or rows, so no figures can be relied on.' }
      : { id: 'format', label: 'The report has the expected layout', status: 'pass', detail: `${rows.length} rows read.` },
  )
  checks.push(parsed.unparsed === 0
    ? { id: 'amounts', label: 'Every amount could be read', status: 'pass', detail: 'No unreadable amounts.' }
    : { id: 'amounts', label: 'Every amount could be read', status: 'fail', detail: `${parsed.unparsed} amount${parsed.unparsed === 1 ? ' was' : 's were'} not readable and are shown as unavailable, not zero.` })

  if (requested?.start || requested?.end) {
    const wrong = (requested.end && meta.end && meta.end !== requested.end) || (requested.start && id !== 'balance-sheet' && meta.start && meta.start !== requested.start)
    const missing = !meta.end
    checks.push(missing
      ? { id: 'period', label: 'The report covers the requested dates', status: 'unavailable', detail: 'QuickBooks did not state which dates the report covers.' }
      : { id: 'period', label: 'The report covers the requested dates', status: wrong ? 'fail' : 'pass', detail: wrong ? `Requested ${requested.start ?? ''} to ${requested.end ?? ''} but QuickBooks returned ${meta.start ?? ''} to ${meta.end ?? ''}.` : `${meta.start ?? ''} to ${meta.end ?? ''}.` })
  }

  const failedSums = parsed.sumChecks.filter((check) => !check.ok)
  const expectsSubtotals = id === 'profit-loss' || id === 'balance-sheet' || id === 'cash-flow'
  if (parsed.sumChecks.length === 0) {
    // Trial balances, aging reports and ledgers have no subtotals, so there is nothing to verify and nothing to report.
    if (expectsSubtotals) checks.push({ id: 'subtotals', label: 'Subtotals add up', status: 'unavailable', detail: 'This report has no subtotals to verify.' })
  } else {
    checks.push(failedSums.length === 0
      ? { id: 'subtotals', label: 'Subtotals add up', status: 'pass', detail: `${parsed.sumChecks.length} subtotals re-added.` }
      : { id: 'subtotals', label: 'Subtotals add up', status: 'fail', detail: failedSums.slice(0, 3).map((check) => check.detail).join(' ') })
  }

  const compare = (checkId: string, label: string, left: number | null | undefined, right: number | null | undefined, describe: string): ReportCheck => {
    if (left === undefined || right === undefined) return { id: checkId, label, status: 'unavailable', detail: `The rows needed for this check (${describe}) were not found in the report.` }
    if (left === null || right === null) return { id: checkId, label, status: 'unavailable', detail: 'One of the figures is not available.' }
    return left === right ? { id: checkId, label, status: 'pass', detail: `Both are ${money(left)}.` } : { id: checkId, label, status: 'fail', detail: `${money(left)} and ${money(right)} should be equal but differ by ${money(Math.abs(left - right))}.` }
  }

  if (id === 'balance-sheet') {
    checks.push(compare('bs-balanced', 'Assets equal liabilities plus equity', find(rows, /^total assets$/), find(rows, /^total liabilities (and|&) equity$/), 'Total Assets, Total Liabilities and Equity'))
  } else if (id === 'profit-loss') {
    const income = find(rows, /^total income$/), cogs = find(rows, /^total cost of goods sold$/), gross = find(rows, /^gross profit$/)
    const expenses = find(rows, /^total expenses$/), operating = find(rows, /^net operating income$/)
    const otherNet = find(rows, /^net other income$/), net = find(rows, /^net income$/)
    if (gross !== undefined && income !== undefined) checks.push(compare('pl-gross', 'Gross profit equals income less cost of goods sold', gross, income === null ? null : income - (cogs ?? 0), 'Total Income, Gross Profit'))
    if (operating !== undefined && gross !== undefined) checks.push(compare('pl-operating', 'Operating income equals gross profit less expenses', operating, gross === null ? null : gross - (expenses ?? 0), 'Gross Profit, Total Expenses'))
    if (net !== undefined && operating !== undefined) checks.push(compare('pl-net', 'Net income equals operating income plus other income', net, operating === null ? null : operating + (otherNet ?? 0), 'Net Operating Income, Net Income'))
    if (!checks.some((check) => check.id.startsWith('pl-'))) checks.push({ id: 'pl-net', label: 'Net income agrees with its components', status: 'unavailable', detail: 'The total rows needed for this check were not found in the report.' })
  } else if (id === 'trial-balance') {
    checks.push(compare('tb-balanced', 'Total debits equal total credits', find(rows, /^total$/, 0), find(rows, /^total$/, 1), 'the Total row'))
  } else if (id === 'cash-flow') {
    const operating = find(rows, /^net cash provided by operating activities$/), investing = find(rows, /^net cash provided by investing activities$/), financing = find(rows, /^net cash provided by financing activities$/)
    const change = find(rows, /^net cash increase for period$/)
    if (operating !== undefined && change !== undefined) {
      const parts = [operating, investing ?? 0, financing ?? 0]
      checks.push(compare('cf-change', 'Net change equals operating, investing and financing activity', change, parts.some((part) => part === null) ? null : (parts as number[]).reduce((sum, part) => sum + part, 0), 'the activity totals and Net cash increase'))
    } else checks.push({ id: 'cf-change', label: 'Net change equals the activity totals', status: 'unavailable', detail: 'The total rows needed for this check were not found in the report.' })
  } else if (id === 'ar-aging' || id === 'ap-aging') {
    const total = rows.find((item) => item.style === 'grand')
    const dataRows = rows.filter((item) => item.style === 'normal')
    const lastColumn = columnCount - 1
    const rowBad = dataRows.filter((item) => {
      const parts = item.cells.slice(0, lastColumn)
      const whole = item.cells[lastColumn]
      if (whole === null || whole === undefined || parts.some((part) => part === null)) return false
      return (parts as number[]).reduce((sum, part) => sum + part, 0) !== whole
    })
    checks.push(rowBad.length === 0 ? { id: 'aging-rows', label: 'Each row adds up across the ageing columns', status: dataRows.length === 0 ? 'unavailable' : 'pass', detail: dataRows.length === 0 ? 'The report has no rows.' : `${dataRows.length} rows checked.` } : { id: 'aging-rows', label: 'Each row adds up across the ageing columns', status: 'fail', detail: `${rowBad.length} row${rowBad.length === 1 ? ' does' : 's do'} not add up, for example ${rowBad[0].label}.` })
    if (total) {
      const bad = total.cells.map((cell, column) => {
        const sum = dataRows.reduce((running, item) => running + (item.cells[column] ?? 0), 0)
        return cell !== null && cell !== sum ? column : -1
      }).find((column) => column >= 0)
      checks.push(bad === undefined ? { id: 'aging-total', label: 'Rows add up to the total', status: 'pass', detail: 'Column totals match.' } : { id: 'aging-total', label: 'Rows add up to the total', status: 'fail', detail: 'The rows do not add up to the report total.' })
    } else {
      checks.push({ id: 'aging-total', label: 'Rows add up to the total', status: 'unavailable', detail: 'The report has no total row.' })
    }
  }
  return checks
}

/** The grand total of an aging report (last column), or null when it cannot be proven. */
export function agingTotalCents(table: ReportTable): number | null {
  const total = table.rows.find((item) => item.style === 'grand')
  const value = total?.cells[total.cells.length - 1]
  return value === undefined ? null : value
}

export type CheckSummary = { failed: ReportCheck[]; unavailable: ReportCheck[]; passed: ReportCheck[] }
export const summarizeChecks = (checks: ReportCheck[]): CheckSummary => ({
  failed: checks.filter((check) => check.status === 'fail'),
  unavailable: checks.filter((check) => check.status === 'unavailable'),
  passed: checks.filter((check) => check.status === 'pass'),
})
