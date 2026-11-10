import type { PoolClient } from 'pg'
import type { Migration } from '../migrations.js'

export const initialStoreSchemaMigration: Migration = {
  version: 1,
  name: 'initial_store_schema',
  up: `
    CREATE TABLE IF NOT EXISTS demo_entries (
      id text PRIMARY KEY, client_id text NOT NULL, status text NOT NULL, version integer NOT NULL,
      created_at timestamptz NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS demo_entries_client ON demo_entries (client_id, created_at);

    CREATE TABLE IF NOT EXISTS demo_journals (
      id text PRIMARY KEY, client_id text NOT NULL, status text NOT NULL, version integer NOT NULL,
      created_at timestamptz NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS demo_journals_client ON demo_journals (client_id, created_at);

    CREATE TABLE IF NOT EXISTS demo_payment_books (
      id text PRIMARY KEY, client_id text NOT NULL, version integer NOT NULL,
      data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS demo_payment_books_client ON demo_payment_books (client_id, id);

    CREATE TABLE IF NOT EXISTS demo_workpapers (
      id text PRIMARY KEY, client_id text NOT NULL, period text NOT NULL, version integer NOT NULL,
      created_at timestamptz NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS demo_workpapers_client ON demo_workpapers (client_id, period, created_at);

    CREATE TABLE IF NOT EXISTS reconciliation_records (
      id text PRIMARY KEY, source text NOT NULL, client_id text NOT NULL, account_id text NOT NULL,
      period_end date NOT NULL, status text NOT NULL, version integer NOT NULL, data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS reconciliation_records_lookup ON reconciliation_records (source, client_id, account_id, period_end);

    CREATE TABLE IF NOT EXISTS month_end_records (
      id text PRIMARY KEY, source text NOT NULL, client_id text NOT NULL, period text NOT NULL,
      status text NOT NULL, version integer NOT NULL, data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS month_end_records_lookup ON month_end_records (source, client_id, period);
  `,
  validate: validateInitialStoreSchema,
}

type Column = { name: string; type: string; nullable?: boolean; defaultNow?: boolean }
type Index = { name: string; columns: string[]; primary?: boolean }
type Table = { name: string; columns: Column[]; indexes: Index[] }

const tableDefinitions: Table[] = [
  {
    name: 'demo_entries',
    columns: [
      { name: 'id', type: 'text' }, { name: 'client_id', type: 'text' }, { name: 'status', type: 'text' },
      { name: 'version', type: 'int4' }, { name: 'created_at', type: 'timestamptz' }, { name: 'data', type: 'jsonb' },
      { name: 'updated_at', type: 'timestamptz', defaultNow: true },
    ],
    indexes: [{ name: 'demo_entries_pkey', columns: ['id'], primary: true }, { name: 'demo_entries_client', columns: ['client_id', 'created_at'] }],
  },
  {
    name: 'demo_journals',
    columns: [
      { name: 'id', type: 'text' }, { name: 'client_id', type: 'text' }, { name: 'status', type: 'text' },
      { name: 'version', type: 'int4' }, { name: 'created_at', type: 'timestamptz' }, { name: 'data', type: 'jsonb' },
      { name: 'updated_at', type: 'timestamptz', defaultNow: true },
    ],
    indexes: [{ name: 'demo_journals_pkey', columns: ['id'], primary: true }, { name: 'demo_journals_client', columns: ['client_id', 'created_at'] }],
  },
  {
    name: 'demo_payment_books',
    columns: [
      { name: 'id', type: 'text' }, { name: 'client_id', type: 'text' }, { name: 'version', type: 'int4' },
      { name: 'data', type: 'jsonb' }, { name: 'updated_at', type: 'timestamptz', defaultNow: true },
    ],
    indexes: [{ name: 'demo_payment_books_pkey', columns: ['id'], primary: true }, { name: 'demo_payment_books_client', columns: ['client_id', 'id'] }],
  },
  {
    name: 'demo_workpapers',
    columns: [
      { name: 'id', type: 'text' }, { name: 'client_id', type: 'text' }, { name: 'period', type: 'text' },
      { name: 'version', type: 'int4' }, { name: 'created_at', type: 'timestamptz' }, { name: 'data', type: 'jsonb' },
      { name: 'updated_at', type: 'timestamptz', defaultNow: true },
    ],
    indexes: [{ name: 'demo_workpapers_pkey', columns: ['id'], primary: true }, { name: 'demo_workpapers_client', columns: ['client_id', 'period', 'created_at'] }],
  },
  {
    name: 'reconciliation_records',
    columns: [
      { name: 'id', type: 'text' }, { name: 'source', type: 'text' }, { name: 'client_id', type: 'text' },
      { name: 'account_id', type: 'text' }, { name: 'period_end', type: 'date' }, { name: 'status', type: 'text' },
      { name: 'version', type: 'int4' }, { name: 'data', type: 'jsonb' }, { name: 'updated_at', type: 'timestamptz', defaultNow: true },
    ],
    indexes: [{ name: 'reconciliation_records_pkey', columns: ['id'], primary: true }, { name: 'reconciliation_records_lookup', columns: ['source', 'client_id', 'account_id', 'period_end'] }],
  },
  {
    name: 'month_end_records',
    columns: [
      { name: 'id', type: 'text' }, { name: 'source', type: 'text' }, { name: 'client_id', type: 'text' },
      { name: 'period', type: 'text' }, { name: 'status', type: 'text' }, { name: 'version', type: 'int4' },
      { name: 'data', type: 'jsonb' }, { name: 'updated_at', type: 'timestamptz', defaultNow: true },
    ],
    indexes: [{ name: 'month_end_records_pkey', columns: ['id'], primary: true }, { name: 'month_end_records_lookup', columns: ['source', 'client_id', 'period'] }],
  },
]

