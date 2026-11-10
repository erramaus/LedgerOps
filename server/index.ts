import 'dotenv/config'
import pg from 'pg'
import session from 'express-session'
import { createApp } from './app.js'
import type { AuthProvider } from './authProvider.js'
import { loadConfig } from './config.js'
import { createOidcProvider } from './oidc.js'
import * as quickbooks from './quickbooks.js'
import { createPostgresSessionStore } from './sessionStore.js'
import { MemoryReconciliationStore, PostgresReconciliationStore } from './reconciliationStore.js'
import { MemoryMonthEndStore, PostgresMonthEndStore } from './monthEndStore.js'
import { MemoryDemoEntryStore, PostgresDemoEntryStore } from './demoEntryStore.js'
import { MemoryDemoJournalStore, PostgresDemoJournalStore } from './demoJournalStore.js'
import { MemoryDemoPaymentStore, PostgresDemoPaymentStore } from './demoPaymentStore.js'
import { MemoryDemoWorkpaperStore, PostgresDemoWorkpaperStore } from './demoWorkpaperStore.js'
import { MemoryDemoResetRepository, PostgresDemoResetRepository } from './demoReset.js'
import { MemoryReviewDecisionStore, PostgresReviewDecisionStore } from './reviewDecisionStore.js'
import { seedDemoRecords } from './demoSeed.js'
import { assertMigrationsCurrent, runMigrations } from './migrations.js'

const port = Number(process.env.PORT || 3001)
const loaded = loadConfig(process.env)
quickbooks.validateConfigurationAtStartup()

if (loaded.databaseUrl) {
  const migrationPool = new pg.Pool({ connectionString: loaded.databaseUrl, max: 1 })
  try {
    if (loaded.app.production) {
      await assertMigrationsCurrent(migrationPool)
    } else {
      const applied = await runMigrations(migrationPool)
      if (applied.length > 0) console.info(`Applied local PostgreSQL migration versions: ${applied.join(', ')}.`)
    }
  } finally {
    await migrationPool.end()
  }
}

let authProvider: AuthProvider | undefined
let sessionStore: session.Store | undefined

if (loaded.missing.length > 0) {
  console.error(`Authentication is DISABLED; all protected routes will return 401. Fix these settings: ${loaded.missing.join(', ')}`)
} else {
  authProvider = createOidcProvider(loaded.oidc!)
  if (loaded.databaseUrl) {
    sessionStore = createPostgresSessionStore(loaded.databaseUrl)
  } else {
    // Only reachable outside production; sessions are lost on restart.
    console.warn('DATABASE_URL is not set: using an in-memory session store (development only).')
    sessionStore = new session.MemoryStore()
  }
}

const reconciliationStore = loaded.databaseUrl ? new PostgresReconciliationStore(loaded.databaseUrl) : new MemoryReconciliationStore()
if (!reconciliationStore.durable) console.warn('DATABASE_URL is not set: reconciliation records are temporary development records and will be lost on restart.')

const monthEndStore = loaded.databaseUrl ? new PostgresMonthEndStore(loaded.databaseUrl) : new MemoryMonthEndStore()
if (!monthEndStore.durable) console.warn('DATABASE_URL is not set: month-end records are temporary development records and will be lost on restart.')
seedDemoRecords(reconciliationStore, monthEndStore).catch((error) => console.warn('Demo scenario records could not be created:', error instanceof Error ? error.message : error))

const demoEntryStore = loaded.databaseUrl ? new PostgresDemoEntryStore(loaded.databaseUrl) : new MemoryDemoEntryStore()
if (!demoEntryStore.durable) console.warn('DATABASE_URL is not set: manually entered demo transactions are temporary development records and will be lost on restart.')
const demoJournalStore = loaded.databaseUrl ? new PostgresDemoJournalStore(loaded.databaseUrl) : new MemoryDemoJournalStore()
if (!demoJournalStore.durable) console.warn('DATABASE_URL is not set: demo journal entries are temporary development records and will be lost on restart.')
const demoPaymentStore = loaded.databaseUrl ? new PostgresDemoPaymentStore(loaded.databaseUrl) : new MemoryDemoPaymentStore()
if (!demoPaymentStore.durable) console.warn('DATABASE_URL is not set: manually entered demo payments are temporary development records and will be lost on restart.')
const demoWorkpaperStore = loaded.databaseUrl ? new PostgresDemoWorkpaperStore(loaded.databaseUrl) : new MemoryDemoWorkpaperStore()
if (!demoWorkpaperStore.durable) console.warn('DATABASE_URL is not set: demo workpapers are temporary development records and will be lost on restart.')
const demoResetRepository = loaded.databaseUrl
  ? new PostgresDemoResetRepository(loaded.databaseUrl)
  : new MemoryDemoResetRepository({ entries: demoEntryStore, journals: demoJournalStore, payments: demoPaymentStore, workpapers: demoWorkpaperStore, reconciliations: reconciliationStore, monthEnd: monthEndStore })
const reviewDecisionStore = loaded.databaseUrl ? new PostgresReviewDecisionStore(loaded.databaseUrl) : new MemoryReviewDecisionStore()
if (!reviewDecisionStore.durable) console.warn('DATABASE_URL is not set: review decisions are temporary server-memory records and will be lost on restart.')
const app = createApp({ config: loaded.app, quickbooks, authProvider, sessionStore, reconciliationStore, monthEndStore, demoEntryStore, demoJournalStore, demoPaymentStore, demoWorkpaperStore, demoResetRepository, reviewDecisionStore })

if (loaded.devBypassRefusal) console.error(`LEDGEROPS_DEV_BYPASS_AUTH was REFUSED and sign-in stays required: ${loaded.devBypassRefusal}.`)
if (loaded.app.devBypassAuth) console.warn('*** LOCAL DEVELOPMENT AUTH BYPASS IS ACTIVE: demo routes need no sign-in; QuickBooks routes still require real sign-in. Listening on 127.0.0.1 only. ***')

const listening = () => console.log(`LedgerOps backend listening on port ${port}`)
if (loaded.app.devBypassAuth) app.listen(port, '127.0.0.1', listening)
else app.listen(port, listening)
