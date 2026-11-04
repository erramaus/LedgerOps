import { describe, expect, it } from 'vitest'
import { journalReadiness, parseAmountCents } from './journalForm'

const line = (accountId: string, debit: string, credit: string) => ({ accountId, debit, credit })

describe('parseAmountCents', () => {
  it('parses whole cents and rejects invalid text', () => {
    expect(parseAmountCents('')).toBe(0)
    expect(parseAmountCents('12.5')).toBe(1250)
    expect(parseAmountCents('0.07')).toBe(7)
    expect(parseAmountCents('-5')).toBeNaN()
    expect(parseAmountCents('1.234')).toBeNaN()
    expect(parseAmountCents('abc')).toBeNaN()
  })
})

describe('journalReadiness', () => {
  it('treats an empty entry as not ready and not balanced', () => {
    const result = journalReadiness([line('', '', ''), line('', '', '')])
    expect(result.state).toBe('empty')
    expect(result.ready).toBe(false)
  })

  it('does not treat an all-zero entry as ready', () => {
    const result = journalReadiness([line('a', '0', ''), line('b', '', '0.00')])
    expect(result.ready).toBe(false)
    expect(result.state).toBe('invalid')
  })

  it('reports an unbalanced entry with the difference in cents', () => {
    const result = journalReadiness([line('a', '100.10', ''), line('b', '', '100.00')])
    expect(result.state).toBe('unbalanced')
    expect(result.differenceCents).toBe(10)
    expect(result.ready).toBe(false)
  })

  it('requires an account on every line', () => {
    const result = journalReadiness([line('a', '50', ''), line('', '', '50')])
    expect(result.ready).toBe(false)
    expect(result.reasons.join(' ')).toContain('Line 2: choose an account.')
  })

  it('rejects a line with both a debit and a credit', () => {
    expect(journalReadiness([line('a', '5', '5'), line('b', '5', '')]).ready).toBe(false)
  })

  it('accepts a valid balanced entry using integer cents', () => {
    const result = journalReadiness([line('a', '0.10', ''), line('b', '0.20', ''), line('c', '', '0.30')])
    expect(result).toMatchObject({ debitCents: 30, creditCents: 30, differenceCents: 0, state: 'balanced', ready: true, reasons: [] })
  })
})
