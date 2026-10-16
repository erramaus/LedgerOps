import { apiFetch } from './apiClient'

export const demoResetService = {
  async reset(clientIds: string[]) {
    const response = await apiFetch('/api/demo-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientIds }),
    })
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    if (!response.ok) throw new Error(body.error || 'Demo data could not be reset. No changes were kept.')
  },
}
