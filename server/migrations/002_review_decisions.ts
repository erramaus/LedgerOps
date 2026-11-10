import type { PoolClient } from 'pg'
import type { Migration } from '../migrations.js'

const TABLE = 'review_decisions'
const EXPECTED_COLUMNS = [
  ['id', 'uuid', 'NO'],
  ['source', 'text', 'NO'],
  ['client_id', 'text', 'NO'],
  ['finding_id', 'text', 'NO'],
  ['fingerprint', 'text', 'NO'],
  ['finding_type', 'text', 'NO'],
  ['issue', 'text', 'NO'],
  ['description', 'text', 'NO'],
  ['priority', 'text', 'NO'],
  ['status', 'text', 'NO'],
  ['reason', 'text', 'YES'],
  ['actor_id', 'text', 'YES'],
  ['actor_label', 'text', 'YES'],
  ['created_at', 'timestamptz', 'NO'],
  ['version', 'int4', 'NO'],
] as const

async function validateReviewDecisionSchema(client: PoolClient) {
  const schema = (await client.query<{ schema_name: string }>('SELECT current_schema() AS schema_name')).rows[0]?.schema_name
  if (!schema) throw new Error('Review decision migration has no current schema.')
  const relation = await client.query<{ kind: string }>(
    `SELECT c.relkind AS kind
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relname = $2`,
    [schema, TABLE],
  )
  if (relation.rowCount === 0) return
  if (relation.rows[0].kind !== 'r') throw new Error('Existing review_decisions relation is not a regular table; migration 002 made no changes.')

  const columns = await client.query<{ column_name: string; udt_name: string; is_nullable: 'YES' | 'NO'; column_default: string | null }>(
    `SELECT column_name, udt_name, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, TABLE],
  )
  if (columns.rows.length !== EXPECTED_COLUMNS.length || columns.rows.some((actual, index) => {
    const expected = EXPECTED_COLUMNS[index]
    return actual.column_name !== expected[0]
      || actual.udt_name !== expected[1]
      || actual.is_nullable !== expected[2]
      || (expected[0] === 'created_at' ? !actual.column_default || !/\bnow\(\)/i.test(actual.column_default) : actual.column_default !== null)
  })) {
    throw new Error('Existing review_decisions table has an incompatible schema; migration 002 made no changes.')
  }

  const indexes = await client.query<{ indexname: string; columns: string }>(
    `SELECT index_data.relname AS indexname,
            string_agg(attribute.attname, ',' ORDER BY key_column.ordinal) AS columns
     FROM pg_catalog.pg_index index_info
     JOIN pg_catalog.pg_class table_data ON table_data.oid = index_info.indrelid
     JOIN pg_catalog.pg_namespace namespace_data ON namespace_data.oid = table_data.relnamespace
     JOIN pg_catalog.pg_class index_data ON index_data.oid = index_info.indexrelid
     CROSS JOIN LATERAL unnest(index_info.indkey) WITH ORDINALITY AS key_column(attnum, ordinal)
     JOIN pg_catalog.pg_attribute attribute
       ON attribute.attrelid = table_data.oid AND attribute.attnum = key_column.attnum
     WHERE namespace_data.nspname = $1 AND table_data.relname = $2
     GROUP BY index_data.relname`,
    [schema, TABLE],
  )
  const expectedIndexes = new Map([
    ['review_decisions_pkey', 'id'],
    ['review_decisions_finding_version_uq', 'source,client_id,finding_id,version'],
    ['review_decisions_client_history', 'source,client_id,created_at'],
  ])
  for (const [name, columnsForIndex] of expectedIndexes) {
    if (!indexes.rows.some((index) => index.indexname === name && index.columns === columnsForIndex)) {
      throw new Error(`Existing review_decisions table is missing expected index "${name}"; migration 002 made no changes.`)
    }
  }
  const constraints = await client.query<{ constraint_name: string; constraint_type: string; definition: string }>(
    `SELECT constraint_data.conname AS constraint_name, constraint_data.contype AS constraint_type,
            pg_get_constraintdef(constraint_data.oid) AS definition
     FROM pg_catalog.pg_constraint constraint_data
     JOIN pg_catalog.pg_class table_data ON table_data.oid = constraint_data.conrelid
     JOIN pg_catalog.pg_namespace namespace_data ON namespace_data.oid = table_data.relnamespace
     WHERE namespace_data.nspname = $1 AND table_data.relname = $2`,
    [schema, TABLE],
  )
  const expectedConstraints = new Map<string, { type: string; fragments?: string[] }>([
    ['review_decisions_source_ck', { type: 'c', fragments: ["'demo'", "'quickbooks'"] }],
    ['review_decisions_client_id_ck', { type: 'c', fragments: ['client_id', '0,59'] }],
    ['review_decisions_finding_id_ck', { type: 'c', fragments: ['finding_id', '300'] }],
    ['review_decisions_fingerprint_ck', { type: 'c', fragments: ['fingerprint', '128'] }],
    ['review_decisions_finding_type_ck', { type: 'c', fragments: ["'duplicate'", "'other'"] }],
    ['review_decisions_issue_ck', { type: 'c', fragments: ['issue', '200'] }],
    ['review_decisions_description_ck', { type: 'c', fragments: ['description', '2000'] }],
    ['review_decisions_priority_ck', { type: 'c', fragments: ["'High'", "'Low'"] }],
    ['review_decisions_status_ck', { type: 'c', fragments: ["'reviewing'", "'reopened'"] }],
    ['review_decisions_version_ck', { type: 'c', fragments: ['version', '0'] }],
    ['review_decisions_dismissal_reason_ck', { type: 'c', fragments: ["'dismissed'", 'reason', 'btrim'] }],
    ['review_decisions_client_ownership_ck', { type: 'c', fragments: ["'abc-plumbing'", "'quickbooks-sandbox'"] }],
    ['review_decisions_finding_version_uq', { type: 'u' }],
  ])
  for (const [name, expected] of expectedConstraints) {
    const actual = constraints.rows.find((constraint) => constraint.constraint_name === name && constraint.constraint_type === expected.type)
    if (!actual || expected.fragments?.some((fragment) => !actual.definition.includes(fragment))) {
      throw new Error(`Existing review_decisions table is missing expected constraint "${name}"; migration 002 made no changes.`)
    }
  }
  const functions = await client.query<{ definition: string }>(
    `SELECT pg_get_functiondef(function_data.oid) AS definition
     FROM pg_catalog.pg_proc function_data
     JOIN pg_catalog.pg_namespace namespace_data ON namespace_data.oid = function_data.pronamespace
     WHERE namespace_data.nspname = $1 AND function_data.proname = 'ledgerops_reject_review_decision_mutation'
       AND pg_catalog.pg_get_function_identity_arguments(function_data.oid) = ''`,
    [schema],
  )
  const trigger = await client.query<{ definition: string; enabled: string }>(
    `SELECT pg_get_triggerdef(trigger_data.oid) AS definition, trigger_data.tgenabled AS enabled
     FROM pg_catalog.pg_trigger trigger_data
     JOIN pg_catalog.pg_class table_data ON table_data.oid = trigger_data.tgrelid
     JOIN pg_catalog.pg_namespace namespace_data ON namespace_data.oid = table_data.relnamespace
     WHERE namespace_data.nspname = $1 AND table_data.relname = $2 AND trigger_data.tgname = 'review_decisions_append_only'`,
    [schema, TABLE],
  )
  const truncateTrigger = await client.query<{ definition: string; enabled: string }>(
    `SELECT pg_get_triggerdef(trigger_data.oid) AS definition, trigger_data.tgenabled AS enabled
     FROM pg_catalog.pg_trigger trigger_data
     JOIN pg_catalog.pg_class table_data ON table_data.oid = trigger_data.tgrelid
     JOIN pg_catalog.pg_namespace namespace_data ON namespace_data.oid = table_data.relnamespace
     WHERE namespace_data.nspname = $1 AND table_data.relname = $2 AND trigger_data.tgname = 'review_decisions_truncate_guard'`,
    [schema, TABLE],
  )
  if (!functions.rows[0]?.definition.includes('RAISE EXCEPTION') || !functions.rows[0].definition.includes('RETURN OLD')) {
    throw new Error('Review decision append-only trigger function is missing or incompatible; migration 002 made no changes.')
  }
  if (!trigger.rows[0]?.definition.includes('BEFORE UPDATE OR DELETE')
    || !trigger.rows[0].definition.includes('ledgerops_reject_review_decision_mutation')
    || trigger.rows[0].enabled !== 'O') {
    throw new Error('Review decision append-only trigger is missing or incompatible; migration 002 made no changes.')
  }
  if (!truncateTrigger.rows[0]?.definition.includes('BEFORE TRUNCATE')
    || !truncateTrigger.rows[0].definition.includes('ledgerops_reject_review_decision_mutation')
    || truncateTrigger.rows[0].enabled !== 'O') {
    throw new Error('Review decision truncate guard is missing or incompatible; migration 002 made no changes.')
  }
}

export const reviewDecisionsMigration: Migration = {
  version: 2,
  name: 'review_decisions',
  up: `
    CREATE TABLE IF NOT EXISTS review_decisions (
      id uuid PRIMARY KEY,
      source text NOT NULL CONSTRAINT review_decisions_source_ck CHECK (source IN ('demo', 'quickbooks')),
      client_id text NOT NULL CONSTRAINT review_decisions_client_id_ck CHECK (client_id ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
      finding_id text NOT NULL CONSTRAINT review_decisions_finding_id_ck CHECK (length(finding_id) BETWEEN 1 AND 300),
      fingerprint text NOT NULL CONSTRAINT review_decisions_fingerprint_ck CHECK (length(fingerprint) BETWEEN 1 AND 128),
      finding_type text NOT NULL CONSTRAINT review_decisions_finding_type_ck CHECK (finding_type IN ('duplicate', 'categorization', 'missing-info', 'unusual-amount', 'inconsistency', 'other')),
      issue text NOT NULL CONSTRAINT review_decisions_issue_ck CHECK (length(issue) BETWEEN 1 AND 200),
      description text NOT NULL CONSTRAINT review_decisions_description_ck CHECK (length(description) BETWEEN 1 AND 2000),
      priority text NOT NULL CONSTRAINT review_decisions_priority_ck CHECK (priority IN ('High', 'Medium', 'Low')),
      status text NOT NULL CONSTRAINT review_decisions_status_ck CHECK (status IN ('reviewing', 'dismissed', 'reopened')),
      reason text,
      actor_id text,
      actor_label text,
      created_at timestamptz NOT NULL DEFAULT now(),
      version integer NOT NULL CONSTRAINT review_decisions_version_ck CHECK (version > 0),
      CONSTRAINT review_decisions_dismissal_reason_ck CHECK (status <> 'dismissed' OR (reason IS NOT NULL AND length(btrim(reason)) > 0)),
      CONSTRAINT review_decisions_client_ownership_ck CHECK (
        (source = 'demo' AND client_id IN ('abc-plumbing', 'green-leaf-landscaping', 'smith-construction', 'johnson-dental', 'acme-consulting'))
        OR (source = 'quickbooks' AND client_id = 'quickbooks-sandbox')
      ),
      CONSTRAINT review_decisions_finding_version_uq UNIQUE (source, client_id, finding_id, version)
    );
    CREATE INDEX IF NOT EXISTS review_decisions_client_history
      ON review_decisions (source, client_id, created_at);
    DO $migration$
    BEGIN
      IF to_regprocedure('ledgerops_reject_review_decision_mutation()') IS NULL THEN
        EXECUTE $create_function$
          CREATE FUNCTION ledgerops_reject_review_decision_mutation() RETURNS trigger
          LANGUAGE plpgsql AS $function$
          BEGIN
            RAISE EXCEPTION 'review_decisions is append-only';
            RETURN OLD;
          END;
          $function$
        $create_function$;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'review_decisions'::regclass AND tgname = 'review_decisions_append_only'
      ) THEN
        EXECUTE 'CREATE TRIGGER review_decisions_append_only BEFORE UPDATE OR DELETE ON review_decisions FOR EACH ROW EXECUTE FUNCTION ledgerops_reject_review_decision_mutation()';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'review_decisions'::regclass AND tgname = 'review_decisions_truncate_guard'
      ) THEN
        EXECUTE 'CREATE TRIGGER review_decisions_truncate_guard BEFORE TRUNCATE ON review_decisions FOR EACH STATEMENT EXECUTE FUNCTION ledgerops_reject_review_decision_mutation()';
      END IF;
    END
    $migration$;
  `,
  validate: validateReviewDecisionSchema,
}
