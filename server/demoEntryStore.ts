import pg from 'pg'
import type { DemoEntryRecord } from '../shared/demoEntries.js'

export interface DemoEntryStore {
  /** False means records vanish when the server restarts (development only). */
  readonly durable: boolean
  list(clientId: string): Promise<DemoEntryRecord[]>
  get(id: string): Promise<DemoEntryRecord | null>
  deleteClients(clientIds: string[]): Promise<void>
  /** Writes only if the stored version equals `expectedVersion` (0 means the record must not exist yet). */
  put(record: DemoEntryRecord, expectedVersion: number): Promise<boolean>
}

export class MemoryDemoEntryStore implements DemoEntryStore {
  readonly durable = false
  private records = new Map<string, DemoEntryRecord>()

  async list(clientId: string) {
    return [...this.records.values()].filter((record) => record.clientId === clientId).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)).map((record) => structuredClone(record))
  }

  async get(id: string) {
    const record = this.records.get(id)
    return record ? structuredClone(record) : null
  }

  async put(record: DemoEntryRecord, expectedVersion: number) {
    if ((this.records.get(record.id)?.version ?? 0) !== expectedVersion) return false
    this.records.set(record.id, structuredClone(record))
    return true
  }

  async deleteClients(clientIds: string[]) {
    const ids = new Set(clientIds)
    for (const [id, record] of this.records) if (ids.has(record.clientId)) this.records.delete(id)
  }
}

/** Its own table in the same database as the other LedgerOps records. */
export class PostgresDemoEntryStore implements DemoEntryStore {
  readonly durable = true
  private pool: pg.Pool

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
    this.pool.on('error', (error) => console.error('[demo entry store] idle connection error:', error.message))
  }

  async list(clientId: string) {
    const result = await this.pool.query('SELECT data FROM demo_entries WHERE client_id = $1 ORDER BY created_at, id', [clientId])
    return result.rows.map((row) => row.data as DemoEntryRecord)
  }

  async get(id: string) {
    const result = await this.pool.query('SELECT data FROM demo_entries WHERE id = $1', [id])
    return (result.rows[0]?.data as DemoEntryRecord | undefined) ?? null
  }

  async put(record: DemoEntryRecord, expectedVersion: number) {
    const values = [record.id, record.clientId, record.status, record.version, record.createdAt, JSON.stringify(record)]
    if (expectedVersion === 0) {
      const inserted = await this.pool.query('INSERT INTO demo_entries (id, client_id, status, version, created_at, data) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING', values)
      return inserted.rowCount === 1
    }
    const updated = await this.pool.query('UPDATE demo_entries SET status = $2, version = $3, data = $4, updated_at = now() WHERE id = $1 AND version = $5', [values[0], values[2], values[3], values[5], expectedVersion])
    return updated.rowCount === 1
  }

  async deleteClients(clientIds: string[]) {
    await this.pool.query('DELETE FROM demo_entries WHERE client_id = ANY($1::text[])', [clientIds])
  }
}
