import { apiFetch } from './apiClient'
import { readLegacyReviewDecisionExport, type ReviewDecision, type ReviewSource } from './reviewFindings'

export type ReviewDecisionStatus = 'loading' | 'ready' | 'saving' | 'error'

type DecisionListResponse = { decisions?: ReviewDecision[]; durable?: boolean; error?: string }
type DecisionWriteResponse = { decision?: ReviewDecision; durable?: boolean; error?: string }

export type ReviewDecisionInput = Omit<ReviewDecision, 'id' | 'at' | 'actor' | 'actorId' | 'version' | 'source' | 'clientName'> & {
  expectedVersion: number
}

export class ReviewDecisionApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'ReviewDecisionApiError'
  }
}

async function responseBody<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new ReviewDecisionApiError(body.error || 'Review decisions could not be loaded or saved.', response.status)
  return body
}

const route = (source: ReviewSource) => `/api/review-decisions/${source}`

export const reviewDecisionService = {
  async list(source: ReviewSource): Promise<{ decisions: ReviewDecision[]; durable: boolean }> {
    const body = await responseBody<DecisionListResponse>(await apiFetch(route(source)))
    if (!Array.isArray(body.decisions) || typeof body.durable !== 'boolean') {
      throw new ReviewDecisionApiError('The server returned an invalid review decision list.')
    }
    return { decisions: body.decisions, durable: body.durable }
  },
  async append(source: ReviewSource, input: ReviewDecisionInput): Promise<{ decision: ReviewDecision; durable: boolean }> {
    const response = await apiFetch(route(source), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const body = await responseBody<DecisionWriteResponse>(response)
    if (!body.decision || typeof body.durable !== 'boolean') {
      throw new ReviewDecisionApiError('The server did not confirm saving this review decision.')
    }
    return { decision: body.decision, durable: body.durable }
  },
}

export async function downloadLegacyReviewDecisionExport() {
  const content = readLegacyReviewDecisionExport()
  if (!content) return false
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'ledgerops-legacy-review-decisions.json'
  link.click()
  URL.revokeObjectURL(url)
  return true
}
