import { describe, expect, it } from 'vitest'
import { demoComparison, demoReport } from '../../shared/demoMonthEnd'
import { parseQbReport } from '../../shared/qbReports'
import { formatPercent, percentChange, plSummary } from './plSummary'

const august = { start: '2026-08-01', end: '2026-08-31', label: 'August 2026' }
const july = { start: '2026-07-01', end: '2026-07-31', label: 'July 2026' }

describe('plSummary', () => {
  it('reads every figure from the same rows as the detailed table', () => {
    const table = demoReport('profit-loss', august)
    const cell = (key: string) => table.rows.find((row) => row.key === key)!.cells[0]
    const [income, gross, expenses, net] = plSummary(table, true)
    expect(income.cells[0]).toBe(cell('total-income'))
    expect(gross.cells[0]).toBe(cell('gross-profit'))
    expect(expenses.cells[0]).toBe(cell('total-expenses'))
    expect(net.cells[0]).toBe(cell('net-income'))
    expect(income.cells[0]).toBe(1098000)
    expect(net.cells[0]).toBe(414918)
  })

  it('has one value per column, including previous period and change', () => {
    const table = demoComparison('profit-loss', august, july)!
    const net = plSummary(table, true)[3]
    const row = table.rows.find((item) => item.key === 'net-income')!
    expect(net.cells).toEqual(row.cells)
    expect(net.cells[2]).toBe(row.cells[0]! - row.cells[1]!)
  })

  it('treats an absent row as unavailable for QuickBooks, never zero', () => {
    const table = { ...demoReport('profit-loss', august), rows: demoReport('profit-loss', august).rows.filter((row) => row.key !== 'total-expenses') }
    expect(plSummary(table, false)[2].cells).toEqual([null])
    expect(plSummary(table, true)[2].cells).toEqual([0])
  })

  it('keeps unavailable cells unavailable', () => {
    const table = demoReport('profit-loss', august)
    const broken = { ...table, rows: table.rows.map((row) => (row.key === 'net-income' ? { ...row, cells: [null] } : row)) }
    expect(plSummary(broken, true)[3].cells).toEqual([null])
  })

  it('finds the totals in a QuickBooks report by label without confusing Net Operating Income', () => {
    const json = {
      Columns: { Column: [{ ColTitle: '', ColType: 'Account' }, { ColTitle: 'Total', ColType: 'Money' }] },
      Rows: { Row: [
        { Header: { ColData: [{ value: 'Income' }] }, Rows: { Row: [{ ColData: [{ value: 'Sales' }, { value: '1000.00' }] }] }, Summary: { ColData: [{ value: 'Total Income' }, { value: '1000.00' }] } },
        { Summary: { ColData: [{ value: 'Gross Profit' }, { value: '1000.00' }] }, group: 'GrossProfit' },
        { Header: { ColData: [{ value: 'Expenses' }] }, Rows: { Row: [{ ColData: [{ value: 'Rent' }, { value: '400.00' }] }] }, Summary: { ColData: [{ value: 'Total Expenses' }, { value: '400.00' }] } },
        { Summary: { ColData: [{ value: 'Net Operating Income' }, { value: '600.00' }] }, group: 'NetOperatingIncome' },
        { Summary: { ColData: [{ value: 'Net Income' }, { value: '600.00' }] }, group: 'NetIncome' },
      ] },
    }
    const table = parseQbReport('profit-loss', 'Profit and Loss', json as never)
    const [income, gross, expenses, net] = plSummary(table, false)
    expect([income.cells[0], gross.cells[0], expenses.cells[0], net.cells[0]]).toEqual([100000, 100000, 40000, 60000])
  })
})

describe('percentChange', () => {
  it('computes a one-decimal percentage from cents', () => {
    expect(percentChange(110, 100)).toBe(10)
    expect(percentChange(50, 200)).toBe(-75)
    expect(percentChange(1, 3)).toBe(-66.7)
  })

  it('is not available when it is not meaningful', () => {
    expect(percentChange(10, 0)).toBeNull()
    expect(percentChange(10, -5)).toBeNull()
    expect(percentChange(null, 5)).toBeNull()
    expect(percentChange(5, null)).toBeNull()
  })

  it('formats the sign', () => {
    expect(formatPercent(10)).toBe('+10.0%')
    expect(formatPercent(-2.5)).toBe('-2.5%')
  })
})
