import pg from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import { initialStoreSchemaMigration } from './migrations/001_initial_store_schema.js'
import { assertMigrationsCurrent, assertMigrationExecutionPolicy, migrations, runMigrations } from './migrations.js'
import { createIsolatedSchema, decideFromEnvironment, type IsolatedSchema } from './testDatabase.js'

const decision = decideFromEnvironment()
const skipReason = decision.ok ? undefined : `PostgreSQL migration tests skipped: ${decision.reason}`
const activeSchemas = new Set<{ schema: IsolatedSchema; pools: pg.Pool[] }>()

async function openIsolatedDatabase() {
  if (!decision.ok) throw new Error('Migration integration tests require a safe test database.')
  const schema = await createIsolatedSchema(decision.url)
  const pools: pg.Pool[] = []
  const connect = () => {
    const pool = new pg.Pool({ connectionString: schema.url, max: 1 })
    pools.push(pool)
    return pool
  }
  const database = { schema, pools, connect }
  activeSchemas.add(database)
  return database
}

afterEach(async () => {
  for (const database of activeSchemas) {
    for (const pool of database.pools) await pool.end()
    await database.schema.cleanup()
    activeSchemas.delete(database)
  }
})

describe.skipIf(!decision.ok)('PostgreSQL versioned migrations', () => {
  it('keeps production readiness checks read-only when migration history is absent', async () => {
    const database = await openIsolatedDatabase()
    const pool = database.connect()

    await expect(assertMigrationsCurrent(pool)).rejects.toThrow(/migrations are not installed/)
    expect(await database.schema.ownTables()).toEqual([])
  })

  it('creates the baseline schema on an empty schema and is idempotent', async () => {
    const database = await openIsolatedDatabase()
    const pool = database.connect()

    expect(await runMigrations(pool)).toEqual([1, 2])
    expect(await runMigrations(pool)).toEqual([])
    await expect(assertMigrationsCurrent(pool)).resolves.toBeUndefined()
    expect(await database.schema.ownTables()).toEqual([
      'demo_entries',
      'demo_journals',
      'demo_payment_books',
      'demo_workpapers',
      'ledgerops_schema_migrations',
      'month_end_records',
      'reconciliation_records',
      'review_decisions',
    ])
  })

  it('diagnoses a SQL failure with its migration and SQLSTATE, then rolls back', async () => {
    const database = await openIsolatedDatabase()
    const pool = database.connect()
    const brokenMigration = [{ version: 1, name: 'broken_sql', up: 'SELECT FROM' }]

    await expect(runMigrations(pool, brokenMigration, { diagnostic: true })).rejects.toMatchObject({
      migrationNumber: 1,
      step: 'execute_migration_sql',
      postgresCode: '42601',
    })
    expect(await database.schema.ownTables()).toEqual([])
  })

  it('rolls back successful diagnostic migration execution without creating tables', async () => {
    const database = await openIsolatedDatabase()
    const pool = database.connect()

    await expect(runMigrations(pool, migrations, { diagnostic: true })).resolves.toEqual([])
    expect(await database.schema.ownTables()).toEqual([])
  })

  it('detects an altered checksum for an already-applied migration without changing the schema', async () => {
    const database = await openIsolatedDatabase()
    const pool = database.connect()
    await runMigrations(pool)
    const changed = [{ ...initialStoreSchemaMigration, up: `${initialStoreSchemaMigration.up}\n-- changed` }]

    await expect(runMigrations(pool, changed)).rejects.toThrow(/does not match its recorded checksum/)
    await expect(assertMigrationsCurrent(pool)).resolves.toBeUndefined()
  })

  it('detects an altered checksum for migration 002 without changing its schema', async () => {
    const database = await openIsolatedDatabase()
    const pool = database.connect()
    await runMigrations(pool)
    const changed = migrations.map((migration) => migration.version === 2 ? { ...migration, up: `${migration.up}\n-- changed` } : migration)

    await expect(runMigrations(pool, changed)).rejects.toThrow(/Applied migration 2 .* does not match its recorded checksum/)
    await expect(assertMigrationsCurrent(pool)).resolves.toBeUndefined()
    expect(await database.schema.ownTables()).toContain('review_decisions')
  })

  it('serializes concurrent migration processes using the database advisory lock', async () => {
    const database = await openIsolatedDatabase()
    const first = database.connect()
    const second = database.connect()

    const results = await Promise.all([runMigrations(first), runMigrations(second)])
    expect(results.flat().sort()).toEqual([1, 2])
    await expect(assertMigrationsCurrent(first)).resolves.toBeUndefined()
  })

  it('adopts compatible legacy tables and preserves records', async () => {
    const database = await openIsolatedDatabase()
    const pool = database.connect()
    await pool.query(initialStoreSchemaMigration.up)
    await pool.query(
      `INSERT INTO demo_entries (id, client_id, status, version, created_at, data)
       VALUES ('legacy-entry', 'legacy-client', 'posted', 4, '2026-01-02T00:00:00Z', '{"id":"legacy-entry","version":4}')`,
    )

    expect(await runMigrations(pool)).toEqual([1, 2])
    const adopted = await pool.query('SELECT id, version, data FROM demo_entries WHERE id = $1', ['legacy-entry'])
    expect(adopted.rows[0]).toMatchObject({ id: 'legacy-entry', version: 4, data: { id: 'legacy-entry', version: 4 } })
    await expect(assertMigrationsCurrent(pool)).resolves.toBeUndefined()
  })

  it('rejects an incompatible existing table without altering it or recording the baseline', async () => {
    const database = await openIsolatedDatabase()
    const pool = database.connect()
    await pool.query('CREATE TABLE demo_entries (id text PRIMARY KEY)')
    await pool.query(`INSERT INTO demo_entries (id) VALUES ('keep-me')`)

    await expect(runMigrations(pool)).rejects.toThrow(/Existing PostgreSQL schema is incompatible with migration 001/)
    const table = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'demo_entries' ORDER BY ordinal_position`,
    )
    expect(table.rows.map((row) => row.column_name)).toEqual(['id'])
    await expect(pool.query('SELECT id FROM demo_entries')).resolves.toMatchObject({ rows: [{ id: 'keep-me' }] })
    const tracking = await pool.query(`SELECT to_regclass(format('%I.%I', current_schema()::text, 'ledgerops_schema_migrations'::text))::text AS relation_name`)
    expect(tracking.rows[0]?.relation_name).toBeNull()
  })

  it('rejects a compatible-looking table with a missing required index without adding it', async () => {
    const database = await openIsolatedDatabase()
    const pool = database.connect()
    await pool.query(initialStoreSchemaMigration.up.replace(
      'CREATE INDEX IF NOT EXISTS demo_entries_client ON demo_entries (client_id, created_at);',
      '',
    ))

    await expect(runMigrations(pool)).rejects.toThrow(/missing the expected index "demo_entries_client"/)
    const index = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = current_schema() AND tablename = 'demo_entries' AND indexname = 'demo_entries_client'`,
    )
    expect(index.rows).toEqual([])
    const tracking = await pool.query(`SELECT to_regclass(format('%I.%I', current_schema()::text, 'ledgerops_schema_migrations'::text))::text AS relation_name`)
    expect(tracking.rows[0]?.relation_name).toBeNull()
  })

  it('rejects an incompatible migration tracking table without changing it', async () => {
    const database = await openIsolatedDatabase()
    const pool = database.connect()
    await pool.query('CREATE TABLE ledgerops_schema_migrations (version text PRIMARY KEY)')

    await expect(runMigrations(pool)).rejects.toThrow(/ledgerops_schema_migrations table has an incompatible schema/)
    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'ledgerops_schema_migrations' ORDER BY ordinal_position`,
    )
    expect(columns.rows.map((row) => row.column_name)).toEqual(['version'])
  })

  it('rejects an incompatible pre-existing review decision table without altering it', async () => {
    const database = await openIsolatedDatabase()
    const pool = database.connect()
    await pool.query('CREATE TABLE review_decisions (id text PRIMARY KEY)')
    await pool.query(`INSERT INTO review_decisions (id) VALUES ('keep-me')`)

    await expect(runMigrations(pool)).rejects.toThrow(/review_decisions table has an incompatible schema/)
    await expect(pool.query('SELECT id FROM review_decisions')).resolves.toMatchObject({ rows: [{ id: 'keep-me' }] })
    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'review_decisions' ORDER BY ordinal_position`,
    )
    expect(columns.rows.map((row) => row.column_name)).toEqual(['id'])
    const tracking = await pool.query(`SELECT to_regclass(format('%I.%I', current_schema()::text, 'ledgerops_schema_migrations'::text))::text AS relation_name`)
    expect(tracking.rows[0]?.relation_name).toBeNull()
  })
})

describe('production migration execution policy', () => {
  it('requires both explicit production approvals', () => {
    expect(() => assertMigrationExecutionPolicy(true, [], {})).toThrow(/require both --approve-production/)
    expect(() => assertMigrationExecutionPolicy(true, ['--approve-production'], {})).toThrow(/require both --approve-production/)
    expect(() => assertMigrationExecutionPolicy(true, [], { LEDGEROPS_PRODUCTION_MIGRATIONS_APPROVED: 'true' })).toThrow(/require both --approve-production/)
    expect(() => assertMigrationExecutionPolicy(true, ['--approve-production'], { LEDGEROPS_PRODUCTION_MIGRATIONS_APPROVED: 'true' })).not.toThrow()
  })

  it('does not require production approval for explicit non-production migration commands', () => {
    expect(() => assertMigrationExecutionPolicy(false, [], {})).not.toThrow()
  })
})

if (!decision.ok) console.info(skipReason)
