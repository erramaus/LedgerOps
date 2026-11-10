import type { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import {
  getMigrationDiagnosticFailure,
  MigrationDiagnosticError,
  runMigrations,
} from './migrations.js'

const expectedTrackingColumns = [
  { column_name: 'version', udt_name: 'int4', is_nullable: 'NO', column_default: null },
  { column_name: 'name', udt_name: 'text', is_nullable: 'NO', column_default: null },
  { column_name: 'checksum', udt_name: 'text', is_nullable: 'NO', column_default: null },
  { column_name: 'applied_at', udt_name: 'timestamptz', is_nullable: 'NO', column_default: 'now()' },
]

function createPool(options: { failMigration?: Error; failRollback?: boolean } = {}) {
  const pendingChanges: string[] = []
  const committedChanges: string[] = []
  const calls: string[] = []
  const client = {
    async query(sql: string) {
      const normalized = sql.trim()
      calls.push(normalized)
      if (normalized === 'BEGIN') return { rows: [] }
      if (normalized.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] }
      if (normalized.startsWith('CREATE TABLE IF NOT EXISTS ledgerops_schema_migrations')) {
        pendingChanges.push('tracking table')
        return { rows: [] }
      }
      if (normalized === 'SELECT current_schema() AS schema_name') return { rows: [{ schema_name: 'public' }] }
      if (normalized.includes('FROM information_schema.columns')) return { rows: expectedTrackingColumns }
      if (normalized.includes('FROM pg_catalog.pg_index')) return { rows: [{ columns: 'version' }] }
      if (normalized.startsWith('SELECT version, name, checksum FROM ledgerops_schema_migrations')) {
        return { rows: [] }
      }
      if (normalized === 'SELECT 1') {
        if (options.failMigration) throw options.failMigration
        pendingChanges.push('migration table')
        return { rows: [] }
      }
      if (normalized.startsWith('INSERT INTO ledgerops_schema_migrations')) {
        pendingChanges.push('migration history')
        return { rows: [] }
      }
      if (normalized === 'ROLLBACK') {
        if (options.failRollback) throw new Error('rollback failure')
        pendingChanges.length = 0
        return { rows: [] }
      }
      if (normalized === 'COMMIT') {
        committedChanges.push(...pendingChanges)
        pendingChanges.length = 0
        return { rows: [] }
      }
      throw new Error(`Unexpected test query: ${normalized}`)
    },
    release() {},
  }
  const pool = {
    async connect() {
      return client
    },
  }
  return {
    pool: pool as unknown as Pool,
    calls,
    pendingChanges,
    committedChanges,
  }
}

describe('migration diagnostic rollback handling', () => {
  it('confirms successful rollback after executing diagnostic DDL', async () => {
    const database = createPool()
    const migration = [{ version: 1, name: 'test_migration', up: 'SELECT 1' }]

    await expect(runMigrations(database.pool, migration, { diagnostic: true })).resolves.toEqual([])
    expect(database.calls).toContain('ROLLBACK')
    expect(database.calls).not.toContain('COMMIT')
    expect(database.pendingChanges).toEqual([])
    expect(database.committedChanges).toEqual([])
  })

  it('reports the migration and SQLSTATE only after rollback succeeds', async () => {
    const database = createPool({ failMigration: Object.assign(new Error('secret details'), { code: '42601' }) })
    const migration = [{ version: 1, name: 'test_migration', up: 'SELECT 1' }]

    await expect(runMigrations(database.pool, migration, { diagnostic: true })).rejects.toMatchObject({
      migrationNumber: 1,
      step: 'execute_migration_sql',
      postgresCode: '42601',
    })
    expect(database.calls).toContain('ROLLBACK')
    expect(database.pendingChanges).toEqual([])
    expect(database.committedChanges).toEqual([])
  })

  it('does not report a normal diagnostic result when rollback fails', async () => {
    const database = createPool({
      failMigration: Object.assign(new Error('secret details'), { code: '42601' }),
      failRollback: true,
    })
    const migration = [{ version: 1, name: 'test_migration', up: 'SELECT 1' }]
    let caught: unknown

    try {
      await runMigrations(database.pool, migration, { diagnostic: true })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(AggregateError)
    expect(getMigrationDiagnosticFailure(caught)).toEqual({ rollbackConfirmed: false })
    expect(database.calls).toContain('ROLLBACK')
    expect(database.committedChanges).toEqual([])
  })

  it('classifies any AggregateError containing a diagnostic error as unconfirmed rollback', () => {
    const diagnostic = new MigrationDiagnosticError(2, 'execute_migration_sql', '42601')
    const aggregate = new AggregateError([new Error('rollback failure'), diagnostic])

    expect(getMigrationDiagnosticFailure(aggregate)).toEqual({ rollbackConfirmed: false })
  })

  it('reports a missing PostgreSQL code as null when rollback succeeds', async () => {
    const database = createPool({ failMigration: new Error('driver failure') })
    const migration = [{ version: 1, name: 'test_migration', up: 'SELECT 1' }]
    let caught: unknown

    try {
      await runMigrations(database.pool, migration, { diagnostic: true })
    } catch (error) {
      caught = error
    }

    expect(getMigrationDiagnosticFailure(caught)).toEqual({
      rollbackConfirmed: true,
      migrationNumber: 1,
      step: 'execute_migration_sql',
      postgresCode: null,
    })
  })
})
