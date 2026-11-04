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
  /** Local-development-only authentication bypass for demo routes; see devBypassRefusal. Never true in production. */
  devBypassAuth?: boolean
}

export type OidcSettings = { issuerUrl: string; clientId: string; clientSecret: string; redirectUri: string }

export type LoadedConfig = {
  app: AppConfig
  oidc?: OidcSettings
  databaseUrl?: string
  /** Names of environment variables that prevent authentication from being enabled. */
  missing: string[]
  /** Set when LEDGEROPS_DEV_BYPASS_AUTH was requested but refused. */
  devBypassRefusal?: string
}

const DEPLOYMENT_MARKERS = ['RENDER', 'RENDER_SERVICE_ID', 'RENDER_EXTERNAL_URL', 'GITHUB_ACTIONS', 'GITHUB_PAGES', 'CI']

/**
 * The bypass needs an explicit opt-in AND positive proof of local development; anything ambiguous refuses it.
 * Returns a refusal reason, or undefined when the bypass is allowed.
 */
export function devBypassRefusal(env: NodeJS.ProcessEnv, appOrigin: string, production: boolean): string | undefined {
  if (env.LEDGEROPS_DEV_BYPASS_AUTH !== 'true') return 'LEDGEROPS_DEV_BYPASS_AUTH must be exactly "true"'
  if (production) return 'the server is in production mode'
  if (env.NODE_ENV !== 'development') return 'NODE_ENV must be exactly "development"'
  const marker = DEPLOYMENT_MARKERS.find((name) => present(env[name]))
  if (marker) return `a deployment environment was detected (${marker})`
  let url: URL
  try {
    url = new URL(appOrigin)
  } catch {
    return 'FRONTEND_URL is not a valid URL'
  }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) return 'FRONTEND_URL must be http://localhost or http://127.0.0.1'
  return undefined
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

  const requested = present(env.LEDGEROPS_DEV_BYPASS_AUTH)
  const refusal = requested ? devBypassRefusal(env, frontendUrl, production) : undefined
  const corsOrigins = new Set(['http://localhost:5173', 'https://erramaus.github.io', appOrigin])

  return {
    app: {
      production,
      appOrigin,
      corsOrigins,
      allowedEmails,
      sessionSecret,
      webRoot: path.resolve(process.cwd(), 'dist-render'),
            devBypassAuth: requested && refusal === undefined,
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
    devBypassRefusal: refusal,
  }
}
