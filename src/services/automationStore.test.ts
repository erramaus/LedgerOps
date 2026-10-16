import { describe, expect, it } from 'vitest'
import { appendUniqueEvent, parseEvents, parseRecurringDecisions, parseRules, readRules, writeRules, type AutomationAuditEvent } from './automationStore'
import type { AutomationRule } from './automationRules'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  }
}

const rule: AutomationRule = {
  id: 'rule-1',
  source: 'demo',
  clientId: 'abc-plumbing',
  name: 'Amazon office supplies',
  enabled: true,
  priority: 1,
  payeeContains: 'amazon',
  transactionKind: 'Expense',
  category: 'Office Supplies',
  reviewPriority: 'High',
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
}

describe('automation persistence', () => {
  it('round-trips rules through storage', () => {
    const storage = memoryStorage()
    writeRules([rule], storage)
    expect(readRules(storage)).toEqual([rule])
  })

  it('falls back safely on invalid serialized data', () => {
    expect(parseRules('{bad json')).toEqual([])
    expect(parseEvents('{bad json')).toEqual([])
    expect(parseRecurringDecisions('{bad json')).toEqual([])
  })

  it('prevents duplicate generated-suggestion audit events', () => {
    const storage = memoryStorage()
    const event: AutomationAuditEvent = {
      id: 'evt-1',
      at: '2026-10-15T00:00:00.000Z',
      source: 'demo',
      clientId: 'abc-plumbing',
      kind: 'suggestion-generated',
      summary: 'Generated Amazon suggestion',
      referenceId: 'abc-plumbing:txn-1:rule-1',
    }
    appendUniqueEvent(event, storage)
    appendUniqueEvent({ ...event, id: 'evt-2' }, storage)
    expect(parseEvents(storage.getItem('ledgerops-automation-audit-v1'))).toHaveLength(1)
  })
})
