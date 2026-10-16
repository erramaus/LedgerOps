import { withComparison, type ReportId, type ReportTable } from '../../shared/accounting'
import { DEMO_CLIENT_ID } from '../../shared/demoBooks'
import { DEMO_NO_BOOKS, demoComparison, demoReport, hasDemoBooks, type DemoLedger } from '../../shared/demoMonthEnd'
import { parseQbReport } from '../../shared/qbReports'
import { parsePeriodKey, type DateRange } from '../../shared/period'
import { failed, loaded, type Loaded } from './monthEndData'
import { quickBooksService } from './quickBooksService'
import type { Source } from '../../shared/monthEnd'

export const REPORT_TITLES: Record<ReportId, string> = {
  'profit-loss': 'Profit and Loss',
  'balance-sheet': 'Balance Sheet',
  'cash-flow': 'Cash Flow',
  'trial-balance': 'Trial Balance',
  'general-ledger': 'General Ledger',
  'ar-aging': 'Accounts Receivable Aging',
  'ap-aging': 'Accounts Payable Aging',
}
export const REPORT_IDS = Object.keys(REPORT_TITLES) as ReportId[]
const AS_OF_ONLY: ReportId[] = ['balance-sheet', 'trial-balance', 'ar-aging', 'ap-aging']

export const REPORT_DESCRIPTIONS: Record<ReportId, string> = {
  'profit-loss': 'Income, expenses and net income for the period.',
  'balance-sheet': 'What the business owns and owes at the end of the period.',
  'cash-flow': 'How cash moved during the period.',
  'trial-balance': 'Every account balance, with debits and credits.',
  'general-ledger': 'Every entry, account by account.',
  'ar-aging': 'What customers owe, by how late it is.',
  'ap-aging': 'What is owed to vendors, by how late it is.',
}

/** Why a demo report cannot be produced, or null. Ranges that start before the demo books would silently understate the figures. */
export function demoUnsupported(id: ReportId, range: DateRange, ledger?: DemoLedger): string | null {
  const end = parsePeriodKey(range.end.slice(0, 7))
  const clientId = ledger?.clientId
  if (!end || !hasDemoBooks(end, clientId)) return DEMO_NO_BOOKS
  const firstPeriod = (ledger?.periods ?? [{ year: 2026, month: 5 }])[0]
  const firstDate = `${firstPeriod.year}-${String(firstPeriod.month).padStart(2, '0')}-01`
  if (!AS_OF_ONLY.includes(id) && range.start < firstDate) return clientId === undefined || clientId === DEMO_CLIENT_ID
    ? 'The demo books start in May 2026, so a range that begins earlier would leave out figures. Choose a month or a range that starts in May or later.'
    : `The ${ledger?.clientId} demo books start in ${firstDate}. Choose a month or a range that starts in this company's books.`
  return null
}

export async function loadReport(source: Source, id: ReportId, range: DateRange, ledger?: DemoLedger): Promise<Loaded<ReportTable>> {
  if (source === 'demo') {
    const reason = demoUnsupported(id, range, ledger)
    return reason ? failed(reason) : loaded(demoReport(id, range, ledger))
  }
  try {
    const json = await quickBooksService.getReportData(id, range.start, range.end)
    const asOfOnly = id === 'ar-aging' || id === 'ap-aging'
    return loaded(parseQbReport(id, REPORT_TITLES[id], json, asOfOnly ? { end: range.end } : { start: range.start, end: range.end }))
  } catch (error) {
    return failed(error instanceof Error ? error.message : 'The QuickBooks report could not be loaded.')
  }
}

/** The report for `current` with a previous-period column, or the reason no comparison can be shown. */
export async function loadComparison(source: Source, id: ReportId, current: DateRange, previous: DateRange, ledger?: DemoLedger): Promise<Loaded<ReportTable>> {
  if (id === 'general-ledger') return failed('A general ledger is a list of entries, so it is not compared with another period.')
  const labels = { current: current.label, previous: previous.label }
  if (source === 'demo') {
    const reason = demoUnsupported(id, previous, ledger)
    if (reason) return failed(`There is no reliable previous period to compare with. ${reason}`)
    const table = demoComparison(id, current, previous, ledger)
    return table ? loaded(table) : failed(`The demo books have no data for ${previous.label}.`)
  }
  const [now, then] = await Promise.all([loadReport(source, id, current), loadReport(source, id, previous)])
  if (!now.ok) return now
  if (!then.ok) return failed(`The previous period (${previous.label}) could not be loaded, so there is no comparison. ${then.reason}`)
  // QuickBooks omits an account that had no activity, so a missing row cannot be assumed to be zero.
  return loaded(withComparison(now.value, then.value, labels, false))
}
