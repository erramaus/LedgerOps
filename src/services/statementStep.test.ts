import { describe, expect, it } from 'vitest'
import { displayBalance, netChangeCents, nextStatementDate, validateStatement } from './statementStep'

const valid = { periodStart: '2026-08-01', periodEnd: '2026-08-31', statementDate: '2026-08-31', beginning: '47000.00', ending: '49,500.25' }

describe('statement date defaults', () => {
  it('follows the end date until changed', () => {
    expect(nextStatementDate('2026-08-31', '2026-09-30', '2026-08-31')).toBe('2026-09-30')
    expect(nextStatementDate('2026-08-31', '2026-09-30', '')).toBe('2026-09-30')
  })
  it('never overwrites a date the user chose', () => {
    expect(nextStatementDate('2026-08-31', '2026-09-30', '2026-09-02')).toBe('2026-09-02')
  })
})

describe('net change and currency display', () => {
  it('is ending minus beginning in cents, including negatives', () => {
    expect(netChangeCents(4700000, 4950025)).toBe(250025)
    expect(netChangeCents(10000, 2500)).toBe(-7500)
    expect(netChangeCents(10, 30)).toBe(20)
  })
  it('formats valid amounts and leaves other text alone', () => {
    expect(displayBalance('47000')).toBe('$47,000.00')
    expect(displayBalance('1234567.8')).toBe('$1,234,567.80')
    expect(displayBalance('')).toBe('')
    expect(displayBalance('abc')).toBe('abc')
  })
})

describe('validateStatement', () => {
  it('accepts a valid statement and returns exact cents', () => {
    const result = validateStatement(valid)
    expect(result.errors).toEqual([])
    expect(result.beginningCents).toBe(4700000)
    expect(result.endingCents).toBe(4950025)
  })
  it('rejects invalid dates and an inverted range', () => {
    expect(validateStatement({ ...valid, periodEnd: '2026-02-31' }).errors[0]).toMatch(/valid dates/)
    expect(validateStatement({ ...valid, statementDate: '' }).errors[0]).toMatch(/valid dates/)
    expect(validateStatement({ ...valid, periodStart: '2026-09-01' }).errors[0]).toMatch(/after the end date/)
  })
  it('rejects missing or non-numeric balances', () => {
    expect(validateStatement({ ...valid, beginning: '' }).errors[0]).toMatch(/numbers/)
    expect(validateStatement({ ...valid, ending: 'x' }).errors[0]).toMatch(/numbers/)
  })
  it('requires the beginning balance to agree with the previous completed reconciliation', () => {
    const previous = { periodEnd: '2026-07-31', endingCents: 4700000 }
    expect(validateStatement(valid, previous).errors).toEqual([])
    const mismatch = validateStatement({ ...valid, beginning: '46999.99' }, previous)
    expect(mismatch.errors[0]).toMatch(/does not agree with the previous completed reconciliation/)
    expect(mismatch.errors[0]).toContain('$47,000.00')
  })
  it('does not invent an opening balance when there is no previous reconciliation', () => {
    expect(validateStatement({ ...valid, beginning: '1.00' }).errors).toEqual([])
  })
})
