import { describe, expect, it } from 'vitest'
import type { ClientRequest } from './bookkeepingTypes'
import { buildClientRequestTasks } from './workQueue'

const request = (id: string, status: ClientRequest['status']) =>
  ({ id, client: 'Any', clientId: 'x', requestType: 'Missing Receipt', status, question: 'Q', dateCreated: '2026-10-01', relatedTransaction: 'Vendor' }) as ClientRequest

describe('buildClientRequestTasks', () => {
  it('tags every task with the owning client and skips completed requests', () => {
    const tasks = buildClientRequestTasks({ id: 'smith', name: 'Smith Construction' }, [request('a', 'Client Responded'), request('b', 'Completed')])
    expect(tasks.length).toBeGreaterThan(0)
    expect(tasks.every((task) => task.clientId === 'smith')).toBe(true)
    expect(tasks.some((task) => task.requestId === 'b')).toBe(false)
    expect(new Set(tasks.map((task) => task.id)).size).toBe(tasks.length)
  })
})
