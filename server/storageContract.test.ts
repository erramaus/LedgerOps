import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { ADDITIONAL_DEMO_CLIENT_IDS } from '../shared/demoCompanyBooks.js'
import { DEMO_CLIENT_ID } from '../shared/demoBooks.js'
import { buildAdditionalDemoMonthEndRecords, buildAdditionalDemoReconciliations, buildDemoMonthEndRecords, buildDemoReconciliations } from '../shared/demoMonthEnd.js'
import { MemoryDemoEntryStore, PostgresDemoEntryStore, type DemoEntryStore } from './demoEntryStore.js'
import { MemoryDemoJournalStore, PostgresDemoJournalStore, type DemoJournalStore } from './demoJournalStore.js'
import { MemoryDemoPaymentStore, PostgresDemoPaymentStore, type DemoPaymentStore } from './demoPaymentStore.js'
import { MemoryDemoResetRepository, PostgresDemoResetRepository, type DemoResetRepository } from './demoReset.js'
import { MemoryDemoWorkpaperStore, PostgresDemoWorkpaperStore, type DemoWorkpaperStore } from './demoWorkpaperStore.js'
import { MemoryMonthEndStore, PostgresMonthEndStore, type MonthEndStore } from './monthEndStore.js'
import { MemoryReconciliationStore, PostgresReconciliationStore, type ReconciliationStore } from './reconciliationStore.js'
import { STORE_TABLES, closeStore, createIsolatedSchema, decideFromEnvironment, type IsolatedSchema } from './testDatabase.js'
import { runMigrations } from './migrations.js'

type Stores = {
  entries: DemoEntryStore
  journals: DemoJournalStore
  payments: DemoPaymentStore
  workpapers: DemoWorkpaperStore
  reconciliations: ReconciliationStore
  monthEnd: MonthEndStore
}

interface Session {
  stores: Stores
  /** New store instances over the same storage, like a restarted server. */
  restart: () => Promise<Stores>
  resetRepository: () => DemoResetRepository
  schema?: IsolatedSchema
  close: () => Promise<void>
}

interface Backend {
  name: 'memory' | 'postgres'
  durable: boolean
  open: () => Promise<Session>
}

const memoryBackend: Backend = {
  name: 'memory',
  durable: false,
  async open() {
    const stores: Stores = {
      entries: new MemoryDemoEntryStore(),
      journals: new MemoryDemoJournalStore(),
      payments: new MemoryDemoPaymentStore(),
      workpapers: new MemoryDemoWorkpaperStore(),
      reconciliations: new MemoryReconciliationStore(),
      monthEnd: new MemoryMonthEndStore(),
    }
    return {
      stores,
      // A restarted memory server starts empty. That is the documented behaviour of these stores.
      restart: async () => ({
        entries: new MemoryDemoEntryStore(),
        journals: new MemoryDemoJournalStore(),
        payments: new MemoryDemoPaymentStore(),
        workpapers: new MemoryDemoWorkpaperStore(),
        reconciliations: new MemoryReconciliationStore(),
        monthEnd: new MemoryMonthEndStore(),
      }),
      resetRepository: () => new MemoryDemoResetRepository(stores),
      close: async () => {},
    }
  },
}

const decision = decideFromEnvironment()

function postgresStores(url: string): Stores {
  return {
    entries: new PostgresDemoEntryStore(url),
    journals: new PostgresDemoJournalStore(url),
    payments: new PostgresDemoPaymentStore(url),
    workpapers: new PostgresDemoWorkpaperStore(url),
    reconciliations: new PostgresReconciliationStore(url),
    monthEnd: new PostgresMonthEndStore(url),
  }
}

