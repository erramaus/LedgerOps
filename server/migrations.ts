import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { initialStoreSchemaMigration } from './migrations/001_initial_store_schema.js'
import { reviewDecisionsMigration } from './migrations/002_review_decisions.js'

export type Migration = {
  version: number
  name: string
  up: string
  validate?: (client: PoolClient) => Promise<void>
}

export const migrations: readonly Migration[] = [initialStoreSchemaMigration, reviewDecisionsMigration]
const MIGRATION_LOCK_KEY = '5812402391846201'
const TRACKING_TABLE = 'ledgerops_schema_migrations'

export class MigrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MigrationError'
  }
}

export function assertMigrationExecutionPolicy(
  production: boolean,
  args: string[],
  environment: NodeJS.ProcessEnv,
) {
  if (
    production
    && (!args.includes('--approve-production') || environment.LEDGEROPS_PRODUCTION_MIGRATIONS_APPROVED !== 'true')
  ) {
    throw new MigrationError('Production migrations require both --approve-production and LEDGEROPS_PRODUCTION_MIGRATIONS_APPROVED=true. No database connection was opened.')
  }
}

export function migrationChecksum(migration: Pick<Migration, 'version' | 'name' | 'up'>) {
  return createHash('sha256').update(`${migration.version}\n${migration.name}\n${migration.up}`).digest('hex')
}

function validateMigrationSequence(items: readonly Migration[]) {
  const versions = new Set<number>()
  items.forEach((migration, index) => {
    if (!Number.isInteger(migration.version) || migration.version !== index + 1) {
      throw new MigrationError('Migration versions must be positive, sequential, and start at 1.')
    }
    if (!/^[a-z0-9_]+$/.test(migration.name) || !migration.up.trim()) {
      throw new MigrationError(`Migration ${migration.version} has an invalid name or empty SQL.`)
    }
    if (versions.has(migration.version)) throw new MigrationError(`Migration ${migration.version} is declared more than once.`)
    versions.add(migration.version)
  })
}

async function validateTrackingTable(client: PoolClient) {
  const schema = (await client.query<{ schema_name: string }>('SELECT current_schema() AS schema_name')).rows[0]?.schema_name
  if (!schema) throw new MigrationError(`The ${TRACKING_TABLE} table has no current schema.`)
  const columns = await client.query<{
    column_name: string
    udt_name: string
    is_nullable: 'YES' | 'NO'
    column_default: string | null
  }>(
    `SELECT column_name, udt_name, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, TRACKING_TABLE],
  )
  const expected = [
    ['version', 'int4', 'NO', null],
    ['name', 'text', 'NO', null],
    ['checksum', 'text', 'NO', null],
    ['applied_at', 'timestamptz', 'NO', 'now'],
  ] as const
  const actualMatches = columns.rows.length === expected.length && columns.rows.every((column, index) => {
    const item = expected[index]
    const defaultMatches = item[3] === 'now'
      ? Boolean(column.column_default && /\bnow\(\)/i.test(column.column_default))
      : column.column_default === item[3]
    return column.column_name === item[0] && column.udt_name === item[1] && column.is_nullable === item[2] && defaultMatches
  })
  const primaryKey = await client.query<{ columns: string | null }>(
    `SELECT string_agg(attribute.attname, ',' ORDER BY key_column.ordinal) AS columns
     FROM pg_catalog.pg_index index_data
     CROSS JOIN LATERAL unnest(index_data.indkey) WITH ORDINALITY AS key_column(attnum, ordinal)
     JOIN pg_catalog.pg_attribute attribute
       ON attribute.attrelid = index_data.indrelid AND attribute.attnum = key_column.attnum
     WHERE index_data.indrelid = to_regclass(format('%I.%I', $1::text, $2::text))
       AND index_data.indisprimary`,
    [schema, TRACKING_TABLE],
  )
  if (!actualMatches || primaryKey.rows[0]?.columns !== 'version') {
    throw new MigrationError(`The ${TRACKING_TABLE} table has an incompatible schema. It was not changed.`)
  }
}

async function ensureTrackingTable(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
      version integer PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await validateTrackingTable(client)
}

async function readAppliedMigrations(client: PoolClient) {
  const result = await client.query<{ version: number; name: string; checksum: string }>(
    `SELECT version, name, checksum FROM ${TRACKING_TABLE} ORDER BY version`,
  )
  return result.rows
}

function validateAppliedMigrations(
  applied: Array<{ version: number; name: string; checksum: string }>,
  items: readonly Migration[],
) {
  for (const [index, row] of applied.entries()) {
    if (row.version !== index + 1) {
      throw new MigrationError(`Migration history is not sequential at version ${index + 1}; no schema changes were made.`)
    }
    const migration = items.find((item) => item.version === row.version)
    if (!migration) throw new MigrationError(`Database contains unknown migration version ${row.version}; no schema changes were made.`)
    if (row.name !== migration.name || row.checksum !== migrationChecksum(migration)) {
      throw new MigrationError(`Applied migration ${row.version} ("${row.name}") does not match its recorded checksum. Restore the original migration or add a new forward migration; no schema changes were made.`)
    }
  }
}

export async function runMigrations(pool: Pool, items: readonly Migration[] = migrations): Promise<number[]> {
  validateMigrationSequence(items)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [MIGRATION_LOCK_KEY])
    await ensureTrackingTable(client)

    const applied = await readAppliedMigrations(client)
    validateAppliedMigrations(applied, items)
    const appliedVersions = new Set(applied.map((row) => row.version))
    const newlyApplied: number[] = []

    for (const migration of items) {
      if (appliedVersions.has(migration.version)) continue
      if (migration.validate) await migration.validate(client)
      await client.query(migration.up)
      if (migration.validate) await migration.validate(client)
      await client.query(
        `INSERT INTO ${TRACKING_TABLE} (version, name, checksum) VALUES ($1, $2, $3)`,
        [migration.version, migration.name, migrationChecksum(migration)],
      )
      newlyApplied.push(migration.version)
    }

    await client.query('COMMIT')
    return newlyApplied
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Migration failed and PostgreSQL did not confirm rollback.')
    }
    throw error
  } finally {
    client.release()
  }
}

export async function assertMigrationsCurrent(pool: Pool, items: readonly Migration[] = migrations) {
  validateMigrationSequence(items)
  const client = await pool.connect()
  try {
    const table = await client.query<{ relation_name: string | null }>(
      `SELECT to_regclass(format('%I.%I', current_schema()::text, $1::text))::text AS relation_name`,
      [TRACKING_TABLE],
    )
    if (!table.rows[0]?.relation_name) {
      throw new MigrationError(`PostgreSQL migrations are not installed. Run the explicit migration command before starting the production server.`)
    }
    await validateTrackingTable(client)
    const applied = await readAppliedMigrations(client)
    validateAppliedMigrations(applied, items)
    const appliedVersions = new Set(applied.map((row) => row.version))
    const missing = items.filter((migration) => !appliedVersions.has(migration.version))
    if (missing.length > 0) {
      throw new MigrationError(`PostgreSQL schema is behind migration ${missing[0].version}. Run the explicit migration command before starting the production server.`)
    }
  } finally {
    client.release()
  }
}
