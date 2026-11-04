import { describe, expect, it } from 'vitest'
import type { AutomationRule } from './automationRules'
import { classifyConnection, describeStorage, ruleFormFromRule, ruleFormHasUnsavedWork, SETTINGS_SECTIONS } from './settingsStatus'

const response = (status: number, json?: { connected?: boolean; error?: string } | null) => ({ kind: 'response' as const, status, json })

describe('classifyConnection', () => {
  it('reports connected and not connected from a real status answer', () => {
    expect(classifyConnection(response(200, { connected: true }), false).state).toBe('connected')
    expect(classifyConnection(response(200, { connected: false }), false).state).toBe('not-connected')
  })

  it('does not guess when a 2xx answer has no connected flag', () => {
    expect(classifyConnection(response(200, {}), false).state).toBe('error')
    expect(classifyConnection(response(200, null), false).state).toBe('error')
  })

  it('reports authentication required and explains the development bypass', () => {
    const normal = classifyConnection(response(401, { error: 'Authentication required.' }), false)
    const bypass = classifyConnection(response(401, { error: 'Authentication required.' }), true)
    expect(normal.state).toBe('auth-required')
    expect(normal.detail).not.toMatch(/bypass/i)
    expect(bypass.state).toBe('auth-required')
    expect(bypass.detail).toMatch(/bypass/i)
    expect(bypass.detail).toMatch(/real sign-in/i)
  })

  it('reports an unreachable backend for network failures and gateway errors', () => {
    expect(classifyConnection({ kind: 'network' }, false).state).toBe('backend-unavailable')
    expect(classifyConnection(response(502), false).state).toBe('backend-unavailable')
    expect(classifyConnection(response(503, null), false).state).toBe('backend-unavailable')
    expect(classifyConnection(response(500, null), false).state).toBe('backend-unavailable')
  })

  it('reports a connection error when the backend answered with an error', () => {
    const summary = classifyConnection(response(500, { error: 'Token refresh failed' }), false)
    expect(summary.state).toBe('error')
    expect(summary.detail).toContain('Token refresh failed')
    expect(classifyConnection(response(400, null), false).detail).toContain('400')
  })

  it('uses the exact labels', () => {
    expect(classifyConnection(response(200, { connected: true }), false).label).toBe('Connected')
    expect(classifyConnection(response(200, { connected: false }), false).label).toBe('Not connected')
    expect(classifyConnection(response(401), false).label).toBe('Authentication required')
    expect(classifyConnection({ kind: 'network' }, false).label).toBe('Backend unavailable')
    expect(classifyConnection(response(418, { error: 'x' }), false).label).toBe('Connection error')
  })
})

describe('describeStorage', () => {
  it('describes durable and temporary storage from the backend report', () => {
    expect(describeStorage({ durable: true })).toMatchObject({ state: 'durable', label: 'Database-backed' })
    expect(describeStorage({ durable: false })).toMatchObject({ state: 'temporary', label: 'Temporary' })
  })

  it('never claims durability when the backend did not report', () => {
    const unknown = describeStorage('unavailable')
    expect(unknown.state).toBe('unavailable')
    expect(unknown.detail).toMatch(/temporary/i)
    expect(describeStorage('checking').state).toBe('checking')
  })

  it('does not leak connection strings', () => {
    for (const reading of [{ durable: true }, { durable: false }, 'checking', 'unavailable'] as const) {
      expect(JSON.stringify(describeStorage(reading))).not.toMatch(/postgres(ql)?:\/\//i)
    }
  })
})

describe('settings sections', () => {
  it('lists the four sections in order', () => {
    expect([...SETTINGS_SECTIONS]).toEqual(['Connections', 'Automation Rules', 'Demo Data', 'Activity & History'])
  })
})

const rule: AutomationRule = {
  id: 'r1',
  source: 'demo',
  clientId: 'abc',
  name: 'Cafe meals',
  enabled: false,
  priority: 3,
  payeeContains: 'Corner Cafe',
  minAmountCents: 1050,
  transactionKind: 'Expense',
  category: 'Meals',
  memo: 'Client lunch',
  reviewPriority: 'High',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
}

describe('ruleFormFromRule', () => {
  it('loads the rule category and every field into the form', () => {
    expect(ruleFormFromRule(rule)).toEqual({
      name: 'Cafe meals',
      enabled: false,
      priority: 3,
      payeeContains: 'Corner Cafe',
      descriptionContains: '',
      minAmount: '10.50',
      maxAmount: '',
      transactionKind: 'Expense',
      category: 'Meals',
      memo: 'Client lunch',
      reviewPriority: 'High',
    })
  })
})

describe('ruleFormHasUnsavedWork', () => {
  const blank = ruleFormFromRule({ ...rule, name: '', payeeContains: '', minAmount: undefined, memo: '' } as AutomationRule & { minAmount?: undefined })
  it('is false for a blank, non-editing form', () => {
    expect(ruleFormHasUnsavedWork({ ...blank, minAmount: '' }, false)).toBe(false)
  })
  it('is true when text was typed or a rule is being edited', () => {
    expect(ruleFormHasUnsavedWork({ ...blank, name: 'New', minAmount: '' }, false)).toBe(true)
    expect(ruleFormHasUnsavedWork({ ...blank, minAmount: '' }, true)).toBe(true)
  })
})
