import pg from 'pg'
import type { MonthEndRecord, Source } from '../shared/monthEnd.js'

export interface MonthEndStore {
  /** False means records vanish when the server restarts (development only). */
  readonly durable: boolean
  list(filter: { source: Source; clientId: string }): Promise<MonthEndRecord[]>
  get(id: string): Promise<MonthEndRecord | null>
  /** Writes only if the stored version equals `expectedVersion` (0 means the record must not exist yet). */
  put(record: MonthEndRecord, expectedVersion: number): Promise<boolean>
}

export class MemoryMonthEndStore implements MonthEndStore {
  readonly durable = false
  private records = new Map<string, MonthEndRecord>()

  async list({ source, clientId }: { source: Source; clientId: string }) {
    return [...this.records.values()].filter((record) => record.source === source && record.clientId === clientId).map((record) => structuredClone(record))
  }

  async get(id: string) {
    const record = this.records.get(id)
    return record ? structuredClone(record) : null
  }

  async put(record: MonthEndRecord, expectedVersion: number) {
    const current = this.records.get(record.id)
    if ((current?.version ?? 0) !== expectedVersion) return false
    this.records.set(record.id, structuredClone(record))
    return true
  }
}

/** Its own table in the same database as the reconciliation records; independent of the session store. */
export class PostgresMonthEndStore implements MonthEndStore {
  readonly durable = true
  private pool: pg.Pool
  private ready?: Promise<unknown>

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
    this.pool.on('error', (error) => console.error('[month-end store] idle connection error:', error.message))
  }

  private ensureTable() {
    this.ready ??= this.pool
      .query(`CREATE TABLE IF NOT EXISTS month_end_records (
        id text PRIMARY KEY, source text NOT NULL, client_id text NOT NULL, period text NOT NULL,
        status text NOT NULL, version integer NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`)
      .then(() => this.pool.query('CREATE INDEX IF NOT EXISTS month_end_records_lookup ON month_end_records (source, client_id, period)'))
      .catch((error) => {
        this.ready = undefined
        throw error
      })
    return this.ready
  }

  async list({ source, clientId }: { source: Source; clientId: string }) {
    await this.ensureTable()
    const result = await this.pool.query('SELECT data FROM month_end_records WHERE source = $1 AND client_id = $2 ORDER BY period DESC', [source, clientId])
    return result.rows.map((row) => row.data as MonthEndRecord)
  }

  async get(id: string) {
    await this.ensureTable()
    const result = await this.pool.query('SELECT data FROM month_end_records WHERE id = $1', [id])
    return (result.rows[0]?.data as MonthEndRecord | undefined) ?? null
  }

  async put(record: MonthEndRecord, expectedVersion: number) {
    await this.ensureTable()
    const values = [record.id, record.source, record.clientId, record.period, record.status, record.version, JSON.stringify(record)]
    if (expectedVersion === 0) {
      const inserted = await this.pool.query('INSERT INTO month_end_records (id, source, client_id, period, status, version, data) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING', values)
      return inserted.rowCount === 1
    }
    const updated = await this.pool.query('UPDATE month_end_records SET status = $5, version = $6, data = $7, updated_at = now() WHERE id = $1 AND version = $8', [values[0], values[1], values[2], values[3], values[4], values[5], values[6], expectedVersion])
    return updated.rowCount === 1
  }
}
