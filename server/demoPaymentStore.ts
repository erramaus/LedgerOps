import pg from 'pg'
import type { DemoPaymentBook } from '../shared/demoPayments.js'

export interface DemoPaymentStore {
  readonly durable: boolean
  list(clientId: string): Promise<DemoPaymentBook[]>
  get(id: string): Promise<DemoPaymentBook | null>
  deleteClients(clientIds: string[]): Promise<void>
  /** Optimistic version write; expectedVersion 0 creates a new invoice/bill payment book. */
  put(book: DemoPaymentBook, expectedVersion: number): Promise<boolean>
}

export class MemoryDemoPaymentStore implements DemoPaymentStore {
  readonly durable = false
  private books = new Map<string, DemoPaymentBook>()

  async list(clientId: string) {
    return [...this.books.values()].filter((book) => book.clientId === clientId).sort((left, right) => left.id.localeCompare(right.id)).map((book) => structuredClone(book))
  }

  async get(id: string) {
    const book = this.books.get(id)
    return book ? structuredClone(book) : null
  }

  async put(book: DemoPaymentBook, expectedVersion: number) {
    if ((this.books.get(book.id)?.version ?? 0) !== expectedVersion) return false
    this.books.set(book.id, structuredClone(book))
    return true
  }

  async deleteClients(clientIds: string[]) {
    const ids = new Set(clientIds)
    for (const [id, book] of this.books) if (ids.has(book.clientId)) this.books.delete(id)
  }
}

export class PostgresDemoPaymentStore implements DemoPaymentStore {
  readonly durable = true
  private pool: pg.Pool
  private ready?: Promise<unknown>

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
    this.pool.on('error', (error) => console.error('[demo payment store] idle connection error:', error.message))
  }

  private ensureTable() {
    this.ready ??= this.pool
      .query(`CREATE TABLE IF NOT EXISTS demo_payment_books (
        id text PRIMARY KEY, client_id text NOT NULL, version integer NOT NULL,
        data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`)
      .then(() => this.pool.query('CREATE INDEX IF NOT EXISTS demo_payment_books_client ON demo_payment_books (client_id, id)'))
      .catch((error) => {
        this.ready = undefined
        throw error
      })
    return this.ready
  }

  async list(clientId: string) {
    await this.ensureTable()
    const result = await this.pool.query('SELECT data FROM demo_payment_books WHERE client_id = $1 ORDER BY id', [clientId])
    return result.rows.map((row) => row.data as DemoPaymentBook)
  }

  async get(id: string) {
    await this.ensureTable()
    const result = await this.pool.query('SELECT data FROM demo_payment_books WHERE id = $1', [id])
    return (result.rows[0]?.data as DemoPaymentBook | undefined) ?? null
  }

  async put(book: DemoPaymentBook, expectedVersion: number) {
    await this.ensureTable()
    const values = [book.id, book.clientId, book.version, JSON.stringify(book), expectedVersion]
    if (expectedVersion === 0) {
      const inserted = await this.pool.query('INSERT INTO demo_payment_books (id, client_id, version, data) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING', values.slice(0, 4))
      return inserted.rowCount === 1
    }
    const updated = await this.pool.query('UPDATE demo_payment_books SET version = $3, data = $4, updated_at = now() WHERE id = $1 AND version = $5', values)
    return updated.rowCount === 1
  }

  async deleteClients(clientIds: string[]) {
    await this.ensureTable()
    await this.pool.query('DELETE FROM demo_payment_books WHERE client_id = ANY($1::text[])', [clientIds])
  }
}
