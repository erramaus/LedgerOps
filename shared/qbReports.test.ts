import { describe, expect, it } from 'vitest'
import { agingTotalCents, parseQbReport, summarizeChecks, type QbReportJson } from './qbReports'
import { figureFrom } from './monthEndFacts'

const col = (...values: string[]) => values.map((value) => ({ value }))
const columns = { Column: [{ ColTitle: '', ColType: 'Account' }, { ColTitle: 'Total', ColType: 'Money' }] }

const profitAndLossJson = (overrides: { totalIncome?: string; netIncome?: string; line?: string } = {}): QbReportJson => ({
  Header: { ReportName: 'ProfitAndLoss', ReportBasis: 'Accrual', StartPeriod: '2026-08-01', EndPeriod: '2026-08-31', Currency: 'USD' },
  Columns: columns,
  Rows: {
    Row: [
      { group: 'Income', Header: { ColData: col('Income', '') }, Rows: { Row: [{ type: 'Data', ColData: col('Service Income', '10,000.00') }, { type: 'Data', ColData: col('Parts', overrides.line ?? '980.00') }] }, Summary: { ColData: col('Total Income', overrides.totalIncome ?? '10,980.00') } },
      { group: 'GrossProfit', Summary: { ColData: col('Gross Profit', '10,980.00') } },
      { group: 'Expenses', Header: { ColData: col('Expenses', '') }, Rows: { Row: [{ type: 'Data', ColData: col('Fuel', '2,000.00') }, { type: 'Data', ColData: col('Payroll', '4,830.82') }] }, Summary: { ColData: col('Total Expenses', '6,830.82') } },
      { group: 'NetOperatingIncome', Summary: { ColData: col('Net Operating Income', '4,149.18') } },
      { group: 'NetIncome', Summary: { ColData: col('Net Income', overrides.netIncome ?? '4,149.18') } },
    ],
  },
})

const check = (table: ReturnType<typeof parseQbReport>, id: string) => table.checks.find((item) => item.id === id)

describe('QuickBooks Profit and Loss', () => {
  it('reads every amount in cents and passes all arithmetic checks when the figures agree', () => {
    const table = parseQbReport('profit-loss', 'Profit and Loss', profitAndLossJson(), { start: '2026-08-01', end: '2026-08-31' })
    expect(table.rows.find((row) => row.label === 'Service Income')?.cells).toEqual([1_000_000])
    expect(table.rows.find((row) => row.label === 'Net Income')?.cells).toEqual([414_918])
    expect(table.checks.map((item) => item.status)).toEqual(expect.not.arrayContaining(['fail']))
    expect(check(table, 'subtotals')?.status).toBe('pass')
    expect(check(table, 'pl-net')?.status).toBe('pass')
    expect(table.meta).toMatchObject({ basis: 'Accrual', start: '2026-08-01', end: '2026-08-31' })
  })

  it('fails when a subtotal does not equal the sum of its lines', () => {
    const table = parseQbReport('profit-loss', 'Profit and Loss', profitAndLossJson({ line: '985.00' }))
    expect(check(table, 'subtotals')?.status).toBe('fail')
    expect(check(table, 'subtotals')?.detail).toContain('Total Income')
    expect(summarizeChecks(table.checks).failed.length).toBeGreaterThan(0)
  })

  it('fails when net income disagrees with operating income', () => {
    const table = parseQbReport('profit-loss', 'Profit and Loss', profitAndLossJson({ netIncome: '4,149.19' }))
    expect(check(table, 'pl-net')?.status).toBe('fail')
  })

  it('an amount that cannot be read becomes unavailable (null), never zero, and fails the amounts check', () => {
    const table = parseQbReport('profit-loss', 'Profit and Loss', profitAndLossJson({ line: 'n/a' }))
    expect(table.rows.find((row) => row.label === 'Parts')?.cells).toEqual([null])
    expect(check(table, 'amounts')?.status).toBe('fail')
    // A subtotal whose lines include an unreadable amount cannot be proven, so it must not pass.
    expect(check(table, 'subtotals')?.status).not.toBe('fail')
  })

  it('reports the period mismatch when QuickBooks answers for different dates', () => {
    const table = parseQbReport('profit-loss', 'Profit and Loss', profitAndLossJson(), { start: '2026-07-01', end: '2026-07-31' })
    expect(check(table, 'period')?.status).toBe('fail')
  })

  it('reports checks it cannot perform as unavailable instead of passing them', () => {
    const json = profitAndLossJson()
    json.Rows!.Row = json.Rows!.Row!.filter((row) => row.group === 'Income')
    const table = parseQbReport('profit-loss', 'Profit and Loss', json)
    expect(check(table, 'pl-net')?.status).toBe('unavailable')
  })

  it('an empty response is a failed format check, not an empty profit and loss', () => {
    const table = parseQbReport('profit-loss', 'Profit and Loss', {})
    expect(check(table, 'format')?.status).toBe('fail')
  })
})

