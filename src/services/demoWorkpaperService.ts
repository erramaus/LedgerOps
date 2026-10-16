import { apiFetch } from './apiClient'
import type { DemoWorkpaperInput, DemoWorkpaperRecord } from '../../shared/demoWorkpapers'

export class DemoWorkpaperApiError extends Error {
  readonly code?: string
  readonly fields?: Record<string, string>
  constructor(message: string, extra: { code?: string; fields?: Record<string, string> } = {}) {
    super(message)
    this.name = 'DemoWorkpaperApiError'
    Object.assign(this, extra)
  }
}

type Body = { error?: string; code?: string; record?: DemoWorkpaperRecord; records?: DemoWorkpaperRecord[]; durable?: boolean; fields?: Record<string, string> }
async function call(path: string, init?: RequestInit): Promise<Body> {
  const response = await apiFetch(path, init)
  const body = (await response.json().catch(() => ({}))) as Body
  if (response.ok) return body
  throw new DemoWorkpaperApiError(body.error || 'The workpaper could not be saved.', { code: body.code, fields: body.fields })
}
const post = (payload: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })

export const demoWorkpaperService = {
  list: async (clientId: string) => (await call(`/api/demo-workpapers?clientId=${encodeURIComponent(clientId)}`)).records ?? [],
  create: async (clientId: string, input: DemoWorkpaperInput) => (await call('/api/demo-workpapers', post({ clientId, input }))).record!,
  update: async (id: string, expectedVersion: number, input: DemoWorkpaperInput) => (await call(`/api/demo-workpapers/${encodeURIComponent(id)}/update`, post({ expectedVersion, input }))).record!,
}
