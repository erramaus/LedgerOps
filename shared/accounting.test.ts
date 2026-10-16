import { describe, expect, it } from 'vitest'
import { aging, balanceAt, balanceSheet, balanceSheetSummary, cashFlow, generalLedger, openBalanceCents, profitAndLoss, profitAndLossSummary, trialBalance, validateLedger, withComparison, type JournalEntry, type LedgerAccountDef } from './accounting'
import { demoLedger, demoPayableItems, demoReceivableItems, demoRegister } from './demoBooks'
import { demoComparison, demoReport, demoClientFigures } from './demoMonthEnd'
import { periodEnd, periodStart, previousRangeFor, rangeFor } from './period'

const { accounts, entries } = demoLedger
const cents = (dollars: number) => Math.round(dollars * 100)
const cell = (table: { rows: { key: string; cells: (number | null)[] }[] }, key: string, column = 0) => table.rows.find((row) => row.key === key)?.cells[column]
const august = { start: '2026-08-01', end: '2026-08-31', label: 'August 2026' }
const july = { start: '2026-07-01', end: '2026-07-31', label: 'July 2026' }

describe('ledger structure', () => {
  it('the demo books are valid: every entry balances and uses known accounts and whole cents', () => {
    expect(validateLedger(accounts, entries)).toEqual([])
  })

  it('rejects an out-of-balance entry, an unknown account, a bad date and fractional cents', () => {
    const bad: JournalEntry[] = [
      { id: 'a', date: '2026-01-01', memo: '', lines: [{ accountId: 'x', debitCents: 100, creditCents: 0 }, { accountId: 'y', debitCents: 0, creditCents: 90 }] },
      { id: 'b', date: '2026-02-30', memo: '', lines: [{ accountId: 'x', debitCents: 10.5, creditCents: 0 }, { accountId: 'y', debitCents: 0, creditCents: 10.5 }] },
    ]
    const defs: LedgerAccountDef[] = [{ id: 'x', name: 'X', klass: 'asset' }]
    const messages = validateLedger(defs, bad).map((issue) => issue.message).join(' | ')
    expect(messages).toContain('out of balance by $0.10')
    expect(messages).toContain('Unknown account "y"')
    expect(messages).toContain('Invalid date')
    expect(messages).toContain('whole cents')
  })

  it('a failing ledger shows up as a failed check on every statement instead of producing plausible numbers', () => {
    const broken: JournalEntry[] = [...entries, { id: 'broken', date: '2026-08-10', memo: 'bad', lines: [{ accountId: 'checking', debitCents: 500, creditCents: 0 }] }]
    expect(profitAndLoss(accounts, broken, '2026-08-01', '2026-08-31').checks.find((check) => check.id === 'ledger-valid')?.status).toBe('fail')
    expect(balanceSheet(accounts, broken, '2026-08-31').checks.find((check) => check.id === 'ledger-valid')?.status).toBe('fail')
  })
})

// Hand-calculated from the fixture documents (see shared/demoBooks.ts), not from the code under test.
describe('demo books: balances that must tie to the Phase 4 reconciliation demo', () => {
  it('checking ends July at $47,000.00 and August at $48,421.72, matching the statement', () => {
    expect(balanceAt(accounts, entries, 'checking', '2026-07-31')).toBe(4_700_000)
    expect(balanceAt(accounts, entries, 'checking', '2026-08-31')).toBe(4_842_172)
  })

  it('the card owes $5,524.20 at July 31 and $6,010.30 in the books at August 31, $224.20 less than the statement', () => {
    expect(balanceAt(accounts, entries, 'card', '2026-07-31')).toBe(552_420)
    expect(balanceAt(accounts, entries, 'card', '2026-08-31')).toBe(601_030)
    expect(623_450 - balanceAt(accounts, entries, 'card', '2026-08-31')).toBe(22_420)
  })

  it('the August bank register is exactly the Phase 4 checking transactions', () => {
    const register = demoRegister('checking', { year: 2026, month: 8 })
    expect(register).toHaveLength(13)
    expect(register.reduce((total, item) => total + (item.direction === 'increase' ? item.amountCents : -item.amountCents), 0)).toBe(142_172)
  })
})