describe('QuickBooks Balance Sheet', () => {
  const sheet = (liabilitiesAndEquity: string): QbReportJson => ({
    Header: { EndPeriod: '2026-08-31' }, Columns: columns,
    Rows: {
      Row: [
        { group: 'Assets', Header: { ColData: col('ASSETS', '') }, Rows: { Row: [{ type: 'Data', ColData: col('Checking', '48,421.72') }, { type: 'Data', ColData: col('Accounts Receivable', '8,420.00') }] }, Summary: { ColData: col('Total Assets', '56,841.72') } },
        { group: 'LiabilitiesAndEquity', Header: { ColData: col('LIABILITIES AND EQUITY', '') }, Rows: { Row: [{ type: 'Data', ColData: col('Accounts Payable', '2,556.44') }, { type: 'Data', ColData: col("Owner's Equity", '54,285.28') }] }, Summary: { ColData: col('Total Liabilities and Equity', liabilitiesAndEquity) } },
      ],
    },
  })

  it('checks that assets equal liabilities plus equity', () => {
    expect(check(parseQbReport('balance-sheet', 'Balance Sheet', sheet('56,841.72')), 'bs-balanced')?.status).toBe('pass')
    const bad = parseQbReport('balance-sheet', 'Balance Sheet', sheet('56,841.70'))
    expect(check(bad, 'bs-balanced')?.status).toBe('fail')
    expect(check(bad, 'bs-balanced')?.detail).toContain('$0.02')
  })

  it('negative amounts in parentheses are read as negatives', () => {
    const table = parseQbReport('balance-sheet', 'Balance Sheet', { Columns: columns, Rows: { Row: [{ type: 'Data', ColData: col('Owner draws', '(1,200.50)') }] } })
    expect(table.rows[0].cells).toEqual([-120_050])
  })
})

describe('QuickBooks Trial Balance and aging', () => {
  const tbColumns = { Column: [{ ColTitle: '', ColType: 'Account' }, { ColTitle: 'Debit', ColType: 'Money' }, { ColTitle: 'Credit', ColType: 'Money' }] }

  it('trial balance debits must equal credits', () => {
    const json = (credit: string): QbReportJson => ({ Columns: tbColumns, Rows: { Row: [{ type: 'Data', ColData: col('Checking', '100.00', '') }, { type: 'Data', ColData: col('Equity', '', '100.00') }, { group: 'GrandTotal', Summary: { ColData: col('TOTAL', '100.00', credit) } }] } })
    expect(check(parseQbReport('trial-balance', 'Trial Balance', json('100.00')), 'tb-balanced')?.status).toBe('pass')
    expect(check(parseQbReport('trial-balance', 'Trial Balance', json('99.00')), 'tb-balanced')?.status).toBe('fail')
  })

  const agingColumns = { Column: [{ ColTitle: '', ColType: 'Customer' }, { ColTitle: 'Current', ColType: 'Money' }, { ColTitle: '1 - 30', ColType: 'Money' }, { ColTitle: 'Total', ColType: 'Money' }] }
  const agingJson = (total: string): QbReportJson => ({
    Columns: agingColumns,
    Rows: { Row: [{ type: 'Data', ColData: col('Riverside Retail', '0.00', '2,840.00', '2,840.00') }, { type: 'Data', ColData: col('Pinecrest HOA', '1,980.00', '0.00', '1,980.00') }, { group: 'GrandTotal', Summary: { ColData: col('TOTAL', '1,980.00', '2,840.00', total) } }] },
  })

  it('aging rows add up across and down, and the grand total can be read for cross-checking', () => {
    const table = parseQbReport('ar-aging', 'Accounts Receivable Aging', agingJson('4,820.00'))
    expect(check(table, 'aging-rows')?.status).toBe('pass')
    expect(check(table, 'aging-total')?.status).toBe('pass')
    expect(agingTotalCents(table)).toBe(482_000)
  })

  it('flags an aging whose rows do not add to the total', () => {
    expect(check(parseQbReport('ar-aging', 'x', agingJson('4,900.00')), 'aging-total')?.status).toBe('fail')
  })

  it('finds a figure in a parsed table without guessing when it is absent', () => {
    const table = parseQbReport('profit-loss', 'Profit and Loss', profitAndLossJson())
    expect(figureFrom(table, /^net income$/)).toBe(414_918)
    expect(figureFrom(table, /^total assets$/)).toBeNull()
  })
})

describe('QuickBooks Cash Flow', () => {
  it('net change must equal the three activity totals; missing rows are unavailable, not passed', () => {
    const json = (change: string): QbReportJson => ({
      Columns: columns,
      Rows: { Row: [
        { group: 'OperatingActivities', Summary: { ColData: col('Net cash provided by operating activities', '1,000.00') } },
        { group: 'InvestingActivities', Summary: { ColData: col('Net cash provided by investing activities', '-300.00') } },
        { group: 'FinancingActivities', Summary: { ColData: col('Net cash provided by financing activities', '200.00') } },
        { group: 'CashIncrease', Summary: { ColData: col('Net cash increase for period', change) } },
      ] },
    })
    expect(check(parseQbReport('cash-flow', 'Cash Flow', json('900.00')), 'cf-change')?.status).toBe('pass')
    expect(check(parseQbReport('cash-flow', 'Cash Flow', json('950.00')), 'cf-change')?.status).toBe('fail')
    expect(check(parseQbReport('cash-flow', 'Cash Flow', { Columns: columns, Rows: { Row: [] } }), 'cf-change')?.status).toBe('unavailable')
  })
})
