import { describe, expect, it } from 'vitest'
import { buildAutomationTasks } from './automationReminders'
import type { RecurringPattern } from './recurringTransactions'

const pattern = (overrides: Partial<RecurringPattern> = {}): RecurringPattern => ({
  id: 'demo:abc:adobe:monthly',
  source: 'demo',
  clientId: 'abc-plumbing',
  vendor: 'Adobe',
  typicalAmountCents: 5_999,
  frequency: 'Monthly',
  expectedNextDate: '2026-09-25',
  confidence: 'High',
  evidence: ['3 matching charges found.'],
  supportingTransactionIds: ['a', 'b', 'c'],
  missing: true,
  reviewPriority: 'High',
  ...overrides,
})

describe('automation reminders', () => {
  it('creates recurring reminder tasks without duplicating rule suggestions', () => {
    const tasks = buildAutomationTasks({ id: 'abc-plumbing', name: 'ABC Plumbing' }, new Map(), [pattern()])
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      kind: 'missing-recurring',
      type: 'Transactions',
      status: 'Ready to review',
      clientId: 'abc-plumbing',
    })
  })

  it('ignores non-missing recurring patterns', () => {
    expect(buildAutomationTasks({ id: 'abc-plumbing', name: 'ABC Plumbing' }, new Map(), [pattern({ missing: false })])).toEqual([])
  })
})
