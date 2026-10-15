import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import cors from 'cors'
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express'
import session from 'express-session'
import type { AuthProvider, LoginTransaction } from './authProvider.js'
import {
  LOGIN_TRANSACTION_TTL_MS,
  QUICKBOOKS_STATE_TTL_MS,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  type AppConfig,
} from './config.js'
import type * as quickbooksModule from './quickbooks.js'
import { TransactionUpdateError } from './transactionLines.js'
import { createReconciliationRouter } from './reconciliations.js'
import { MemoryReconciliationStore, type ReconciliationStore } from './reconciliationStore.js'

export type QuickBooksGateway = typeof quickbooksModule

declare module 'express-session' {
  interface SessionData {
    user?: { sub: string; email: string; name?: string }
    authenticatedAt?: number
    csrfToken?: string
    loginTransaction?: LoginTransaction & { createdAt: number }
    quickBooksOAuth?: { state: string; createdAt: number }
  }
}

export type AppDependencies = {
  config: AppConfig
  quickbooks: QuickBooksGateway
  /** Authentication is enabled only when both are supplied; otherwise every protected route fails closed. */
  authProvider?: AuthProvider
  sessionStore?: session.Store
  reconciliationStore?: ReconciliationStore
  now?: () => number
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function safeEqual(left: unknown, right: unknown) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const digest = (value: string) => crypto.createHash('sha256').update(value).digest()
  return crypto.timingSafeEqual(digest(left), digest(right))
}

const saveSession = (request: Request) =>
  new Promise<void>((resolve, reject) => request.session.save((error) => (error ? reject(error) : resolve())))

const regenerateSession = (request: Request) =>
  new Promise<void>((resolve, reject) => request.session.regenerate((error) => (error ? reject(error) : resolve())))

const destroySession = (request: Request) =>
  new Promise<void>((resolve, reject) => request.session.destroy((error) => (error ? reject(error) : resolve())))