describe('profit and loss', () => {
  it('August: income, cost of goods, expenses and net income are calculated from the ledger', () => {
    const summary = profitAndLossSummary(accounts, entries, '2026-08-01', '2026-08-31')
    // Invoices issued in August: 4200 + 3150 + 1980 + 1650.
    expect(summary.incomeCents).toBe(cents(10_980))
    // Materials: Home Depot 341.22 + Ace 96.37 + Lowe's 412.06 + bills 1284 + 860.
    expect(summary.cogsCents).toBe(cents(2_993.65))
    // Other expenses: 3578.28 checking + 486.10 card + bills (126.44 + 286 + 210) - materials above.
    expect(summary.cogsCents + summary.expenseCents).toBe(cents(3_578.28 + 486.1 + 1_284 + 860 + 126.44 + 286 + 210))
    expect(summary.netIncomeCents).toBe(cents(10_980 - (3_578.28 + 486.1 + 1_284 + 860 + 126.44 + 286 + 210)))
    expect(summary.netIncomeCents).toBe(414_918)
  })

  it('a statement is arithmetically consistent: its net income row equals the independent account-level total', () => {
    const table = profitAndLoss(accounts, entries, '2026-08-01', '2026-08-31')
    expect(cell(table, 'net-income')).toBe(414_918)
    expect(table.checks.every((check) => check.status === 'pass')).toBe(true)
  })

  it('a month with no activity reports zeros that are true, and omits empty sections', () => {
    const table = profitAndLoss(accounts, entries, '2026-09-01', '2026-09-30')
    expect(cell(table, 'net-income')).toBe(0)
    expect(table.rows.some((row) => row.key === 'h-income')).toBe(false)
  })
})

describe('balance sheet', () => {
  it('August 31 balances: assets equal liabilities plus equity', () => {
    const summary = balanceSheetSummary(accounts, entries, '2026-08-31')
    expect(summary.assetsCents).toBe(summary.liabilitiesCents + summary.equityCents)
    // checking 48,421.72 + undeposited 400 + AR 8,420 + equipment 12,000
    expect(summary.assetsCents).toBe(cents(48_421.72 + 400 + 8_420 + 12_000))
    // card 6,010.30 + AP 2,556.44
    expect(summary.liabilitiesCents).toBe(cents(6_010.3 + 2_556.44))
  })

  it('current-year earnings are the year-to-date net income, which includes every earlier month this year', () => {
    const summary = balanceSheetSummary(accounts, entries, '2026-08-31')
    const ytd = profitAndLossSummary(accounts, entries, '2026-01-01', '2026-08-31').netIncomeCents
    expect(summary.currentEarningsCents).toBe(ytd)
    expect(summary.retainedEarningsCents).toBe(0)
  })

  it('earnings of a prior year roll into retained earnings and the sheet still balances', () => {
    const prior: JournalEntry[] = [
      { id: 'sale', date: '2025-06-01', memo: '', lines: [{ accountId: 'cash', debitCents: 1000, creditCents: 0 }, { accountId: 'inc', debitCents: 0, creditCents: 1000 }] },
      { id: 'cost', date: '2026-02-01', memo: '', lines: [{ accountId: 'exp', debitCents: 300, creditCents: 0 }, { accountId: 'cash', debitCents: 0, creditCents: 300 }] },
    ]
    const defs: LedgerAccountDef[] = [{ id: 'cash', name: 'Cash', klass: 'asset', cashFlow: 'cash' }, { id: 'inc', name: 'Income', klass: 'income' }, { id: 'exp', name: 'Expense', klass: 'expense' }]
    const summary = balanceSheetSummary(defs, prior, '2026-03-31')
    expect(summary.retainedEarningsCents).toBe(1000)
    expect(summary.currentEarningsCents).toBe(-300)
    expect(summary.assetsCents).toBe(700)
    expect(summary.assetsCents).toBe(summary.liabilitiesCents + summary.equityCents)
  })
})

