import { describe, expect, it } from 'vitest'
import { taskButtonLabel, sortTasks, type WorkTask } from './workQueue'

const task = (overrides: Partial<WorkTask>): WorkTask => ({
  id: 't', clientId: 'c', client: 'Client', type: 'Transactions', kind: 'uncategorized', issue: 'Issue', description: 'd',
  priority: 'Medium', status: 'Open', suspected: false, count: 1, destination: 'Transactions', action: 'Categorize', ...overrides,
})

describe('taskButtonLabel', () => {
  it.each<[Partial<WorkTask>, string]>([
    [{ destination: 'Transactions' }, 'Review Transaction'],
    [{ destination: 'Transactions', count: 3 }, 'Review Transactions'],
    [{ destination: 'Payables', kind: 'overdue-bill' }, 'Review Bill'],
    [{ destination: 'Receivables', kind: 'overdue-invoice' }, 'Review Invoice'],
    [{ destination: 'Reconcile', kind: 'reconciliation-difference' }, 'Open Reconciliation'],
    [{ destination: 'Month End', kind: 'month-end-open' }, 'Finish Month End'],
    [{ destination: 'Client Requests', kind: 'client-question', requestId: 'r1', action: 'Open request' }, 'Open Request'],
    [{ destination: 'Client Requests', kind: 'client-question', requestId: 'r1', action: 'Review response' }, 'Review Response'],
    [{ destination: 'Transactions', kind: 'summary-flagged', action: 'Open client' }, 'Open Client'],
    [{ destination: 'Transactions', kind: 'missing-recurring' }, 'Review Reminder'],
  ])('%j -> %s', (overrides, label) => {
    expect(taskButtonLabel(task(overrides))).toBe(label)
  })
})

describe('Today\'s work ordering', () => {
  it('lists high priority first, then the earliest (overdue) due date', () => {
    const sorted = sortTasks([
      task({ id: 'low', priority: 'Low', dueDate: '2026-01-01' }),
      task({ id: 'high-late', priority: 'High', dueDate: '2026-10-20' }),
      task({ id: 'high-overdue', priority: 'High', dueDate: '2026-10-01' }),
    ])
    expect(sorted.map((item) => item.id)).toEqual(['high-overdue', 'high-late', 'low'])
  })
})
