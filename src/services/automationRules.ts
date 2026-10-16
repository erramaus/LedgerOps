import { DEMO_CLIENT_ID } from '../../shared/demoBooks'
import { getAdditionalDemoCompany } from '../../shared/demoCompanyBooks'
import type { LedgerTransaction, Transaction } from './bookkeepingTypes'
import type { TaskPriority } from './workQueue'
import { getLines, isUncategorized, toCents } from './transactionReview'

export type AutomationSource = 'demo' | 'quickbooks'
export type AutomationTransactionKind = 'Any' | 'Expense' | 'Deposit'

export type AutomationRule = {
  id: string
  source: AutomationSource
  clientId: string
  name: string
  enabled: boolean
  priority: number
  payeeContains?: string
  descriptionContains?: string
  minAmountCents?: number
  maxAmountCents?: number
  transactionKind: AutomationTransactionKind
  category: string
  memo?: string
  reviewPriority: TaskPriority
  createdAt: string
  updatedAt: string
}

export type RuleMatch = {
  rule: AutomationRule
  reasons: string[]
}

export type RulePreview = RuleMatch & {
  transactionId: string
  payee: string
  amount: string
  date: string
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const includesNormalized = (needle: string, haystack: string) => normalize(haystack).includes(normalize(needle))
const formatDollars = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
const lineText = (transaction: Transaction) => getLines(transaction).map((line) => line.description || '').join(' ')
const parseAmount = (value: string) => Math.round(Number(value.replace(/[$,]/g, '')) * 100)

export function automationTransactionKind(transaction: Transaction) {
  const typed = (transaction as LedgerTransaction).transactionType?.toLowerCase()
  if (typed?.includes('deposit') || typed?.includes('payment')) return 'Deposit' as const
  return 'Expense' as const
}

export function validateRuleInput(rule: Partial<AutomationRule>) {
  const errors: Partial<Record<'name' | 'criteria' | 'amount' | 'category' | 'priority', string>> = {}
  if (!rule.name?.trim()) errors.name = 'Name this rule.'
  const hasCriteria = Boolean(rule.payeeContains?.trim() || rule.descriptionContains?.trim() || rule.minAmountCents !== undefined || rule.maxAmountCents !== undefined || (rule.transactionKind && rule.transactionKind !== 'Any'))
  if (!hasCriteria) errors.criteria = 'Add at least one matching condition.'
  if (rule.minAmountCents !== undefined && (!Number.isInteger(rule.minAmountCents) || rule.minAmountCents < 0)) errors.amount = 'Minimum amount must be zero or more.'
  if (rule.maxAmountCents !== undefined && (!Number.isInteger(rule.maxAmountCents) || rule.maxAmountCents < 0)) errors.amount = 'Maximum amount must be zero or more.'
  if (rule.minAmountCents !== undefined && rule.maxAmountCents !== undefined && rule.minAmountCents > rule.maxAmountCents) errors.amount = 'Minimum amount cannot be greater than maximum amount.'
  if (!rule.category?.trim()) errors.category = 'Choose a category.'
  if (!Number.isInteger(rule.priority) || (rule.priority ?? 0) < 1) errors.priority = 'Priority must be 1 or greater.'
  return errors
}

function specificity(rule: AutomationRule) {
  return Number(Boolean(rule.payeeContains)) + Number(Boolean(rule.descriptionContains)) + Number(rule.minAmountCents !== undefined || rule.maxAmountCents !== undefined) + Number(rule.transactionKind !== 'Any')
}

export function matchRule(rule: AutomationRule, transaction: Transaction): RuleMatch | null {
  if (!rule.enabled) return null
  if (rule.clientId !== (transaction.clientId ?? rule.clientId)) return null
  const reasons: string[] = []
  if (rule.transactionKind !== 'Any') {
    const kind = automationTransactionKind(transaction)
    if (kind !== rule.transactionKind) return null
    reasons.push(`Transaction kind is ${kind.toLowerCase()}.`)
  }
  if (rule.payeeContains?.trim()) {
    if (!includesNormalized(rule.payeeContains, transaction.payee || '')) return null
    reasons.push(`Payee matches "${rule.payeeContains.trim()}".`)
  }
  if (rule.descriptionContains?.trim()) {
    const haystack = `${transaction.description} ${lineText(transaction)}`
    if (!includesNormalized(rule.descriptionContains, haystack)) return null
    reasons.push(`Description or memo matches "${rule.descriptionContains.trim()}".`)
  }
  const amount = parseAmount(transaction.amount)
  if (rule.minAmountCents !== undefined) {
    if (amount < rule.minAmountCents) return null
    reasons.push(`Amount is at least ${formatDollars(rule.minAmountCents)}.`)
  }
  if (rule.maxAmountCents !== undefined) {
    if (amount > rule.maxAmountCents) return null
    reasons.push(`Amount is no more than ${formatDollars(rule.maxAmountCents)}.`)
  }
  reasons.push(`Rule priority ${rule.priority}.`)
  return { rule, reasons }
}

export function matchRules(rules: AutomationRule[], transaction: Transaction) {
  return rules
    .flatMap((rule) => {
      const match = matchRule(rule, transaction)
      return match ? [match] : []
    })
    .sort((left, right) => left.rule.priority - right.rule.priority || specificity(right.rule) - specificity(left.rule) || right.rule.updatedAt.localeCompare(left.rule.updatedAt))
}

export function bestRuleMatch(rules: AutomationRule[], transaction: Transaction) {
  return matchRules(rules, transaction)[0] ?? null
}

export function previewRule(rule: AutomationRule, transactions: Transaction[]): RulePreview[] {
  return transactions.flatMap((transaction) => {
    const match = matchRule(rule, transaction)
    return match ? [{ ...match, transactionId: transaction.id, payee: transaction.payee, amount: transaction.amount, date: transaction.date }] : []
  })
}

export function buildRuleSuggestionMap(rules: AutomationRule[], transactions: Transaction[]) {
  const suggestions = new Map<string, RuleMatch>()
  for (const transaction of transactions) {
    if (!getLines(transaction).some((line) => isUncategorized(line.category))) continue
    const match = bestRuleMatch(rules, transaction)
    if (match) suggestions.set(transaction.id, match)
  }
  return suggestions
}

function rule(id: string, clientId: string, name: string, category: string, reviewPriority: TaskPriority, extra: Partial<AutomationRule>): AutomationRule {
  return {
    id,
    source: 'demo',
    clientId,
    name,
    enabled: true,
    priority: 10,
    transactionKind: 'Expense',
    category,
    reviewPriority,
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
    ...extra,
  }
}

function companyCategory(clientId: string, accountId: string, fallback: string) {
  if (clientId === DEMO_CLIENT_ID) return fallback
  return getAdditionalDemoCompany(clientId)?.ledger.accounts.find((account) => account.id === accountId)?.name ?? fallback
}

export function seededRulesFor(source: AutomationSource, clientId: string): AutomationRule[] {
  if (source !== 'demo') return []
  if (clientId === DEMO_CLIENT_ID) {
    return [
      rule('seed-home-depot', clientId, 'Home Depot materials', 'Materials', 'High', { priority: 1, payeeContains: 'Home Depot', descriptionContains: 'pipe' }),
      rule('seed-amazon', clientId, 'Amazon office supplies', 'Office Supplies', 'Medium', { priority: 2, payeeContains: 'Amazon', descriptionContains: 'office' }),
      rule('seed-adobe', clientId, 'Adobe subscription', 'Software', 'Low', { priority: 3, payeeContains: 'Adobe', minAmountCents: 5_500, maxAmountCents: 6_500, memo: 'Creative Cloud subscription' }),
    ]
  }
  return [
    rule(`seed-${clientId}-supplies`, clientId, 'Recurring supplies vendor', companyCategory(clientId, 'supplies', 'Supplies'), 'Medium', { priority: 2, descriptionContains: 'supply' }),
    rule(`seed-${clientId}-utilities`, clientId, 'Utilities and internet', companyCategory(clientId, 'utilities', 'Utilities'), 'Low', { priority: 3, descriptionContains: 'utility', minAmountCents: 2_000 }),
    rule(`seed-${clientId}-software`, clientId, 'Software subscription', companyCategory(clientId, 'software', 'Software and Subscriptions'), 'Low', { priority: 4, descriptionContains: 'software', minAmountCents: 2_000 }),
  ]
}