const postgresBackend: Backend = {
  name: 'postgres',
  durable: true,
  async open() {
    if (!decision.ok) throw new Error('PostgreSQL tests require a safe test database.')
    const schema = await createIsolatedSchema(decision.url)
    const migrationPool = new pg.Pool({ connectionString: schema.url, max: 1 })
    try {
      await runMigrations(migrationPool)
    } finally {
      await migrationPool.end()
    }
    const opened: Stores[] = []
    const repositories: PostgresDemoResetRepository[] = []
    const make = () => {
      const stores = postgresStores(schema.url)
      opened.push(stores)
      return stores
    }
    return {
      stores: make(),
      restart: async () => {
        // Closing the old pools first proves the data came from the database, not from an instance.
        for (const old of opened.splice(0)) for (const store of Object.values(old)) await closeStore(store)
        return make()
      },
      resetRepository: () => {
        const repository = new PostgresDemoResetRepository(schema.url)
        repositories.push(repository)
        return repository
      },
      schema,
      close: async () => {
        for (const stores of opened) for (const store of Object.values(stores)) await closeStore(store)
        for (const repository of repositories) await closeStore(repository)
        await schema.cleanup()
      },
    }
  },
}

const requirePostgres = process.env.LEDGEROPS_REQUIRE_POSTGRES === 'true'
const backends: Backend[] = requirePostgres
  ? decision.ok ? [postgresBackend] : []
  : [memoryBackend, ...(decision.ok ? [postgresBackend] : [])]

if (!decision.ok) {
  console.info(`[storage contract] PostgreSQL integration tests skipped: ${decision.reason}`)
}

const clientA = DEMO_CLIENT_ID
const clientB = ADDITIONAL_DEMO_CLIENT_IDS[0]
const stamp = (n: number) => `2026-01-${String(n).padStart(2, '0')}T10:00:00.000Z`

type Rec = { id: string; clientId: string; version: number; label: string }

interface SimpleKind {
  name: string
  make: (id: string, clientId: string, version: number, label?: string) => Rec
  store: (stores: Stores) => { list(clientId: string): Promise<unknown[]>; get(id: string): Promise<unknown>; put(record: never, expectedVersion: number): Promise<boolean>; deleteClients(ids: string[]): Promise<void> }
}

const simpleKinds: SimpleKind[] = [
  {
    name: 'demo entries',
    make: (id, clientId, version, label = 'original') => ({ id, clientId, version, label, status: 'posted', createdAt: stamp(1 + (Number(id.replace(/\D/g, '')) % 20)) }) as Rec,
    store: (stores) => stores.entries as never,
  },
  {
    name: 'demo journals',
    make: (id, clientId, version, label = 'original') => ({ id, clientId, version, label, status: 'posted', createdAt: stamp(1 + (Number(id.replace(/\D/g, '')) % 20)) }) as Rec,
    store: (stores) => stores.journals as never,
  },
  {
    name: 'demo payments',
    make: (id, clientId, version, label = 'original') => ({ id, clientId, version, label }),
    store: (stores) => stores.payments as never,
  },
  {
    name: 'demo workpapers',
    make: (id, clientId, version, label = 'original') => ({ id, clientId, version, label, createdAt: stamp(2), input: { period: '2026-01' } }) as Rec,
    store: (stores) => stores.workpapers as never,
  },
]

function monthEndRecord(id: string, source: 'demo' | 'quickbooks', clientId: string, version: number, label = 'original') {
  return { id, source, clientId, period: '2026-01', status: 'open', version, label } as never
}

function reconciliationRecord(id: string, source: 'demo' | 'quickbooks', clientId: string, version: number, label = 'original') {
  return { id, source, clientId, accountId: 'acct-1', periodEnd: '2026-01-31', status: 'in_progress', version, label } as never
}

let unique = 0
const uid = (prefix: string) => `${prefix}-${process.pid}-${Date.now().toString(36)}-${++unique}`

