import { describe, expect, it } from 'vitest'
import { cleanDescription, dueLabel, filterByReadiness, isWaiting, localIsoDate, searchTasks } from './inboxView'
import type { WorkTask } from './workQueue'

const task = (over: Partial<WorkTask>): WorkTask => ({
  id: 'c/1', clientId: 'c', client: 'ABC Plumbing', type: 'Payables', kind: 'overdue-bill', issue: 'Overdue bill',
  description: 'Home Depot bill B-77 is overdue.', priority: 'High', status: 'Open', suspected: false, count: 1,
  destination: 'Payables', action: 'Review bill', ...over,
})

describe('localIsoDate', () => {
  it('uses the local calendar day, not UTC', () => {
    expect(localIsoDate(new Date(2026, 10, 2, 23, 30))).toBe('2026-11-02')
    expect(localIsoDate(new Date(2026, 0, 5, 0, 10))).toBe('2026-01-05')
  })
})

describe('searchTasks', () => {
  const tasks = [
    task({ id: 'a', amount: 1234.5, recordId: 'bill-9' }),
    task({ id: 'b', client: 'Smith Construction', description: 'Amazon has no category or account.', type: 'Transactions', destination: 'Transactions' }),
  ]
  it('matches client, vendor, reference, description and amount', () => {
    expect(searchTasks(tasks, 'smith').map((t) => t.id)).toEqual(['b'])
    expect(searchTasks(tasks, 'home depot').map((t) => t.id)).toEqual(['a'])
    expect(searchTasks(tasks, 'B-77').map((t) => t.id)).toEqual(['a'])
    expect(searchTasks(tasks, 'amazon').map((t) => t.id)).toEqual(['b'])
    expect(searchTasks(tasks, '1,234.50').map((t) => t.id)).toEqual(['a'])
  })
  it('returns everything for a blank query and nothing for no match', () => {
    expect(searchTasks(tasks, '   ')).toHaveLength(2)
    expect(searchTasks(tasks, 'zzz')).toHaveLength(0)
  })
})

describe('readiness', () => {
  const tasks = [task({ id: 'a' }), task({ id: 'b', status: 'Waiting on client' }), task({ id: 'c', status: 'Ready to review' })]
  it('separates waiting tasks without dropping any', () => {
    expect(isWaiting(tasks[1])).toBe(true)
    expect(filterByReadiness(tasks, 'ready').map((t) => t.id)).toEqual(['a', 'c'])
    expect(filterByReadiness(tasks, 'waiting').map((t) => t.id)).toEqual(['b'])
    expect(filterByReadiness(tasks, 'all')).toHaveLength(3)
  })
})

describe('dueLabel and cleanDescription', () => {
  it('describes dates relative to the supplied day and tolerates bad dates', () => {
    expect(dueLabel(task({ dueDate: '2026-11-02' }), '2026-11-02')?.label).toBe('Due today')
    expect(dueLabel(task({ dueDate: '2026-11-03' }), '2026-11-02')?.label).toBe('Due tomorrow')
    expect(dueLabel(task({ dueDate: '2026-08-15' }), '2026-11-02')?.label).toBe('Overdue by 79 days')
    expect(dueLabel(task({ dueDate: 'not a date' }), '2026-11-02')).toBeUndefined()
    expect(dueLabel(task({}), '2026-11-02')).toBeUndefined()
  })
  it('removes duplicated due wording only when a due date is shown', () => {
    expect(cleanDescription(task({ dueDate: '2026-08-15' })))    .toBe('Home Depot bill B-77.')
        expect(cleanDescription(task({}))).toBe('Home Depot bill B-77 is overdue.')
        expect(cleanDescription(task({}))).toBe('Home Depot bill B-77 is overdue.')
    expect(cleanDescription(task({ dueDate: '2026-08-15', description: 'Acme invoice INV-1 is due on Aug 15, 2026.' }))).toBe('Acme invoice INV-1.')
  })
})
