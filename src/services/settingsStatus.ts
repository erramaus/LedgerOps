import type { AutomationRule } from './automationRules'

export type ConnectionState = 'checking' | 'connected' | 'not-connected' | 'auth-required' | 'backend-unavailable' | 'error'

export type ConnectionReading =
  | { kind: 'network' }
  | { kind: 'response'; status: number; json?: { connected?: boolean; error?: string } | null }

export type ConnectionSummary = {
  state: ConnectionState
  label: string
  detail: string
}

const labels: Record<ConnectionState, string> = {
  checking: 'Checking…',
  connected: 'Connected',
  'not-connected': 'Not connected',
  'auth-required': 'Authentication required',
  'backend-unavailable': 'Backend unavailable',
  error: 'Connection error',
}

/** Works out the real QuickBooks connection condition from what the server actually answered; it never guesses. */
export function classifyConnection(reading: ConnectionReading, devBypass: boolean): ConnectionSummary {
  const make = (state: ConnectionState, detail: string): ConnectionSummary => ({ state, label: labels[state], detail })
  if (reading.kind === 'network') return make('backend-unavailable', 'LedgerOps could not reach its server. Start the backend (npm run dev:all) and try again.')
  const { status, json } = reading
  if (status === 401) {
    return make('auth-required', devBypass
      ? 'Local development bypass is active for demo data only. QuickBooks always requires real sign-in, so it stays unavailable until you sign in normally.'
      : 'Sign in to LedgerOps to check or connect QuickBooks.')
  }
  if (status >= 200 && status < 300) {
    if (json && typeof json.connected === 'boolean') {
      return json.connected
        ? make('connected', 'Connected to a QuickBooks Online Sandbox company. Production QuickBooks is not enabled.')
        : make('not-connected', 'LedgerOps is not connected to QuickBooks. Connect a Sandbox company to use QuickBooks data.')
    }
    return make('error', 'The server sent a QuickBooks status LedgerOps could not read.')
  }
  // A proxy or gateway failure carries no LedgerOps error message, which means the backend itself did not answer.
  if (status === 502 || status === 503 || status === 504 || (status >= 500 && !json?.error)) {
    return make('backend-unavailable', 'LedgerOps could not reach its server. Start the backend (npm run dev:all) and try again.')
  }
  return make('error', json?.error ? `QuickBooks status failed: ${json.error}` : `QuickBooks status failed (HTTP ${status}).`)
}

export type StorageState = 'checking' | 'durable' | 'temporary' | 'unavailable'
export type StorageSummary = { state: StorageState; label: string; detail: string }

/** Explains where saved demo records live, from the backend's own report. The browser never sees connection strings. */
export function describeStorage(reading: { durable: boolean } | 'checking' | 'unavailable'): StorageSummary {
  if (reading === 'checking') return { state: 'checking', label: 'Checking…', detail: 'Asking the server where records are saved.' }
  if (reading === 'unavailable') return { state: 'unavailable', label: 'Unknown', detail: 'The server did not report its storage, so LedgerOps cannot say whether records are saved. Treat them as temporary.' }
  return reading.durable
    ? { state: 'durable', label: 'Database-backed', detail: 'Reconciliations, month-end records, journals, payments and workpapers are saved in the LedgerOps database and survive a restart.' }
    : { state: 'temporary', label: 'Temporary', detail: 'Server records are kept in memory only and are lost when the server restarts. Durable database setup is described in docs/AUTHENTICATION.md.' }
}

export const SETTINGS_SECTIONS = ['Connections', 'Automation Rules', 'Demo Data', 'Activity & History'] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export type RuleForm = {
  name: string
  enabled: boolean
  priority: number
  payeeContains: string
  descriptionContains: string
  minAmount: string
  maxAmount: string
  transactionKind: 'Any' | 'Expense' | 'Deposit'
  category: string
  memo: string
  reviewPriority: AutomationRule['reviewPriority']
}

export function ruleFormFromRule(rule: AutomationRule): RuleForm {
  return {
    name: rule.name,
    enabled: rule.enabled,
    priority: rule.priority,
    payeeContains: rule.payeeContains ?? '',
    descriptionContains: rule.descriptionContains ?? '',
    minAmount: rule.minAmountCents !== undefined ? (rule.minAmountCents / 100).toFixed(2) : '',
    maxAmount: rule.maxAmountCents !== undefined ? (rule.maxAmountCents / 100).toFixed(2) : '',
    transactionKind: rule.transactionKind,
    category: rule.category,
    memo: rule.memo ?? '',
    reviewPriority: rule.reviewPriority,
  }
}

/** True when the rule editor holds typed text or an edit in progress that switching sections must not lose. */
export const ruleFormHasUnsavedWork = (form: RuleForm, editing: boolean) =>
  editing || [form.name, form.payeeContains, form.descriptionContains, form.minAmount, form.maxAmount, form.memo].some((value) => value.trim() !== '')
