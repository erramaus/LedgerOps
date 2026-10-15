const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export const apiUrl = (path: string) => `${apiBaseUrl}${path}`

let csrfToken: string | null = null
export const setCsrfToken = (token: string | null) => {
  csrfToken = token
}

const unauthorizedListeners = new Set<() => void>()
export const onUnauthorized = (listener: () => void) => {
  unauthorizedListeners.add(listener)
  return () => {
    unauthorizedListeners.delete(listener)
  }
}

/** Same-origin fetch that attaches the CSRF token to state-changing requests and reports expired sessions. */
export async function apiFetch(path: string, init: RequestInit = {}) {
  const method = (init.method || 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (method !== 'GET' && method !== 'HEAD' && csrfToken) headers.set('X-CSRF-Token', csrfToken)
  const response = await fetch(apiUrl(path), { ...init, headers })
  if (response.status === 401) unauthorizedListeners.forEach((listener) => listener())
  return response
}