describe.each(backends)('storage contract: $name', (backend) => {
  async function withSession(run: (session: Session) => Promise<void>) {
    const session = await backend.open()
    try {
      await run(session)
    } finally {
      await session.close()
    }
  }

  describe.each(simpleKinds)('$name', (kind) => {
    it('creates, reads back and lists a record, and returns null for an unknown id', () =>
      withSession(async ({ stores }) => {
        const store = kind.store(stores)
        const record = kind.make(uid('r'), clientA, 1)
        expect(await store.put(record as never, 0)).toBe(true)
        expect(await store.get(record.id)).toMatchObject({ id: record.id, clientId: clientA, version: 1, label: 'original' })
        expect(await store.list(clientA)).toHaveLength(1)
        expect(await store.get('does-not-exist')).toBeNull()
      }))

    it('does not let a caller change stored data through a returned object', () =>
      withSession(async ({ stores }) => {
        const store = kind.store(stores)
        const record = kind.make(uid('r'), clientA, 1)
        await store.put(record as never, 0)
        const read = (await store.get(record.id)) as Rec
        read.label = 'tampered'
        expect(((await store.get(record.id)) as Rec).label).toBe('original')
        record.label = 'changed after save'
        expect(((await store.get(record.id)) as Rec).label).toBe('original')
      }))

    it('rejects creating a record whose id already exists and keeps the original', () =>
      withSession(async ({ stores }) => {
        const store = kind.store(stores)
        const id = uid('r')
        expect(await store.put(kind.make(id, clientA, 1, 'first') as never, 0)).toBe(true)
        expect(await store.put(kind.make(id, clientA, 1, 'second') as never, 0)).toBe(false)
        expect(((await store.get(id)) as Rec).label).toBe('first')
      }))

    it('updates with the matching version and rejects stale or impossible versions', () =>
      withSession(async ({ stores }) => {
        const store = kind.store(stores)
        const id = uid('r')
        await store.put(kind.make(id, clientA, 1) as never, 0)
        expect(await store.put(kind.make(id, clientA, 2, 'second') as never, 1)).toBe(true)
        // A second writer still holding version 1 must lose.
        expect(await store.put(kind.make(id, clientA, 2, 'stale writer') as never, 1)).toBe(false)
        // A write to a record that does not exist cannot use a non-zero version.
        const missingId = uid('missing')
        expect(await store.put(kind.make(missingId, clientA, 2) as never, 1)).toBe(false)
        expect(await store.get(missingId)).toBeNull()
        expect(await store.get(id)).toMatchObject({ version: 2, label: 'second' })
      }))

    it('lets exactly one of two simultaneous creates and one of two simultaneous updates win', () =>
      withSession(async ({ stores }) => {
        const store = kind.store(stores)
        const id = uid('r')
        const creates = await Promise.all([store.put(kind.make(id, clientA, 1, 'a') as never, 0), store.put(kind.make(id, clientA, 1, 'b') as never, 0)])
        expect(creates.filter(Boolean)).toHaveLength(1)
        const updates = await Promise.all([store.put(kind.make(id, clientA, 2, 'a') as never, 1), store.put(kind.make(id, clientA, 2, 'b') as never, 1)])
        expect(updates.filter(Boolean)).toHaveLength(1)
        expect(await store.get(id)).toMatchObject({ version: 2 })
      }))

    it('keeps clients isolated in list and deletes only the requested clients', () =>
      withSession(async ({ stores }) => {
        const store = kind.store(stores)
        const a = kind.make(uid('a'), clientA, 1)
        const b = kind.make(uid('b'), clientB, 1)
        const c = kind.make(uid('c'), ADDITIONAL_DEMO_CLIENT_IDS[1], 1)
        for (const record of [a, b, c]) await store.put(record as never, 0)
        expect((await store.list(clientA)).map((row) => (row as Rec).id)).toEqual([a.id])
        expect((await store.list(clientB)).map((row) => (row as Rec).id)).toEqual([b.id])
        await store.deleteClients([clientA, clientB])
        expect(await store.list(clientA)).toEqual([])
        expect(await store.list(clientB)).toEqual([])
        expect(await store.get(a.id)).toBeNull()
        expect(await store.get(c.id)).not.toBeNull()
        await expect(store.deleteClients([])).resolves.toBeUndefined()
      }))

    it(backend.durable ? 'keeps records after the store instances are recreated (simulated restart)' : 'starts empty after the store is recreated (not durable, as documented)', () =>
      withSession(async (session) => {
        const record = kind.make(uid('r'), clientA, 1)
        expect(session.stores.entries.durable).toBe(backend.durable)
        await kind.store(session.stores).put(record as never, 0)
        const restarted = await session.restart()
        const after = await kind.store(restarted).get(record.id)
        if (backend.durable) {
          expect(after).toMatchObject({ id: record.id, clientId: clientA, label: 'original' })
          expect(await kind.store(restarted).list(clientA)).toHaveLength(1)
          // A write after the restart still honours the stored version.
          expect(await kind.store(restarted).put(kind.make(record.id, clientA, 2, 'after restart') as never, 1)).toBe(true)
          expect(await kind.store(restarted).put(kind.make(record.id, clientA, 2, 'duplicate') as never, 0)).toBe(false)
        } else {
          expect(after).toBeNull()
        }
      }))

    it.skipIf(!backend.durable)('rejects a record the database cannot store and leaves nothing behind', () =>
      withSession(async ({ stores }) => {
        const store = kind.store(stores)
        const broken = { ...kind.make(uid('r'), clientA, 1), clientId: undefined }
        await expect(store.put(broken as never, 0)).rejects.toThrow()
        expect(await store.get(broken.id)).toBeNull()
        // The store keeps working after the failed write.
        expect(await store.put(kind.make(uid('ok'), clientA, 1) as never, 0)).toBe(true)
      }))
  })

  describe.each([
    {
      name: 'reconciliations',
      make: reconciliationRecord,
      store: (stores: Stores) => stores.reconciliations,
      deleteDemo: (stores: Stores, ids: string[]) => stores.reconciliations.deleteDemoClients(ids),
    },
    {
      name: 'month end',
      make: monthEndRecord,
      store: (stores: Stores) => stores.monthEnd,
      deleteDemo: (stores: Stores, ids: string[]) => stores.monthEnd.deleteDemoClients(ids),
    },
  ])('$name (source-scoped)', (kind) => {
    it('creates, reads, lists by source and client, and enforces versions', () =>
      withSession(async ({ stores }) => {
        const store = kind.store(stores)
        const id = uid('s')
        expect(await store.put(kind.make(id, 'demo', clientA, 1), 0)).toBe(true)
        expect(await store.put(kind.make(id, 'demo', clientA, 1, 'duplicate'), 0)).toBe(false)
        expect(await store.put(kind.make(id, 'demo', clientA, 2, 'second'), 1)).toBe(true)
        expect(await store.put(kind.make(id, 'demo', clientA, 2, 'stale'), 1)).toBe(false)
        expect(await store.get(id)).toMatchObject({ version: 2, label: 'second' })
        expect(await store.list({ source: 'demo', clientId: clientA })).toHaveLength(1)
        expect(await store.list({ source: 'demo', clientId: clientB })).toEqual([])
        expect(await store.list({ source: 'quickbooks', clientId: clientA })).toEqual([])
      }))

    it('never mixes demo and QuickBooks records, and demo deletion leaves QuickBooks records alone', () =>
      withSession(async ({ stores }) => {
        const store = kind.store(stores)
        const demoId = uid('d')
        const qbId = uid('q')
        const other = uid('o')
        await store.put(kind.make(demoId, 'demo', clientA, 1), 0)
        await store.put(kind.make(qbId, 'quickbooks', clientA, 1), 0)
        await store.put(kind.make(other, 'demo', clientB, 1), 0)
        expect((await store.list({ source: 'demo', clientId: clientA })).map((row) => row.id)).toEqual([demoId])
        expect((await store.list({ source: 'quickbooks', clientId: clientA })).map((row) => row.id)).toEqual([qbId])
        await kind.deleteDemo(stores, [clientA])
        expect(await store.get(demoId)).toBeNull()
        expect(await store.get(qbId)).not.toBeNull()
        expect(await store.get(other)).not.toBeNull()
      }))

    it('lets exactly one of two simultaneous updates win', () =>
      withSession(async ({ stores }) => {
        const store = kind.store(stores)
        const id = uid('s')
        await store.put(kind.make(id, 'demo', clientA, 1), 0)
        const results = await Promise.all([store.put(kind.make(id, 'demo', clientA, 2, 'a'), 1), store.put(kind.make(id, 'demo', clientA, 2, 'b'), 1)])
        expect(results.filter(Boolean)).toHaveLength(1)
      }))

    it(backend.durable ? 'keeps records after the store instances are recreated (simulated restart)' : 'starts empty after the store is recreated (not durable, as documented)', () =>
      withSession(async (session) => {
        const id = uid('s')
        await kind.store(session.stores).put(kind.make(id, 'demo', clientA, 1), 0)
        const restarted = await session.restart()
        const after = await kind.store(restarted).get(id)
        if (backend.durable) expect(after).toMatchObject({ id, source: 'demo', clientId: clientA })
        else expect(after).toBeNull()
      }))

    it.skipIf(!backend.durable)('rejects a record the database cannot store and leaves nothing behind', () =>
      withSession(async ({ stores }) => {
        const store = kind.store(stores)
        const id = uid('s')
        const broken = { ...(kind.make(id, 'demo', clientA, 1) as object), clientId: undefined } as never
        await expect(store.put(broken, 0)).rejects.toThrow()
        expect(await store.get(id)).toBeNull()
      }))
  })

  describe('demo reset', () => {
    const reconciliationSeeds = [...buildDemoReconciliations(), ...buildAdditionalDemoReconciliations()]
    const monthEndSeeds = [...buildDemoMonthEndRecords(), ...buildAdditionalDemoMonthEndRecords()]
    const clients = [clientA, ...ADDITIONAL_DEMO_CLIENT_IDS]

    async function populate(stores: Stores, clientIds: string[]) {
      for (const clientId of clientIds) {
        await stores.entries.put({ id: uid('e'), clientId, version: 1, status: 'posted', createdAt: stamp(3) } as never, 0)
        await stores.journals.put({ id: uid('j'), clientId, version: 1, status: 'posted', createdAt: stamp(3) } as never, 0)
        await stores.payments.put({ id: uid('p'), clientId, version: 1 } as never, 0)
        await stores.workpapers.put({ id: uid('w'), clientId, version: 1, createdAt: stamp(3), input: { period: '2026-01' } } as never, 0)
      }
    }

    const counts = async (stores: Stores, clientId: string) => ({
      entries: (await stores.entries.list(clientId)).length,
      journals: (await stores.journals.list(clientId)).length,
      payments: (await stores.payments.list(clientId)).length,
      workpapers: (await stores.workpapers.list(clientId)).length,
    })

    it('resets one company, restores its seed records, and leaves every other company and QuickBooks untouched', () =>
      withSession(async (session) => {
        const { stores } = session
        await populate(stores, clients)
        const qbId = uid('qb')
        await stores.reconciliations.put(reconciliationRecord(qbId, 'quickbooks', clientA, 1), 0)
        await stores.monthEnd.put(monthEndRecord(uid('qm'), 'quickbooks', clientA, 1), 0)
        const otherRecon = uid('other-recon')
        await stores.reconciliations.put(reconciliationRecord(otherRecon, 'demo', clientB, 1, 'edited by user'), 0)

        await session.resetRepository().reset([clientA])

        expect(await counts(stores, clientA)).toEqual({ entries: 0, journals: 0, payments: 0, workpapers: 0 })
        expect(await counts(stores, clientB)).toEqual({ entries: 1, journals: 1, payments: 1, workpapers: 1 })
        const demoRecons = await stores.reconciliations.list({ source: 'demo', clientId: clientA })
        expect(demoRecons.map((row) => row.id).sort()).toEqual(reconciliationSeeds.filter((seed) => seed.clientId === clientA).map((seed) => seed.id).sort())
        const demoMonthEnd = await stores.monthEnd.list({ source: 'demo', clientId: clientA })
        expect(demoMonthEnd.map((row) => row.id).sort()).toEqual(monthEndSeeds.filter((seed) => seed.clientId === clientA).map((seed) => seed.id).sort())
        expect(await stores.reconciliations.get(qbId)).not.toBeNull()
        expect((await stores.monthEnd.list({ source: 'quickbooks', clientId: clientA }))).toHaveLength(1)
        expect(await stores.reconciliations.get(otherRecon)).toMatchObject({ label: 'edited by user' })
      }))

    it('resets all five companies and a second reset gives the same result', () =>
      withSession(async (session) => {
        const { stores } = session
        await populate(stores, clients)
        await session.resetRepository().reset(clients)
        for (const clientId of clients) expect(await counts(stores, clientId)).toEqual({ entries: 0, journals: 0, payments: 0, workpapers: 0 })
        const first = (await Promise.all(clients.map((clientId) => stores.reconciliations.list({ source: 'demo', clientId })))).flat().map((row) => row.id).sort()
        expect(first).toEqual(reconciliationSeeds.map((seed) => seed.id).sort())
        await session.resetRepository().reset(clients)
        const second = (await Promise.all(clients.map((clientId) => stores.reconciliations.list({ source: 'demo', clientId })))).flat().map((row) => row.id).sort()
        expect(second).toEqual(first)
      }))

    it('rolls back completely when a seed record cannot be restored', () =>
      withSession(async (session) => {
        const { stores } = session
        await populate(stores, [clientA, clientB])
        const before = await counts(stores, clientA)
        // A QuickBooks record that already uses a seed id makes the seed insert fail after demo rows were deleted.
        const seed = reconciliationSeeds.find((item) => item.clientId === clientA)
        if (!seed) throw new Error('Expected a seed for the first demo company.')
        await stores.reconciliations.put(reconciliationRecord(seed.id, 'quickbooks', clientA, 1, 'must survive'), 0)

        await expect(session.resetRepository().reset([clientA])).rejects.toThrow()

        expect(await counts(stores, clientA)).toEqual(before)
        expect(await counts(stores, clientB)).toEqual({ entries: 1, journals: 1, payments: 1, workpapers: 1 })
        expect(await stores.reconciliations.get(seed.id)).toMatchObject({ source: 'quickbooks', label: 'must survive' })
        expect(await stores.reconciliations.list({ source: 'demo', clientId: clientA })).toEqual([])
        expect(await stores.monthEnd.list({ source: 'demo', clientId: clientA })).toEqual([])
      }))

    it.skipIf(!backend.durable)('keeps the reset result after the stores are recreated', () =>
      withSession(async (session) => {
        await populate(session.stores, [clientA])
        await session.resetRepository().reset([clientA])
        const restarted = await session.restart()
        expect(await counts(restarted, clientA)).toEqual({ entries: 0, journals: 0, payments: 0, workpapers: 0 })
        expect((await restarted.monthEnd.list({ source: 'demo', clientId: clientA })).length).toBe(monthEndSeeds.filter((seed) => seed.clientId === clientA).length)
      }))
  })
})

