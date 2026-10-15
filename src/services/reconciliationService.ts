import { apiFetch } from './apiClient'
import type { ReconciliationRecord, Source } from '../../shared/reconciliation'

export type Storage = { durable: boolean; description: string }
export type RecordSummary = Omit<ReconciliationRecord, 'transactions' | 'statementLines' | 'matches' | 'clearedIds'> & { clearedCount: number; transactionCount: number; lineCount: number; matchCount: number }

export class ReconciliationApiError extends Error {
  readonly code?: string
  readonly issues: { code: string; message: string }[]
  constructor(message: string, code?: string, issues: { code: string; message: string }[] = []) {
    super(message)
    this.name = 'ReconciliationApiError'
    this.code = code
    this.issues = issues
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T & { error?: string; code?: string; issues?: { code: string; message: string }[] } }> {
  const response = await apiFetch(path, init)
  const body = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string; issues?: { code: string; message: string }[] }
  return { status: response.status, body }
}

const encode = (id: string) => encodeURIComponent(id)
const json = (method: string, payload: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })

function ok<T extends object>(result: { status: number; body: T & { error?: string; code?: string; issues?: { code: string; message: string }[] } }, fallback: string) {
  if (result.status >= 200 && result.status < 300) return result.body
  throw new ReconciliationApiError(result.body.error || fallback, result.body.code, result.body.issues)
}

/** Saved reconciliation records. They belong to LedgerOps and are never written to QuickBooks. */
export const reconciliationService = {
  storage: async (): Promise<Storage> => ok(await call<Storage>('/api/reconciliations/storage'), 'Unable to check where records are stored.'),
  list: async (source: Source, clientId: string) => ok(await call<{ durable: boolean; records: RecordSummary[] }>(`/api/reconciliations?source=${source}&clientId=${encodeURIComponent(clientId)}`), 'Unable to load saved reconciliations.'),
  get: async (id: string): Promise<ReconciliationRecord | null> => {
    const result = await call<{ record: ReconciliationRecord }>(`/api/reconciliations/${encode(id)}`)
    if (result.status === 404) return null
    return ok(result, 'Unable to load the reconciliation.').record
  },
  save: async (id: string, record: Record<string, unknown>, expectedVersion: number) =>
    ok(await call<{ record: ReconciliationRecord }>(`/api/reconciliations/${encode(id)}`, json('PUT', { record, expectedVersion })), 'Unable to save the reconciliation.').record,
  complete: async (id: string, expectedVersion: number) =>
    ok(await call<{ record: ReconciliationRecord }>(`/api/reconciliations/${encode(id)}/complete`, json('POST', { expectedVersion })), 'Unable to complete the reconciliation.').record,
  reopen: async (id: string, expectedVersion: number, reason: string) =>
    ok(await call<{ record: ReconciliationRecord }>(`/api/reconciliations/${encode(id)}/reopen`, json('POST', { expectedVersion, reason })), 'Unable to reopen the reconciliation.').record,
}
