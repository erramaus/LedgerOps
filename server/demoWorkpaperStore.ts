import pg from 'pg'
import type { DemoWorkpaperRecord } from '../shared/demoWorkpapers.js'

export interface DemoWorkpaperStore {
  readonly durable: boolean
  list(clientId: string): Promise<DemoWorkpaperRecord[]>
  get(id: string): Promise<DemoWorkpaperRecord | null>
  deleteClients(clientIds: string[]): Promise<void>
  put(record: DemoWorkpaperRecord, expectedVersion: number): Promise<boolean>
}

export class MemoryDemoWorkpaperStore implements DemoWorkpaperStore {
  readonly durable = false
  private records = new Map<string, DemoWorkpaperRecord>()

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

  async put(record: DemoWorkpaperRecord, expectedVersion: number) {
    if ((this.records.get(record.id)?.version ?? 0) !== expectedVersion) return false
    this.records.set(record.id, structuredClone(record))
    return true
  }

  async deleteClients(clientIds: string[]) {
    const ids = new Set(clientIds)
    for (const [id, record] of this.records) if (ids.has(record.clientId)) this.records.delete(id)
  }
}

export class PostgresDemoWorkpaperStore implements DemoWorkpaperStore {
  readonly durable = true
  private pool: pg.Pool
  private ready?: Promise<unknown>

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
    this.pool.on('error', (error) => console.error('[demo workpaper store] idle connection error:', error.message))
  }

  private ensureTable() {
    this.ready ??= this.pool
      .query(`CREATE TABLE IF NOT EXISTS demo_workpapers (
        id text PRIMARY KEY, client_id text NOT NULL, period text NOT NULL, version integer NOT NULL,
        created_at timestamptz NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`)
      .then(() => this.pool.query('CREATE INDEX IF NOT EXISTS demo_workpapers_client ON demo_workpapers (client_id, period, created_at)'))
      .catch((error) => {
        this.ready = undefined
        throw error
      })
    return this.ready
  }

  async list(clientId: string) {
    await this.ensureTable()
    const result = await this.pool.query('SELECT data FROM demo_workpapers WHERE client_id = $1 ORDER BY period DESC, created_at, id', [clientId])
    return result.rows.map((row) => row.data as DemoWorkpaperRecord)
  }

  async get(id: string) {
    await this.ensureTable()
    const result = await this.pool.query('SELECT data FROM demo_workpapers WHERE id = $1', [id])
    return (result.rows[0]?.data as DemoWorkpaperRecord | undefined) ?? null
  }

  async put(record: DemoWorkpaperRecord, expectedVersion: number) {
    await this.ensureTable()
    const values = [record.id, record.clientId, record.input.period, record.version, record.createdAt, JSON.stringify(record)]
    if (expectedVersion === 0) {
      const inserted = await this.pool.query('INSERT INTO demo_workpapers (id, client_id, period, version, created_at, data) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING', values)
      return inserted.rowCount === 1
    }
    const updated = await this.pool.query('UPDATE demo_workpapers SET period = $3, version = $4, data = $6, updated_at = now() WHERE id = $1 AND version = $7', [...values, expectedVersion])
    return updated.rowCount === 1
  }

  async deleteClients(clientIds: string[]) {
    await this.ensureTable()
    await this.pool.query('DELETE FROM demo_workpapers WHERE client_id = ANY($1::text[])', [clientIds])
  }
}
