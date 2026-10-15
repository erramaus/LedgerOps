import 'dotenv/config'
import session from 'express-session'
import { createApp } from './app.js'
import type { AuthProvider } from './authProvider.js'
import { loadConfig } from './config.js'
import { createOidcProvider } from './oidc.js'
import * as quickbooks from './quickbooks.js'
import { createPostgresSessionStore } from './sessionStore.js'
import { MemoryReconciliationStore, PostgresReconciliationStore } from './reconciliationStore.js'

const port = Number(process.env.PORT || 3001)
const loaded = loadConfig(process.env)
quickbooks.validateConfigurationAtStartup()

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

const app = createApp({ config: loaded.app, quickbooks, authProvider, sessionStore, reconciliationStore })

app.listen(port, () => {
  console.log(`LedgerOps backend listening on port ${port}`)
})
