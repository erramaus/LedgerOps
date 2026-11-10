import { randomBytes } from 'node:crypto'
import pg from 'pg'

/** Test-only helpers. Never imported by application code. */

export const TEST_DATABASE_ENV = 'LEDGEROPS_TEST_DATABASE_URL'
export const STORE_TABLES = ['demo_entries', 'demo_journals', 'demo_payment_books', 'demo_workpapers', 'reconciliation_records', 'month_end_records', 'review_decisions']

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const FORBIDDEN_DATABASES = new Set(['postgres', 'template0', 'template1'])
const SCHEMA_PATTERN = /^ledgerops_test_[0-9a-f]{12}$/

export type TestDatabaseDecision = { ok: true; url: string } | { ok: false; reason: string }

function target(value: string) {
  try {
    const parsed = new URL(value)
    return { host: parsed.hostname.toLowerCase(), port: parsed.port || '5432', database: decodeURIComponent(parsed.pathname.replace(/^\//, '')).toLowerCase() }
  } catch {
    return null
  }
}

/** Decides whether a URL is safe to use. Reasons never contain the URL or any part of its credentials. */
export function evaluateTestDatabaseUrl(candidate: string | undefined, otherUrls: Array<string | undefined> = []): TestDatabaseDecision {
  if (!candidate) return { ok: false, reason: `${TEST_DATABASE_ENV} is not set.` }
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false, reason: `${TEST_DATABASE_ENV} is not a valid URL.` }
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return { ok: false, reason: `${TEST_DATABASE_ENV} must be a postgres:// URL.` }
  const found = target(candidate)
  if (!found || !found.database) return { ok: false, reason: `${TEST_DATABASE_ENV} must name a database.` }
  if (!LOOPBACK_HOSTS.has(found.host)) return { ok: false, reason: 'The test database host must be localhost (remote and hosted databases are refused).' }
  if (FORBIDDEN_DATABASES.has(found.database) || !/(^|[_-])test([_-]|$)/.test(found.database)) {
    return { ok: false, reason: 'The test database name must contain the word "test" as its own part (for example ledgerops_test).' }
  }
  if (parsed.searchParams.has('options') || parsed.searchParams.has('schema')) return { ok: false, reason: 'The test database URL must not set options or schema.' }
  for (const other of otherUrls) {
    const otherTarget = other ? target(other) : null
    if (otherTarget && otherTarget.host === found.host && otherTarget.port === found.port && otherTarget.database === found.database) {
      return { ok: false, reason: 'The test database is the same as the configured application database.' }
    }
  }
  return { ok: true, url: candidate }
}

export function decideFromEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  return evaluateTestDatabaseUrl(environment[TEST_DATABASE_ENV], [environment.DATABASE_URL])
}

export interface IsolatedSchema {
  /** Connection string whose search_path points only at the throwaway schema. */
  url: string
  schema: string
  outsideSnapshot: () => Promise<string>
  ownTables: () => Promise<string[]>
  cleanup: () => Promise<void>
}

/** Creates a uniquely named schema and returns a URL that uses only that schema. */
export async function createIsolatedSchema(baseUrl: string): Promise<IsolatedSchema> {
  const schema = `ledgerops_test_${randomBytes(6).toString('hex')}`
  if (!SCHEMA_PATTERN.test(schema)) throw new Error('Unexpected schema name.')
  const admin = new pg.Pool({ connectionString: baseUrl, max: 1 })
  const snapshot = async () => {
    const tables = await admin.query('SELECT schemaname, tablename FROM pg_tables WHERE tablename = ANY($1::text[]) AND schemaname <> $2 ORDER BY 1, 2', [STORE_TABLES, schema])
    const lines: string[] = []
    for (const row of tables.rows) {
      const count = await admin.query(`SELECT count(*)::int AS n FROM ${pg.escapeIdentifier(row.schemaname)}.${pg.escapeIdentifier(row.tablename)}`)
      lines.push(`${row.schemaname}.${row.tablename}=${count.rows[0].n}`)
    }
    return lines.join('|')
  }
  try {
    await admin.query(`CREATE SCHEMA ${pg.escapeIdentifier(schema)}`)
  } catch (error) {
    await admin.end()
    throw error
  }
  const url = new URL(baseUrl)
  url.searchParams.set('options', `-c search_path=${schema}`)
  return {
    url: url.toString(),
    schema,
    outsideSnapshot: snapshot,
    ownTables: async () => (await admin.query('SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY 1', [schema])).rows.map((row) => row.tablename as string),
    cleanup: async () => {
      try {
        // Only the schema this run created; the name is generated above and re-checked here.
        if (SCHEMA_PATTERN.test(schema)) await admin.query(`DROP SCHEMA IF EXISTS ${pg.escapeIdentifier(schema)} CASCADE`)
      } finally {
        await admin.end()
      }
    },
  }
}

/** The stores do not expose close(); end their pools so the test process can exit. */
export async function closeStore(store: unknown) {
  const pool = (store as { pool?: pg.Pool } | undefined)?.pool
  if (pool && typeof pool.end === 'function') await pool.end()
}
