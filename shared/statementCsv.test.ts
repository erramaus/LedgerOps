import { describe, expect, it } from 'vitest'
import { applyMapping, parseCsv, parseDate, suggestMapping, type CsvMapping } from './statementCsv.js'

const period = { start: '2026-08-01', end: '2026-08-31' }
const base = (overrides: Partial<CsvMapping> = {}): CsvMapping => ({ hasHeader: true, date: 0, description: 1, amount: 2, debitMeans: 'decrease', positiveMeans: 'increase', dateFormat: 'auto', ...overrides })

describe('parsing CSV text', () => {
  it('handles quotes, escaped quotes, commas and blank lines', () => {
    expect(parseCsv('Date,Description,Amount\n08/05/2026,"Smith, J ""Bob""",12.50\n\n08/06/2026,Plain,-3')).toEqual([
      ['Date', 'Description', 'Amount'], ['08/05/2026', 'Smith, J "Bob"', '12.50'], ['08/06/2026', 'Plain', '-3'],
    ])
  })
  it('detects semicolon and tab delimiters and strips a byte-order mark', () => {
    expect(parseCsv('\uFEFFa;b\n1;2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('keeps newlines inside quoted fields and handles CRLF', () => {
    expect(parseCsv('a,b\r\n"x\ny",2\r\n')).toEqual([['a', 'b'], ['x\ny', '2']])
  })
  it('rejects an unclosed quote', () => {
    expect(() => parseCsv('a,b\n"oops,1')).toThrow(/unclosed quote/)
  })
})

describe('column mapping suggestions', () => {
  it('finds date, description and a single amount column', () => {
    expect(suggestMapping(['Posting Date', 'Description', 'Amount'], 'bank')).toMatchObject({ date: 0, description: 1, amount: 2 })
  })
  it('finds separate debit and credit columns and sets the direction by account type', () => {
    expect(suggestMapping(['Date', 'Memo', 'Debit', 'Credit'], 'bank')).toMatchObject({ debit: 2, credit: 3, debitMeans: 'decrease' })
    expect(suggestMapping(['Date', 'Memo', 'Debit', 'Credit'], 'credit_card').debitMeans).toBe('increase')
  })
})

describe('dates', () => {
  it('parses ISO and US dates and rejects impossible ones', () => {
    expect(parseDate('2026-08-05', 'auto')).toEqual({ iso: '2026-08-05', ambiguous: false })
    expect(parseDate('8/5/2026', 'MDY')?.iso).toBe('2026-08-05')
    expect(parseDate('31/08/2026', 'auto')?.iso).toBe('2026-08-31')
    expect(parseDate('02/30/2026', 'MDY')).toBeNull()
    expect(parseDate('hello', 'auto')).toBeNull()
  })
  it('reports ambiguous day/month order and respects an explicit choice', () => {
    expect(parseDate('03/04/2026', 'auto')?.ambiguous).toBe(true)
    expect(parseDate('03/04/2026', 'DMY')).toEqual({ iso: '2026-04-03', ambiguous: false })
    expect(parseDate('03/04/2026', 'MDY')).toEqual({ iso: '2026-03-04', ambiguous: false })
  })
})

describe('turning rows into statement lines', () => {
  const rows = [['Date', 'Description', 'Amount'], ['2026-08-05', 'Deposit', '500.00'], ['2026-08-10', 'Check 1001', '-120.00']]

  it('maps a signed amount column and leaves the source untouched', () => {
    const result = applyMapping(rows, base(), period)
    expect(result.errors).toEqual([])
    expect(result.lines).toEqual([
      { id: 'line-1', date: '2026-08-05', description: 'Deposit', amountCents: 50000, direction: 'increase' },
      { id: 'line-2', date: '2026-08-10', description: 'Check 1001', amountCents: 12000, direction: 'decrease' },
    ])
  })
  it('can treat positive amounts as decreases (some card exports)', () => {
    expect(applyMapping(rows, base({ positiveMeans: 'decrease' }), period).lines.map((line) => line.direction)).toEqual(['decrease', 'increase'])
  })
  it('maps debit and credit columns for bank and card accounts', () => {
    const split = [['Date', 'Memo', 'Debit', 'Credit'], ['2026-08-05', 'Rent', '900.00', ''], ['2026-08-06', 'Refund', '', '25.00']]
    const mapping = base({ amount: undefined, debit: 2, credit: 3, debitMeans: 'decrease' })
    expect(applyMapping(split, mapping, period).lines.map((line) => [line.amountCents, line.direction])).toEqual([[90000, 'decrease'], [2500, 'increase']])
    expect(applyMapping(split, { ...mapping, debitMeans: 'increase' }, period).lines.map((line) => line.direction)).toEqual(['increase', 'decrease'])
  })
  it('reports invalid dates and amounts per row without importing them', () => {
    const result = applyMapping([['d', 'x', 'a'], ['nope', 'x', '1'], ['2026-08-05', 'x', 'twelve'], ['2026-08-06', 'ok', '5']], base(), period)
    expect(result.lines).toHaveLength(1)
    expect(result.errors.map((error) => error.row)).toEqual([2, 3])
    expect(result.errors[0].message).toMatch(/not a valid date/)
    expect(result.errors[1].message).toMatch(/not a valid number/)
  })
  it('rejects a row with both a debit and a credit', () => {
    const result = applyMapping([['d', 'x', 'dr', 'cr'], ['2026-08-05', 'x', '5', '5']], base({ amount: undefined, debit: 2, credit: 3 }), period)
    expect(result.errors[0].message).toMatch(/both a debit and a credit/)
  })
  it('warns about zero amounts and dates outside the statement period', () => {
    const result = applyMapping([['d', 'x', 'a'], ['2026-08-05', 'zero', '0.00'], ['2026-09-03', 'late', '5'], ['2026-07-30', 'early', '5']], base(), period)
    expect(result.warnings.map((warning) => warning.message).join(' ')).toMatch(/zero-amount.*3 days outside.*2 days outside/)
    expect(result.lines).toHaveLength(2)
  })
  it('warns when day and month order is ambiguous', () => {
    expect(applyMapping([['d', 'x', 'a'], ['03/04/2026', 'x', '5']], base(), { start: '2026-03-01', end: '2026-04-30' }).warnings.some((warning) => /ambiguous/.test(warning.message))).toBe(true)
  })
  it('treats a file with no transactions as an error', () => {
    expect(applyMapping([['Date', 'Description', 'Amount']], base(), period).errors[0].message).toMatch(/No transactions/)
  })
  it('works without a header row', () => {
    expect(applyMapping([['2026-08-05', 'x', '5']], base({ hasHeader: false }), period).lines).toHaveLength(1)
  })
})