describe('trial balance and general ledger', () => {
  it('total debits equal total credits', () => {
    const table = trialBalance(accounts, entries, '2026-08-31')
    const total = table.rows.find((row) => row.key === 'total')!
    expect(total.cells[0]).toBe(total.cells[1])
    expect(table.checks.find((check) => check.id === 'tb-balanced')?.status).toBe('pass')
  })

  it('the general ledger running balance ends at the balance-sheet balance for each account', () => {
    const table = generalLedger(accounts, entries, '2026-08-01', '2026-08-31')
    const closing = table.rows.find((row) => row.key === 't-checking')
    expect(closing?.cells[2]).toBe(4_842_172)
    expect(table.checks.every((check) => check.status === 'pass')).toBe(true)
  })
})

describe('cash flow', () => {
  it('August: the indirect-method change equals the actual change in cash', () => {
    const table = cashFlow(accounts, entries, '2026-08-01', '2026-08-31')
    expect(cell(table, 'net-change')).toBe(142_172)
    expect(cell(table, 'beginning-cash')).toBe(4_700_000)
    expect(cell(table, 'ending-cash')).toBe(4_842_172)
    expect(table.checks.every((check) => check.status === 'pass')).toBe(true)
  })

  it('operating, investing and financing add up to the net change', () => {
    const table = cashFlow(accounts, entries, '2026-08-01', '2026-08-31')
    expect((cell(table, 'total-operating') ?? 0) + (cell(table, 'total-investing') ?? 0) + (cell(table, 'total-financing') ?? 0)).toBe(cell(table, 'net-change'))
  })

  it('refuses to vouch for a statement when an account that moved is not classified', () => {
    const unclassified = accounts.map((account) => (account.id === 'equipment' ? { ...account, cashFlow: undefined } : account))
    const extra: JournalEntry[] = [...entries, { id: 'buy', date: '2026-08-15', memo: 'Truck', lines: [{ accountId: 'equipment', debitCents: 100_000, creditCents: 0 }, { accountId: 'checking', debitCents: 0, creditCents: 100_000 }] }]
    const check = cashFlow(unclassified, extra, '2026-08-01', '2026-08-31').checks.find((item) => item.id === 'cf-classified')
    expect(check?.status).toBe('fail')
    expect(check?.detail).toContain('Equipment')
  })
})

describe('aging', () => {
  it('open balance ignores payments made after the as-of date and documents dated after it', () => {
    const invoice = demoReceivableItems().find((item) => item.number === 'INV-1002')!
    expect(openBalanceCents(invoice, '2026-08-31')).toBe(cents(1_950))
    expect(openBalanceCents(invoice, '2026-08-10')).toBe(cents(3_150))
    expect(openBalanceCents(invoice, '2026-08-01')).toBe(0)
  })

  it('August 31 receivables are bucketed by days past due and total $8,420.00', () => {
    const { table, totalCents } = aging('ar-aging', demoReceivableItems(), '2026-08-31')
    expect(totalCents).toBe(cents(8_420))
    expect(cell(table, 'Riverside Retail', 1)).toBe(cents(2_840))
    expect(cell(table, 'Riverside Retail', 0)).toBe(0)
    expect(cell(table, 'total', 0)).toBe(cents(1_950 + 1_980 + 1_650))
  })

  it('the aging total agrees with the ledger control account, and a disagreement is reported', () => {
    const arCheck = demoReport('ar-aging', august).checks.find((check) => check.id === 'aging-control')
    expect(arCheck?.status).toBe('pass')
    const apCheck = demoReport('ap-aging', august).checks.find((check) => check.id === 'aging-control')
    expect(apCheck?.status).toBe('pass')
    expect(aging('ap-aging', demoPayableItems(), '2026-08-31').totalCents).toBe(cents(2_556.44))
  })
})