export function createApp(dependencies: AppDependencies) {
  const { config, quickbooks, authProvider, sessionStore } = dependencies
  const now = dependencies.now ?? Date.now
  const authReady = Boolean(authProvider && sessionStore && config.sessionSecret)
  const cookieName = config.production ? '__Host-ledgerops.sid' : 'ledgerops.sid'
  const cookieOptions = { httpOnly: true, secure: config.production, sameSite: 'lax' as const, path: '/' }
  const app = express()

  app.disable('x-powered-by')
  // Render terminates TLS one hop in front of the app; required for Secure cookies.
  if (config.production) app.set('trust proxy', 1)

  app.use(cors({ origin: (origin, callback) => callback(null, !origin || config.corsOrigins.has(origin)) }))
  app.use(express.json())
  app.use('/api', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    next()
  })

  if (authReady) {
    app.use(
      session({
        name: cookieName,
        secret: config.sessionSecret!,
        store: sessionStore,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: { ...cookieOptions, maxAge: SESSION_IDLE_MS },
      }),
    )
  }

  const requireAuth: RequestHandler = (request, response, next) => {
    const current = request.session
    const valid = Boolean(current?.user && current.authenticatedAt && now() - current.authenticatedAt < SESSION_ABSOLUTE_MS)
    if (valid) return next()
    const finish = () => response.status(401).json({ error: 'Authentication required.' })
    if (current?.user) destroySession(request).then(finish, finish)
    else finish()
  }

  const requireCsrf: RequestHandler = (request, response, next) => {
    if (SAFE_METHODS.has(request.method)) return next()
    const origin = request.get('origin')
    if ((origin && origin !== config.appOrigin) || !safeEqual(request.get('x-csrf-token'), request.session?.csrfToken)) {
      return response.status(403).json({ error: 'Invalid CSRF token.' })
    }
    next()
  }

  const redirectWithError = (response: Response, parameter: string, value: string) =>
    response.redirect(`${config.appOrigin}/?${parameter}=${value}`)

  // --- Public routes ---------------------------------------------------------------------------

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', service: 'LedgerOps API' })
  })

  app.get('/api/auth/session', (request, response) => {
    if (!authReady) return response.json({ configured: false, authenticated: false })
    const current = request.session
    const valid = Boolean(current.user && current.authenticatedAt && now() - current.authenticatedAt < SESSION_ABSOLUTE_MS)
    if (!valid) return response.json({ configured: true, authenticated: false })
    response.json({ configured: true, authenticated: true, user: current.user, csrfToken: current.csrfToken })
  })

  app.get('/api/auth/login', async (request, response) => {
    if (!authReady) return response.status(503).json({ error: 'Sign-in is not configured.' })
    try {
      const { url, transaction } = await authProvider!.beginLogin()
      request.session.loginTransaction = { ...transaction, createdAt: now() }
      await saveSession(request)
      response.redirect(url)
    } catch (error) {
      console.error('[auth] unable to start login:', error instanceof Error ? error.message : error)
      response.status(502).json({ error: 'Unable to reach the identity provider.' })
    }
  })

  app.get('/api/auth/callback', async (request, response) => {
    if (!authReady) return response.status(503).json({ error: 'Sign-in is not configured.' })
    // Consume the transaction first so a replayed callback can never succeed.
    const transaction = request.session.loginTransaction
    delete request.session.loginTransaction
    try {
      await saveSession(request)
    } catch {
      return redirectWithError(response, 'auth_error', 'invalid_request')
    }

    const { state, code } = request.query
    if (
      !transaction ||
      now() - transaction.createdAt > LOGIN_TRANSACTION_TTL_MS ||
      typeof code !== 'string' ||
      !safeEqual(state, transaction.state)
    ) {
      return redirectWithError(response, 'auth_error', 'invalid_request')
    }

    try {
      const identity = await authProvider!.completeLogin(new URL(request.originalUrl, config.appOrigin), transaction)
      const email = identity.email.trim().toLowerCase()
      if (!identity.emailVerified || !config.allowedEmails.has(email)) {
        console.warn('[auth] sign-in denied for an account that is not authorized.')
        return redirectWithError(response, 'auth_error', 'not_authorized')
      }
      // A fresh session id on privilege change prevents session fixation.
      await regenerateSession(request)
      request.session.user = { sub: identity.subject, email, name: identity.name }
      request.session.authenticatedAt = now()
      request.session.csrfToken = crypto.randomBytes(32).toString('hex')
      await saveSession(request)
      response.redirect(`${config.appOrigin}/`)
    } catch (error) {
      console.error('[auth] sign-in failed:', error instanceof Error ? error.message : error)
      redirectWithError(response, 'auth_error', 'sign_in_failed')
    }
  })

  app.post('/api/auth/logout', requireAuth, requireCsrf, async (request, response) => {
    try {
      await destroySession(request)
    } catch {
      return response.status(500).json({ error: 'Unable to sign out.' })
    }
    response.clearCookie(cookieName, cookieOptions)
    response.status(204).end()
  })

  // --- QuickBooks routes: every route registered below is behind authentication and CSRF -------

  const router = express.Router()
  app.use('/api/quickbooks', requireAuth, requireCsrf, router)
  app.use('/api/reconciliations', requireAuth, requireCsrf, createReconciliationRouter({ store: dependencies.reconciliationStore ?? new MemoryReconciliationStore(), quickbooks, now }))

  const fail = (response: Response, error: unknown, fallback: string) =>
    response.status(400).json({ error: error instanceof Error ? error.message : fallback })

  router.post('/connect', async (request, response) => {
    try {
      const state = crypto.randomBytes(32).toString('hex')
      // Generate the URL first so a configuration error does not leave an unused pending state.
      const authorizationUrl = quickbooks.createAuthorizationUrl(state)
      request.session.quickBooksOAuth = { state, createdAt: now() }
      await saveSession(request)
      console.info('[QuickBooks OAuth URL diagnostics]', {
        ...quickbooks.getAuthorizationUrlDiagnostics(authorizationUrl),
        ...quickbooks.getConfigurationDiagnostics(),
      })
      response.json({ authorizationUrl })
    } catch (error) {
      console.error('[QuickBooks OAuth URL diagnostics]', quickbooks.getConfigurationDiagnostics())
      response.status(500).json({
        error: error instanceof Error ? error.message : 'Unable to start QuickBooks connection.',
        diagnostics: quickbooks.getConfigurationDiagnostics(),
      })
    }
  })

  router.get('/callback', async (request, response) => {
    // Consume the pending state before anything else so a replayed callback can never succeed.
    const pending = request.session.quickBooksOAuth
    delete request.session.quickBooksOAuth
    try {
      await saveSession(request)
    } catch {
      return redirectWithError(response, 'quickbooks', 'error')
    }

    const { code, state, realmId, error } = request.query
    if (
      error ||
      !pending ||
      now() - pending.createdAt > QUICKBOOKS_STATE_TTL_MS ||
      typeof code !== 'string' ||
      typeof realmId !== 'string' ||
      !safeEqual(state, pending.state)
    ) {
      return redirectWithError(response, 'quickbooks', 'error')
    }

    try {
      await quickbooks.exchangeCode(code, realmId)
      redirectWithError(response, 'quickbooks', 'connected')
    } catch (exchangeError) {
      console.error('[QuickBooks OAuth] token exchange failed:', exchangeError instanceof Error ? exchangeError.message : exchangeError)
      redirectWithError(response, 'quickbooks', 'error')
    }
  })

  router.get('/status', (_request, response) => {
    response.json(quickbooks.getConnectionStatus())
  })

  router.get('/company', async (_request, response) => {
    try {
      response.json(await quickbooks.getCompanyInfo())
    } catch (error) {
      fail(response, error, 'Unable to load company information.')
    }
  })

  router.get('/transactions', async (_request, response) => {
    try {
      response.json({ transactions: await quickbooks.getTransactions() })
    } catch (error) {
      fail(response, error, 'Unable to load QuickBooks transactions.')
    }
  })

  router.post('/transactions/:transactionType/:transactionId/lines', async (request, response) => {
    const { syncToken, expectedTotal, changes } = request.body ?? {}
    const validChanges =
      Array.isArray(changes) &&
      changes.length > 0 &&
      changes.length <= 50 &&
      changes.every((change: unknown) => {
        const { lineId, accountId } = (change ?? {}) as Record<string, unknown>
        return typeof lineId === 'string' && /^[\w-]{1,40}$/.test(lineId) && typeof accountId === 'string' && /^\d{1,20}$/.test(accountId)
      })
    if (typeof syncToken !== 'string' || !syncToken || typeof expectedTotal !== 'number' || !Number.isFinite(expectedTotal) || !validChanges) {
      return response.status(400).json({ error: 'A SyncToken, the expected total and at least one line change are required.', code: 'INVALID' })
    }
    try {
      const transaction = await quickbooks.updateTransactionLines({
        transactionType: String(request.params.transactionType),
        transactionId: String(request.params.transactionId),
        syncToken,
        expectedTotal,
        changes: changes.map((change: { lineId: string; accountId: string }) => ({ lineId: change.lineId, accountId: change.accountId })),
      })
      response.json({ transaction })
    } catch (error) {
      if (error instanceof TransactionUpdateError) return response.status(error.status).json({ error: error.message, code: error.code })
      console.error('[QuickBooks] line update failed:', error instanceof Error ? error.message : error)
      response.status(500).json({ error: 'Unable to update the QuickBooks transaction. Nothing was confirmed; reload it to check.', code: 'UNEXPECTED' })
    }
  })

  // Read-only: the register of one account through a date, with a completeness verdict.
  router.get('/reconciliation/:accountId', async (request, response) => {
    const through = typeof request.query.through === 'string' ? request.query.through : ''
    try {
      response.json(await quickbooks.getReconciliationData(String(request.params.accountId), through))
    } catch (error) {
      fail(response, error, 'Unable to read QuickBooks transactions for reconciliation.')
    }
  })

  router.get('/accounts', async (_request, response) => {
    try {
      response.json({ accounts: await quickbooks.getAccounts() })
    } catch (error) {
      fail(response, error, 'Unable to load QuickBooks accounts.')
    }
  })

  router.get('/customers', async (_request, response) => {
    try {
      response.json({ customers: await quickbooks.getCustomers() })
    } catch (error) {
      fail(response, error, 'Unable to load QuickBooks customers.')
    }
  })

  router.get('/vendors', async (_request, response) => {
    try {
      response.json({ vendors: await quickbooks.getVendors() })
    } catch (error) {
      fail(response, error, 'Unable to load QuickBooks vendors.')
    }
  })

  router.get('/invoices', async (_request, response) => {
    try {
      response.json({ invoices: await quickbooks.getInvoices() })
    } catch (error) {
      fail(response, error, 'Unable to load QuickBooks invoices.')
    }
  })

  router.get('/bills', async (_request, response) => {
    try {
      response.json({ bills: await quickbooks.getBills() })
    } catch (error) {
      fail(response, error, 'Unable to load QuickBooks bills.')
    }
  })

  router.get('/reports/:report', async (request, response) => {
    const report = request.params.report
    if (report !== 'profit-loss' && report !== 'balance-sheet' && report !== 'cash-flow') return response.status(404).json({ error: 'Unsupported QuickBooks report.' })
    const period = typeof request.query.period === 'string' ? request.query.period : 'This Month'
    try {
      response.json(await quickbooks.getFinancialReport(report, period))
    } catch (error) {
      fail(response, error, 'Unable to load QuickBooks report.')
    }
  })

  // --- Unknown API paths, then the single-page app -----------------------------------------------

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'Not found.' })
  })

  if (fs.existsSync(path.join(config.webRoot, 'index.html'))) {
    app.use(
      express.static(config.webRoot, {
        index: false,
        setHeaders: (response, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        },
      }),
    )
    // Extensionless GET/HEAD page requests get the SPA shell; /api never reaches here.
    app.use((request: Request, response: Response, next: NextFunction) => {
      const isPageRequest = (request.method === 'GET' || request.method === 'HEAD') && !path.extname(request.path) && request.accepts('html')
      if (!isPageRequest) return next()
      response.setHeader('Cache-Control', 'no-cache')
      response.sendFile(path.join(config.webRoot, 'index.html'))
    })
  } else {
    console.warn('dist-render not found; serving the API only. Run `npm run build` first.')
  }

  return app
}
