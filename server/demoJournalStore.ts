import pg from 'pg'
import type { DemoJournalRecord } from '../shared/demoJournalEntries.js'

export interface DemoJournalStore {
  readonly durable: boolean
  list(clientId: string): Promise<DemoJournalRecord[]>
  get(id: string): Promise<DemoJournalRecord | null>
  deleteClients(clientIds: string[]): Promise<void>
  put(record: DemoJournalRecord, expectedVersion: number): Promise<boolean>
}

export class MemoryDemoJournalStore implements DemoJournalStore {
  readonly durable = false
  private records = new Map<string, DemoJournalRecord>()

  async list(clientId: string) {
    return [...this.records.values()]
      .filter((record) => record.clientId === clientId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map((record) => structuredClone(record))
  }

  async get(id: string) {
    const record = this.records.get(id)
    return record ? structuredClone(record) : null
  }

  async put(record: DemoJournalRecord, expectedVersion: number) {
    if ((this.records.get(record.id)?.version ?? 0) !== expectedVersion) return false
    this.records.set(record.id, structuredClone(record))
    return true
  }

  async deleteClients(clientIds: string[]) {
    const ids = new Set(clientIds)
    for (const [id, record] of this.records) if (ids.has(record.clientId)) this.records.delete(id)
  }
}

export class PostgresDemoJournalStore implements DemoJournalStore {
  readonly durable = true
  private pool: pg.Pool
  private ready?: Promise<unknown>

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
    this.pool.on('error', (error) => console.error('[demo journal store] idle connection error:', error.message))
  }

  private ensureTable() {
    this.ready ??= this.pool
      .query(`CREATE TABLE IF NOT EXISTS demo_journals (
        id text PRIMARY KEY, client_id text NOT NULL, status text NOT NULL, version integer NOT NULL,
        created_at timestamptz NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`)
      .then(() => this.pool.query('CREATE INDEX IF NOT EXISTS demo_journals_client ON demo_journals (client_id, created_at)'))
      .catch((error) => {
        this.ready = undefined
        throw error
      })
    return this.ready
  }

  async list(clientId: string) {
    await this.ensureTable()
    const result = await this.pool.query('SELECT data FROM demo_journals WHERE client_id = $1 ORDER BY created_at, id', [clientId])
    return result.rows.map((row) => row.data as DemoJournalRecord)
  }

  async get(id: string) {
    await this.ensureTable()
    const result = await this.pool.query('SELECT data FROM demo_journals WHERE id = $1', [id])
    return (result.rows[0]?.data as DemoJournalRecord | undefined) ?? null
  }

  async put(record: DemoJournalRecord, expectedVersion: number) {
    await this.ensureTable()
    const values = [record.id, record.clientId, record.status, record.version, record.createdAt, JSON.stringify(record)]
    if (expectedVersion === 0) {
      const inserted = await this.pool.query('INSERT INTO demo_journals (id, client_id, status, version, created_at, data) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING', values)
      return inserted.rowCount === 1
    }
    const updated = await this.pool.query('UPDATE demo_journals SET status = $3, version = $4, data = $6, updated_at = now() WHERE id = $1 AND version = $7', [...values, expectedVersion])
    return updated.rowCount === 1
  }

  async deleteClients(clientIds: string[]) {
    await this.ensureTable()
    await this.pool.query('DELETE FROM demo_journals WHERE client_id = ANY($1::text[])', [clientIds])
  }
}
