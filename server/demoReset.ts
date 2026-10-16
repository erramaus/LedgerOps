import express, { type Request, type Response } from 'express'
import pg from 'pg'
import { DEMO_RESET_CLIENTS } from '../shared/demoReset.js'
import { buildAdditionalDemoMonthEndRecords, buildAdditionalDemoReconciliations, buildDemoMonthEndRecords, buildDemoReconciliations } from '../shared/demoMonthEnd.js'
import type { DemoEntryStore } from './demoEntryStore.js'
import type { DemoPaymentStore } from './demoPaymentStore.js'
import type { MonthEndStore } from './monthEndStore.js'
import type { ReconciliationStore } from './reconciliationStore.js'

const validClientIds = new Set(DEMO_RESET_CLIENTS.map((client) => client.id))
const reconciliationSeeds = [...buildDemoReconciliations(), ...buildAdditionalDemoReconciliations()]
const monthEndSeeds = [...buildDemoMonthEndRecords(), ...buildAdditionalDemoMonthEndRecords()]

type ResetStores = {
  entries: DemoEntryStore
  payments: DemoPaymentStore
  reconciliations: ReconciliationStore
  monthEnd: MonthEndStore
}

export interface DemoResetRepository {
  reset(clientIds: string[]): Promise<void>
}

export class MemoryDemoResetRepository implements DemoResetRepository {
  constructor(private readonly stores: ResetStores, private readonly beforeSeed?: () => void) {}

  async reset(clientIds: string[]) {
    const snapshots = await Promise.all(clientIds.map(async (clientId) => ({
      clientId,
      entries: await this.stores.entries.list(clientId),
      payments: await this.stores.payments.list(clientId),
      reconciliations: await this.stores.reconciliations.list({ source: 'demo', clientId }),
      monthEnd: await this.stores.monthEnd.list({ source: 'demo', clientId }),
    })))
    try {
      await this.deleteClients(clientIds)
      this.beforeSeed?.()
      for (const record of reconciliationSeeds.filter((item) => clientIds.includes(item.clientId))) {
        if (!await this.stores.reconciliations.put(record, 0)) throw new Error('Unable to restore demo reconciliation fixtures.')
      }
      for (const record of monthEndSeeds.filter((item) => clientIds.includes(item.clientId))) {
        if (!await this.stores.monthEnd.put(record, 0)) throw new Error('Unable to restore demo Month End fixtures.')
      }
    } catch (error) {
      await this.deleteClients(clientIds)
      for (const snapshot of snapshots) {
        for (const record of snapshot.entries) await this.stores.entries.put(record, 0)
        for (const book of snapshot.payments) await this.stores.payments.put(book, 0)
        for (const record of snapshot.reconciliations) await this.stores.reconciliations.put(record, 0)
        for (const record of snapshot.monthEnd) await this.stores.monthEnd.put(record, 0)
      }
      throw error
    }
  }

  private async deleteClients(clientIds: string[]) {
    await Promise.all([
      this.stores.entries.deleteClients(clientIds),
      this.stores.payments.deleteClients(clientIds),
      this.stores.reconciliations.deleteDemoClients(clientIds),
      this.stores.monthEnd.deleteDemoClients(clientIds),
    ])
  }
}

export class PostgresDemoResetRepository implements DemoResetRepository {
  private readonly pool: pg.Pool

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
    this.pool.on('error', (error) => console.error('[demo reset] idle connection error:', error.message))
  }

  async reset(clientIds: string[]) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`CREATE TABLE IF NOT EXISTS demo_entries (
        id text PRIMARY KEY, client_id text NOT NULL, status text NOT NULL, version integer NOT NULL,
        created_at timestamptz NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`)
      await client.query(`CREATE TABLE IF NOT EXISTS demo_payment_books (
        id text PRIMARY KEY, client_id text NOT NULL, version integer NOT NULL,
        data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`)
      await client.query(`CREATE TABLE IF NOT EXISTS reconciliation_records (
        id text PRIMARY KEY, source text NOT NULL, client_id text NOT NULL, account_id text NOT NULL,
        period_end date NOT NULL, status text NOT NULL, version integer NOT NULL, data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now())`)
      await client.query(`CREATE TABLE IF NOT EXISTS month_end_records (
        id text PRIMARY KEY, source text NOT NULL, client_id text NOT NULL, period text NOT NULL,
        status text NOT NULL, version integer NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`)
      await client.query('DELETE FROM demo_entries WHERE client_id = ANY($1::text[])', [clientIds])
      await client.query('DELETE FROM demo_payment_books WHERE client_id = ANY($1::text[])', [clientIds])
      await client.query("DELETE FROM reconciliation_records WHERE source = 'demo' AND client_id = ANY($1::text[])", [clientIds])
      await client.query("DELETE FROM month_end_records WHERE source = 'demo' AND client_id = ANY($1::text[])", [clientIds])
      for (const record of reconciliationSeeds.filter((item) => clientIds.includes(item.clientId))) {
        await client.query(
          'INSERT INTO reconciliation_records (id, source, client_id, account_id, period_end, status, version, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [record.id, record.source, record.clientId, record.accountId, record.periodEnd, record.status, record.version, JSON.stringify(record)],
        )
      }
      for (const record of monthEndSeeds.filter((item) => clientIds.includes(item.clientId))) {
        await client.query(
          'INSERT INTO month_end_records (id, source, client_id, period, status, version, data) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [record.id, record.source, record.clientId, record.period, record.status, record.version, JSON.stringify(record)],
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

export function createDemoResetRouter(repository: DemoResetRepository) {
  const router = express.Router()
  router.post('/', async (request: Request, response: Response) => {
    const clientIds: unknown = request.body?.clientIds
    if (!Array.isArray(clientIds) || clientIds.length === 0 || clientIds.some((id) => typeof id !== 'string' || !validClientIds.has(id)) || new Set(clientIds).size !== clientIds.length) {
      return response.status(400).json({ error: 'Choose one or more valid demo clients to reset.' })
    }
    try {
      await repository.reset(clientIds)
      return response.json({ reset: clientIds })
    } catch {
      return response.status(500).json({ error: 'Demo data could not be reset. No changes were kept.' })
    }
  })
  return router
}
