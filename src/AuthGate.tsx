import { useCallback, useEffect, useState } from 'react'
import App from './App'
import { onUnauthorized } from './services/apiClient'
import { authService, type AuthUser } from './services/authService'

type GateState =
  | { status: 'loading' }
  | { status: 'unreachable' }
  | { status: 'signed-out'; configured: boolean; notice?: string }
  | { status: 'signed-in'; user: AuthUser; devBypass: boolean }

const errorMessages: Record<string, string> = {
  not_authorized: 'That account is not authorized to use LedgerOps. Ask your administrator for access.',
  invalid_request: 'The sign-in attempt expired or was invalid. Please try again.',
  sign_in_failed: 'Sign-in could not be completed. Please try again.',
}

function consumeSignInError() {
  const parameters = new URLSearchParams(window.location.search)
  const code = parameters.get('auth_error')
  if (!code) return undefined
  parameters.delete('auth_error')
  const query = parameters.toString()
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
  return errorMessages[code] ?? errorMessages.sign_in_failed
}

export default function AuthGate() {
  const [state, setState] = useState<GateState>({ status: 'loading' })

  const loadSession = useCallback(async (notice?: string) => {
    try {
      const session = await authService.getSession()
      setState(session.authenticated && session.user
        ? { status: 'signed-in', user: session.user, devBypass: session.devBypass === true }
        : { status: 'signed-out', configured: session.configured, notice })
    } catch {
      setState({ status: 'unreachable' })
    }
  }, [])

  useEffect(() => {
    void loadSession(consumeSignInError())
    return onUnauthorized(() => {
      // QuickBooks routes still need a real sign-in, so their 401s must not eject a bypass session.
      setState((current) => current.status === 'signed-in' && !current.devBypass
        ? { status: 'signed-out', configured: true, notice: 'Your session has ended. Please sign in again.' }
        : current)
    })
  }, [loadSession])

  const signOut = async () => {
    if (state.status === 'signed-in' && state.devBypass) return
    try {
      await authService.signOut()
    } finally {
      setState({ status: 'signed-out', configured: true })
    }
  }

  if (state.status === 'signed-in') return <App user={state.user} onSignOut={signOut} />

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand-mark login-brand"><span className="brand-dot" /> LedgerOps</div>
        <h1 id="login-title">Sign in</h1>
        <p className="muted">Secure access for bookkeeping teams.</p>
        {state.status === 'loading' && <p className="data-state-message" role="status">Checking your session...</p>}
        {state.status === 'unreachable' && (
          <>
            <p className="data-state-message error" role="alert">LedgerOps could not reach the server.</p>
            <button className="primary-button login-button" onClick={() => { setState({ status: 'loading' }); void loadSession() }}>Try again</button>
          </>
        )}
        {state.status === 'signed-out' && (
          <>
            {state.notice && <p className="data-state-message error" role="alert">{state.notice}</p>}
            {state.configured ? (
              <button className="primary-button login-button" onClick={authService.signIn}>Sign in securely <span>→</span></button>
            ) : (
              <p className="data-state-message error" role="alert">Sign-in is not configured on this server yet.</p>
            )}
          </>
        )}
      </section>
    </main>
  )
}
