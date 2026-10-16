import type { AutomationRule, AutomationSource } from './automationRules'

export type AutomationEventKind =
  | 'rule-created'
  | 'rule-updated'
  | 'rule-deleted'
  | 'rule-enabled'
  | 'rule-disabled'
  | 'suggestion-generated'
  | 'suggestion-accepted'
  | 'suggestion-rejected'
  | 'recurring-confirmed'
  | 'recurring-dismissed'

export type AutomationAuditEvent = {
  id: string
  at: string
  source: AutomationSource
  clientId: string
  kind: AutomationEventKind
  summary: string
  detail?: string
  referenceId?: string
}

export type RecurringDecision = {
  reminderId: string
  clientId: string
  source: AutomationSource
  status: 'confirmed' | 'dismissed'
  at: string
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

const RULES_KEY = 'ledgerops-automation-rules-v1'
const AUDIT_KEY = 'ledgerops-automation-audit-v1'
const RECURRING_KEY = 'ledgerops-recurring-decisions-v1'

const parse = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function local(): StorageLike | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

export const parseRules = (value: string | null) => parse<AutomationRule[]>(value, [])
export const parseEvents = (value: string | null) => parse<AutomationAuditEvent[]>(value, [])
export const parseRecurringDecisions = (value: string | null) => parse<RecurringDecision[]>(value, [])

export function readRules(storage: StorageLike | null = local()) {
  return parseRules(storage?.getItem(RULES_KEY) ?? null)
}

export function writeRules(rules: AutomationRule[], storage: StorageLike | null = local()) {
  storage?.setItem(RULES_KEY, JSON.stringify(rules))
}

export function readEvents(storage: StorageLike | null = local()) {
  return parseEvents(storage?.getItem(AUDIT_KEY) ?? null)
}

export function writeEvents(events: AutomationAuditEvent[], storage: StorageLike | null = local()) {
  storage?.setItem(AUDIT_KEY, JSON.stringify(events))
}

export function readRecurringDecisions(storage: StorageLike | null = local()) {
  return parseRecurringDecisions(storage?.getItem(RECURRING_KEY) ?? null)
}

export function writeRecurringDecisions(decisions: RecurringDecision[], storage: StorageLike | null = local()) {
  storage?.setItem(RECURRING_KEY, JSON.stringify(decisions))
}

export function appendUniqueEvent(event: AutomationAuditEvent, storage: StorageLike | null = local()) {
  const current = readEvents(storage)
  if (event.referenceId && current.some((item) => item.kind === event.kind && item.referenceId === event.referenceId && item.clientId === event.clientId && item.source === event.source)) return current
  const next = [event, ...current].slice(0, 200)
  writeEvents(next, storage)
  return next
}
