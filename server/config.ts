import path from 'node:path'

export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000
export const LOGIN_TRANSACTION_TTL_MS = 10 * 60 * 1000
export const QUICKBOOKS_STATE_TTL_MS = 10 * 60 * 1000

export type AppConfig = {
  production: boolean
  /** Exact origin of the app, e.g. https://ledgerops.onrender.com. Used for CSRF Origin checks and redirects. */
  appOrigin: string
  corsOrigins: Set<string>
  allowedEmails: Set<string>
  sessionSecret?: string
  webRoot: string
}

export type OidcSettings = { issuerUrl: string; clientId: string; clientSecret: string; redirectUri: string }

export type LoadedConfig = {
  app: AppConfig
  oidc?: OidcSettings
  databaseUrl?: string
  /** Names of environment variables that prevent authentication from being enabled. */
  missing: string[]
}

function present(value: string | undefined) {
  return value !== undefined && value.trim() !== ''
}

export function loadConfig(env: NodeJS.ProcessEnv): LoadedConfig {
  const missing: string[] = []
  const frontendUrl = env.FRONTEND_URL?.trim() || 'http://localhost:5173'

  let appOrigin = 'http://localhost:5173'
  try {
    appOrigin = new URL(frontendUrl).origin
  } catch {
    missing.push('FRONTEND_URL (must be a valid URL)')
  }

  // https implies a deployed environment, so never fall back to development behaviour there.
  const production = env.NODE_ENV === 'production' || appOrigin.startsWith('https://')
  if (production && !appOrigin.startsWith('https://')) missing.push('FRONTEND_URL (must be https in production)')

  const sessionSecret = env.SESSION_SECRET?.trim()
  if (!sessionSecret || sessionSecret.length < 32) missing.push('SESSION_SECRET (at least 32 characters)')

  const oidcNames = ['OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET'] as const
  oidcNames.forEach((name) => {
    if (!present(env[name])) missing.push(name)
  })

  const allowedEmails = new Set(
    (env.AUTH_ALLOWED_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean),
  )
  if (allowedEmails.size === 0) missing.push('AUTH_ALLOWED_EMAILS')

  const databaseUrl = env.DATABASE_URL?.trim() || undefined
  if (production && !databaseUrl) missing.push('DATABASE_URL')

  const corsOrigins = new Set(['http://localhost:5173', 'https://erramaus.github.io', appOrigin])

  return {
    app: {
      production,
      appOrigin,
      corsOrigins,
      allowedEmails,
      sessionSecret,
      webRoot: path.resolve(process.cwd(), 'dist-render'),
    },
    oidc: oidcNames.every((name) => present(env[name]))
      ? {
          issuerUrl: env.OIDC_ISSUER_URL!.trim(),
          clientId: env.OIDC_CLIENT_ID!.trim(),
          clientSecret: env.OIDC_CLIENT_SECRET!.trim(),
          redirectUri: `${appOrigin}/api/auth/callback`,
        }
      : undefined,
    databaseUrl,
    missing,
  }
}