describe('period comparison', () => {
  it('shows current, previous and the exact change; a figure is never silently invented', () => {
    const table = demoComparison('profit-loss', august, july)!
    const net = table.rows.find((row) => row.key === 'net-income')!
    const julyNet = profitAndLossSummary(accounts, entries, '2026-07-01', '2026-07-31').netIncomeCents
    expect(net.cells).toEqual([414_918, julyNet, 414_918 - julyNet])
    expect(table.columns.map((column) => column.label)).toEqual(['August 2026', 'July 2026', 'Change'])
  })

  it('has no comparison where the previous period is outside the books', () => {
    expect(demoComparison('profit-loss', { start: '2026-05-01', end: '2026-05-31', label: 'May' }, { start: '2026-04-01', end: '2026-04-30', label: 'April' })).toBeNull()
  })

  it('an account used only in the previous period still appears, with zero this period', () => {
    const current = withComparison(
      { id: 'profit-loss', title: 'P', columns: [], checks: [], rows: [{ key: 'a', label: 'A', cells: [100], level: 1, style: 'normal' }, { key: 'net', label: 'Net', cells: [100], level: 0, style: 'grand' }] },
      { id: 'profit-loss', title: 'P', columns: [], checks: [], rows: [{ key: 'a', label: 'A', cells: [40], level: 1, style: 'normal' }, { key: 'b', label: 'B', cells: [60], level: 1, style: 'normal' }, { key: 'net', label: 'Net', cells: [100], level: 0, style: 'grand' }] },
      { current: 'Now', previous: 'Before' }, true,
    )
    expect(current.rows.find((row) => row.key === 'b')?.cells).toEqual([0, 60, -60])
  })

  it('without zero-filling, a missing row stays unavailable (null) rather than becoming zero', () => {
    const merged = withComparison(
      { id: 'profit-loss', title: 'P', columns: [], checks: [], rows: [{ key: 'a', label: 'A', cells: [100], level: 1, style: 'normal' }] },
      { id: 'profit-loss', title: 'P', columns: [], checks: [], rows: [{ key: 'b', label: 'B', cells: [60], level: 1, style: 'normal' }] },
      { current: 'Now', previous: 'Before' }, false,
    )
    expect(merged.rows.find((row) => row.key === 'a')?.cells).toEqual([100, null, null])
    expect(merged.rows.find((row) => row.key === 'b')?.cells).toEqual([null, 60, null])
  })
})

describe('ranges', () => {
  it('month, quarter-to-date and year-to-date end with the selected month; previous ranges shift back by the right amount', () => {
    const period = { year: 2026, month: 8 }
    expect(rangeFor(period, 'month')).toMatchObject({ start: '2026-08-01', end: '2026-08-31' })
    expect(rangeFor(period, 'quarter')).toMatchObject({ start: '2026-07-01', end: '2026-08-31', label: 'July 2026 to August 2026' })
    expect(rangeFor(period, 'ytd')).toMatchObject({ start: '2026-01-01', end: '2026-08-31' })
    expect(previousRangeFor(period, 'month')).toMatchObject({ start: '2026-07-01', end: '2026-07-31' })
    expect(previousRangeFor(period, 'quarter')).toMatchObject({ start: '2026-04-01', end: '2026-05-31' })
    expect(previousRangeFor(period, 'ytd')).toMatchObject({ start: '2025-01-01', end: '2025-08-31' })
    expect(previousRangeFor({ year: 2026, month: 1 }, 'month')).toMatchObject({ start: '2025-12-01', end: '2025-12-31' })
  })

  it('February in a leap and a non-leap year', () => {
    expect(periodEnd({ year: 2028, month: 2 })).toBe('2028-02-29')
    expect(periodEnd({ year: 2026, month: 2 })).toBe('2026-02-28')
    expect(periodStart({ year: 2026, month: 2 })).toBe('2026-02-01')
  })
})

describe('demo client figures', () => {
  it('are calculated from the ledger, not typed in', () => {
    const figures = demoClientFigures({ year: 2026, month: 8 })
    expect(figures.profitCents).toBe(414_918)
    expect(figures.bankBalanceCents).toBe(4_842_172)
    expect(figures.receivableCents).toBe(cents(8_420))
    expect(figures.payableCents).toBe(cents(2_556.44))
  })
})
