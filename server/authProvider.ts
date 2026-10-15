export type LoginTransaction = { state: string; nonce: string; codeVerifier: string }

export type Identity = { subject: string; email: string; emailVerified: boolean; name?: string }

/** Identity-provider boundary; the production implementation is OIDC, tests inject a fake. */
export interface AuthProvider {
  beginLogin(): Promise<{ url: string; transaction: LoginTransaction }>
  /** Must reject if the callback's state, nonce, PKCE verifier, or ID token do not validate. */
  completeLogin(callbackUrl: URL, transaction: LoginTransaction): Promise<Identity>
}