describe.skipIf(!decision.ok && !requirePostgres)('PostgreSQL isolation', () => {
  let probe: IsolatedSchema
  let before = ''

  beforeAll(async () => {
    if (!decision.ok) return
    probe = await createIsolatedSchema(decision.url)
    before = await probe.outsideSnapshot()
  })

  afterAll(async () => {
    if (probe) await probe.cleanup()
  })

  it('creates all store tables and migration ledger only inside the throwaway schema', async () => {
    const session = await postgresBackend.open()
    try {
      await Promise.all([
        session.stores.entries.list(clientA),
        session.stores.journals.list(clientA),
        session.stores.payments.list(clientA),
        session.stores.workpapers.list(clientA),
        session.stores.reconciliations.list({ source: 'demo', clientId: clientA }),
        session.stores.monthEnd.list({ source: 'demo', clientId: clientA }),
      ])
      await populateOne(session)
      expect(await session.schema?.ownTables()).toEqual([...STORE_TABLES, 'ledgerops_schema_migrations'].sort())
    } finally {
      await session.close()
    }
    expect(await probe.outsideSnapshot()).toBe(before)
  })

  async function populateOne(session: Session) {
    await session.stores.entries.put({ id: uid('iso'), clientId: clientA, version: 1, status: 'posted', createdAt: stamp(4) } as never, 0)
  }
})
