import { apiFetch, apiUrl, setCsrfToken } from './apiClient'

export type AuthUser = { sub: string; email: string; name?: string }

export type SessionInfo = {
  configured: boolean
  authenticated: boolean
  user?: AuthUser
}

export const authService = {
  getSession: async (): Promise<SessionInfo> => {
    const response = await apiFetch('/api/auth/session')
    if (!response.ok) throw new Error('Unable to check sign-in status.')
    const result = await response.json() as SessionInfo & { csrfToken?: string }
    setCsrfToken(result.csrfToken ?? null)
    return { configured: result.configured, authenticated: result.authenticated, user: result.user }
  },
  /** Full-page navigation: the identity provider redirects back to the app after sign-in. */
  signIn: () => {
    window.location.assign(apiUrl('/api/auth/login'))
  },
  signOut: async () => {
    const response = await apiFetch('/api/auth/logout', { method: 'POST' })
    setCsrfToken(null)
    if (!response.ok && response.status !== 401) throw new Error('Unable to sign out.')
  },
}