function schemaError(message: string): Error {
  return new Error(`Existing PostgreSQL schema is incompatible with migration 001: ${message}. No existing tables or records were changed.`)
}

export async function validateInitialStoreSchema(client: PoolClient) {
  const schemaResult = await client.query<{ schema_name: string }>('SELECT current_schema() AS schema_name')
  const schema = schemaResult.rows[0]?.schema_name
  if (!schema) throw schemaError('the connection has no current schema')

  for (const table of tableDefinitions) {
    const relation = await client.query<{ oid: string; kind: string }>(
      `SELECT c.oid::text AS oid, c.relkind AS kind
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = $2`,
      [schema, table.name],
    )
    if (relation.rowCount === 0) continue
    const foundRelation = relation.rows[0]
    if (foundRelation.kind !== 'r') throw schemaError(`"${table.name}" exists but is not a regular table`)

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
      [schema, table.name],
    )
    if (columns.rows.length !== table.columns.length) {
      throw schemaError(`"${table.name}" has ${columns.rows.length} columns; expected ${table.columns.length}`)
    }
    for (let index = 0; index < table.columns.length; index += 1) {
      const expected = table.columns[index]
      const actual = columns.rows[index]
      const defaultMatches = expected.defaultNow
        ? Boolean(actual.column_default && /\bnow\(\)/i.test(actual.column_default))
        : actual.column_default === null
      if (
        actual.column_name !== expected.name
        || actual.udt_name !== expected.type
        || actual.is_nullable !== 'NO'
        || !defaultMatches
      ) {
        throw schemaError(`"${table.name}" column ${index + 1} does not match the expected "${expected.name} ${expected.type} NOT NULL${expected.defaultNow ? ' DEFAULT now()' : ''}" definition`)
      }
    }

    const indexes = await client.query<{
      index_name: string
      is_primary: boolean
      is_unique: boolean
      method: string
      columns: string | null
      is_partial: boolean
    }>(
      `SELECT index_class.relname AS index_name,
              index_data.indisprimary AS is_primary,
              index_data.indisunique AS is_unique,
              access_method.amname AS method,
              (
                SELECT string_agg(attribute.attname, ',' ORDER BY key_column.ordinal)
                FROM unnest(index_data.indkey) WITH ORDINALITY AS key_column(attnum, ordinal)
                JOIN pg_catalog.pg_attribute attribute
                  ON attribute.attrelid = table_class.oid AND attribute.attnum = key_column.attnum
                WHERE key_column.ordinal <= index_data.indnkeyatts
              ) AS columns,
              index_data.indpred IS NOT NULL AS is_partial
       FROM pg_catalog.pg_index index_data
       JOIN pg_catalog.pg_class table_class ON table_class.oid = index_data.indrelid
       JOIN pg_catalog.pg_class index_class ON index_class.oid = index_data.indexrelid
       JOIN pg_catalog.pg_am access_method ON access_method.oid = index_class.relam
       WHERE table_class.oid = $1::oid`,
      [foundRelation.oid],
    )
    for (const expected of table.indexes) {
      const actual = indexes.rows.find((index) => index.index_name === expected.name)
      if (
        !actual
        || actual.is_primary !== Boolean(expected.primary)
        || actual.is_unique !== Boolean(expected.primary)
        || actual.method !== 'btree'
        || actual.is_partial
        || actual.columns !== expected.columns.join(',')
      ) {
        throw schemaError(`"${table.name}" is missing the expected ${expected.primary ? 'primary key' : `index "${expected.name}" on (${expected.columns.join(', ')})`}`)
      }
    }
    const constraints = await client.query<{ type: string; name: string }>(
      `SELECT constraint_data.contype AS type, constraint_data.conname AS name
       FROM pg_catalog.pg_constraint constraint_data
       WHERE constraint_data.conrelid = $1::oid
       ORDER BY constraint_data.conname`,
      [foundRelation.oid],
    )
    const tableConstraints = constraints.rows.filter((constraint) => constraint.type !== 'n')
    const primaryConstraints = tableConstraints.filter((constraint) => constraint.type === 'p')
    if (primaryConstraints.length !== 1 || tableConstraints.length !== 1) {
      throw schemaError(`"${table.name}" has unexpected table constraints`)
    }
  }
}
