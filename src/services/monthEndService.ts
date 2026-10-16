import { apiFetch } from './apiClient'
import type { MonthEndRecord, Source } from '../../shared/monthEnd'

export type MonthEndStorage = { durable: boolean; description: string }

export class MonthEndApiError extends Error {
  readonly code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'MonthEndApiError'
    this.code = code
  }
}

type Body<T> = T & { error?: string; code?: string }
async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: Body<T> }> {
  const response = await apiFetch(path, init)
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Body<T> }
}
const json = (payload: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
const encode = (id: string) => encodeURIComponent(id)

function ok<T extends object>(result: { status: number; body: Body<T> }, fallback: string) {
  if (result.status >= 200 && result.status < 300) return result.body
  throw new MonthEndApiError(result.body.error || fallback, result.body.code)
}

/** Month-end records belong to LedgerOps. Nothing here reads or writes a QuickBooks period or closing date. */
export const monthEndService = {
  storage: async (): Promise<MonthEndStorage> => ok(await call<MonthEndStorage>('/api/month-end/storage'), 'Unable to check where month-end records are stored.'),
  list: async (source: Source, clientId: string) => ok(await call<{ durable: boolean; records: MonthEndRecord[] }>(`/api/month-end?source=${source}&clientId=${encodeURIComponent(clientId)}`), 'Unable to load month-end records.').records,
  get: async (id: string): Promise<MonthEndRecord | null> => {
    const result = await call<{ record: MonthEndRecord }>(`/api/month-end/${encode(id)}`)
    if (result.status === 404) return null
    return ok(result, 'Unable to load the month-end record.').record
  },
  signOff: async (id: string, input: { step: string; note: string; fingerprint: string; figures: string; clientName: string; expectedVersion: number }) =>
    ok(await call<{ record: MonthEndRecord }>(`/api/month-end/${encode(id)}/signoff`, json(input)), 'Unable to record the review.').record,
  clearSignOff: async (id: string, step: string, expectedVersion: number) =>
    ok(await call<{ record: MonthEndRecord }>(`/api/month-end/${encode(id)}/clear-signoff`, json({ step, expectedVersion })), 'Unable to withdraw the review.').record,
  close: async (id: string, input: { expectedVersion: number; checklist: unknown; exceptions: string[] }) =>
    ok(await call<{ record: MonthEndRecord }>(`/api/month-end/${encode(id)}/close`, json(input)), 'Unable to close the month.').record,
  reopen: async (id: string, expectedVersion: number, reason: string) =>
    ok(await call<{ record: MonthEndRecord }>(`/api/month-end/${encode(id)}/reopen`, json({ expectedVersion, reason })), 'Unable to reopen the month.').record,
}
