import { apiFetch } from './apiClient'
import type { DemoJournalEntryInput, DemoJournalRecord } from '../../shared/demoJournalEntries'

export class DemoJournalApiError extends Error {
  readonly code?: string
  readonly fields?: Record<string, string>
  constructor(message: string, extra: { code?: string; fields?: Record<string, string> } = {}) {
    super(message)
    this.name = 'DemoJournalApiError'
    Object.assign(this, extra)
  }
}

type Body = { error?: string; code?: string; record?: DemoJournalRecord; records?: DemoJournalRecord[]; reversal?: DemoJournalRecord; durable?: boolean; fields?: Record<string, string> }
async function call(path: string, init?: RequestInit): Promise<Body> {
  const response = await apiFetch(path, init)
  const body = (await response.json().catch(() => ({}))) as Body
  if (response.ok) return body
  throw new DemoJournalApiError(body.error || 'The journal entry could not be saved.', { code: body.code, fields: body.fields })
}
const post = (payload: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })

export const demoJournalService = {
  list: async (clientId: string) => (await call(`/api/demo-journals?clientId=${encodeURIComponent(clientId)}`)).records ?? [],
  create: async (clientId: string, input: DemoJournalEntryInput) => (await call('/api/demo-journals', post({ clientId, input }))).record!,
  edit: async (id: string, expectedVersion: number, input: DemoJournalEntryInput) => (await call(`/api/demo-journals/${encodeURIComponent(id)}/edit`, post({ expectedVersion, input }))).record!,
  post: async (id: string, expectedVersion: number) => (await call(`/api/demo-journals/${encodeURIComponent(id)}/post`, post({ expectedVersion }))).record!,
  reverse: async (id: string, expectedVersion: number, reason: string) => await call(`/api/demo-journals/${encodeURIComponent(id)}/reverse`, post({ expectedVersion, reason })),
}
