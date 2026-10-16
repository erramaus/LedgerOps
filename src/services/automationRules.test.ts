import { describe, expect, it } from 'vitest'
import type { LedgerTransaction } from './bookkeepingTypes'
import { bestRuleMatch, matchRules, previewRule, seededRulesFor, validateRuleInput, type AutomationRule } from './automationRules'

const transaction = (overrides: Partial<LedgerTransaction> = {}): LedgerTransaction => ({
  id: 'txn-1',
  clientId: 'abc-plumbing',
  date: 'Aug 29, 2026',
  payee: 'Amazon',
  description: 'Office supplies and shipping materials',
  amount: '$47.82',
  category: 'Uncategorized',
  status: 'Needs Review',
  source: 'demo',
  ...overrides,
})

const rule = (overrides: Partial<AutomationRule> = {}): AutomationRule => ({
  id: 'rule-1',
  source: 'demo',
  clientId: 'abc-plumbing',
  name: 'Amazon supplies',
  enabled: true,
  priority: 2,
  payeeContains: 'amazon',
  descriptionContains: 'office',
  transactionKind: 'Expense',
  category: 'Office Supplies',
  reviewPriority: 'High',
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
  ...overrides,
})

describe('smart categorization rules', () => {
  it('matches vendor, description, amount range, type, and client together', () => {
    const match = bestRuleMatch([rule({ minAmountCents: 4_000, maxAmountCents: 5_000 })], transaction())
    expect(match?.rule.category).toBe('Office Supplies')
    expect(match?.reasons.join(' ')).toMatch(/Payee matches|Description or memo matches|Amount is at least|Amount is no more than|Transaction kind/)
  })

  it('keeps rules isolated to their own client', () => {
    expect(bestRuleMatch([rule()], transaction({ clientId: 'other-client' }))).toBeNull()
  })

  it('resolves conflicting rules by priority, then specificity', () => {
    const broad = rule({ id: 'broad', priority: 2, payeeContains: 'amazon', descriptionContains: undefined, category: 'Other Expense' })
    const specific = rule({ id: 'specific', priority: 1, payeeContains: 'amazon', descriptionContains: 'office', category: 'Office Supplies' })
    expect(bestRuleMatch([broad, specific], transaction())?.rule.id).toBe('specific')
    expect(matchRules([broad, specific], transaction()).map((match) => match.rule.id)).toEqual(['specific', 'broad'])
  })

  it('previews exactly the transactions a rule would match', () => {
    const matches = previewRule(rule(), [transaction(), transaction({ id: 'txn-2', payee: 'Shell', description: 'Fuel', amount: '$82.41' })])
    expect(matches.map((match) => match.transactionId)).toEqual(['txn-1'])
  })

  it('validates rule definitions', () => {
    expect(validateRuleInput({ name: '', priority: 0, transactionKind: 'Any', category: '' })).toMatchObject({
      name: 'Name this rule.',
      criteria: 'Add at least one matching condition.',
      category: 'Choose a category.',
      priority: 'Priority must be 1 or greater.',
    })
  })

  it('seeds demo examples but keeps QuickBooks separate', () => {
    expect(seededRulesFor('demo', 'abc-plumbing').length).toBeGreaterThan(0)
    expect(seededRulesFor('quickbooks', 'quickbooks-sandbox')).toEqual([])
  })
})
