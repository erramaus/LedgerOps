import pg from 'pg'
import type { ReconciliationRecord, Source } from '../shared/reconciliation.js'

export interface ReconciliationStore {
  /** False means records vanish when the server restarts (development only). */
  readonly durable: boolean
  list(filter: { source: Source; clientId: string }): Promise<ReconciliationRecord[]>
  get(id: string): Promise<ReconciliationRecord | null>
  deleteDemoClients(clientIds: string[]): Promise<void>
  /** Writes only if the stored version equals `expectedVersion` (0 means the record must not exist yet). */
  put(record: ReconciliationRecord, expectedVersion: number): Promise<boolean>
}

export class MemoryReconciliationStore implements ReconciliationStore {
  readonly durable = false
  private records = new Map<string, ReconciliationRecord>()

  async list({ source, clientId }: { source: Source; clientId: string }) {
    return [...this.records.values()].filter((record) => record.source === source && record.clientId === clientId).map((record) => structuredClone(record))
  }

  async get(id: string) {
    const record = this.records.get(id)
    return record ? structuredClone(record) : null
  }

  async put(record: ReconciliationRecord, expectedVersion: number) {
    const current = this.records.get(record.id)
    if ((current?.version ?? 0) !== expectedVersion) return false
    this.records.set(record.id, structuredClone(record))
    return true
  }

  async deleteDemoClients(clientIds: string[]) {
    const ids = new Set(clientIds)
    for (const [id, record] of this.records) if (record.source === 'demo' && ids.has(record.clientId)) this.records.delete(id)
  }
}

/** A dedicated table and pool; independent of the session store. */
export class PostgresReconciliationStore implements ReconciliationStore {
  readonly durable = true
  private pool: pg.Pool
  private ready?: Promise<unknown>

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
    this.pool.on('error', (error) => console.error('[reconciliation store] idle connection error:', error.message))
  }

  private ensureTable() {
    this.ready ??= this.pool
      .query(`CREATE TABLE IF NOT EXISTS reconciliation_records (
        id text PRIMARY KEY, source text NOT NULL, client_id text NOT NULL, account_id text NOT NULL,
        period_end date NOT NULL, status text NOT NULL, version integer NOT NULL, data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now())`)
      .then(() => this.pool.query('CREATE INDEX IF NOT EXISTS reconciliation_records_lookup ON reconciliation_records (source, client_id, account_id, period_end)'))
      .catch((error) => {
        this.ready = undefined
        throw error
      })
    return this.ready
  }

  async list({ source, clientId }: { source: Source; clientId: string }) {
    await this.ensureTable()
    const result = await this.pool.query('SELECT data FROM reconciliation_records WHERE source = $1 AND client_id = $2 ORDER BY period_end DESC', [source, clientId])
    return result.rows.map((row) => row.data as ReconciliationRecord)
  }

  async get(id: string) {
    await this.ensureTable()
    const result = await this.pool.query('SELECT data FROM reconciliation_records WHERE id = $1', [id])
    return (result.rows[0]?.data as ReconciliationRecord | undefined) ?? null
  }

  async put(record: ReconciliationRecord, expectedVersion: number) {
    await this.ensureTable()
    const values = [record.id, record.source, record.clientId, record.accountId, record.periodEnd, record.status, record.version, JSON.stringify(record)]
    if (expectedVersion === 0) {
      const inserted = await this.pool.query(
        'INSERT INTO reconciliation_records (id, source, client_id, account_id, period_end, status, version, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING',
        values,
      )
      return inserted.rowCount === 1
    }
    const updated = await this.pool.query(
      'UPDATE reconciliation_records SET status = $6, version = $7, data = $8, updated_at = now() WHERE id = $1 AND version = $9',
      [values[0], values[1], values[2], values[3], values[4], values[5], values[6], values[7], expectedVersion],
    )
    return updated.rowCount === 1
  }

  async deleteDemoClients(clientIds: string[]) {
    await this.ensureTable()
    await this.pool.query("DELETE FROM reconciliation_records WHERE source = 'demo' AND client_id = ANY($1::text[])", [clientIds])
  }
}
