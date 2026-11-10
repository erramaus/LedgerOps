import { afterEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { ADDITIONAL_DEMO_CLIENT_IDS } from '../shared/demoCompanyBooks.js'
import { DEMO_CLIENT_ID } from '../shared/demoBooks.js'
import { runMigrations } from './migrations.js'
import { createIsolatedSchema, decideFromEnvironment, type IsolatedSchema } from './testDatabase.js'
import {
  MemoryReviewDecisionStore,
  PostgresReviewDecisionStore,
  type ReviewDecisionRecord,
  type ReviewDecisionStore,
} from './reviewDecisionStore.js'

const decision = (overrides: Partial<ReviewDecisionRecord> = {}): ReviewDecisionRecord => ({
  id: '32bb5e42-c1aa-45b0-a077-4e27f51af5cf',
  source: 'demo',
  clientId: DEMO_CLIENT_ID,
  clientName: 'ABC Plumbing',
  findingId: 'finding-1',
  findingType: 'categorization',
  issue: 'Missing category',
  description: 'Transaction has no category.',
  priority: 'Medium',
  status: 'reviewing',
  at: '2026-11-09T12:00:00.000Z',
  fingerprint: 'fp-1',
  version: 1,
  ...overrides,
})

async function exerciseLifecycle(store: ReviewDecisionStore) {
  const first = decision()
  expect(await store.append(first, 0)).toBe(true)
  const otherClient = decision({
    id: '90d44a76-c070-47a2-8b26-48fa8d6634b5',
    clientId: ADDITIONAL_DEMO_CLIENT_IDS[0],
    clientName: 'Green Leaf Landscaping',
  })
  expect(await store.append(otherClient, 0)).toBe(true)
  const quickbooks = decision({
    id: '50a184f1-7389-465e-baf1-0fd17d29d805',
    source: 'quickbooks',
    clientId: 'quickbooks-sandbox',
    clientName: 'QuickBooks Sandbox',
  })
  expect(await store.append(quickbooks, 0)).toBe(true)
  expect(await store.append(decision({ id: '4bf622d9-e8c2-42d7-a945-0c1cfad53567', version: 1 }), 0)).toBe(false)
  expect(await store.append(decision({ id: '4bf622d9-e8c2-42d7-a945-0c1cfad53567', version: 3 }), 1)).toBe(false)
  const dismissed = decision({
    id: '4bf622d9-e8c2-42d7-a945-0c1cfad53567',
    status: 'dismissed',
    reason: 'Reviewed source receipt.',
    at: '2026-11-09T12:01:00.000Z',
    version: 2,
  })
  expect(await store.append(dismissed, 1)).toBe(true)
  const reopened = decision({
    id: '7489607f-e3f1-48f2-a8db-9ef55b053849',
    status: 'reopened',
    reason: undefined,
    at: '2026-11-09T12:02:00.000Z',
    version: 3,
  })
  expect(await store.append(reopened, 2)).toBe(true)
  expect((await store.list('demo', DEMO_CLIENT_ID)).map(({ status, version }) => ({ status, version }))).toEqual([
    { status: 'reopened', version: 3 },
    { status: 'dismissed', version: 2 },
    { status: 'reviewing', version: 1 },
  ])
  expect(await store.list('demo', ADDITIONAL_DEMO_CLIENT_IDS[0])).toMatchObject([{ findingId: 'finding-1', version: 1 }])
  expect(await store.list('quickbooks')).toMatchObject([{ findingId: 'finding-1', version: 1 }])
}

describe('memory review decision store', () => {
  it('preserves append-only lifecycle history and rejects stale versions', async () => {
    await exerciseLifecycle(new MemoryReviewDecisionStore())
  })
})

const database = decideFromEnvironment()
const skipReason = database.ok ? undefined : `PostgreSQL review decision tests skipped: ${database.reason}`
const activeSchemas = new Set<{ schema: IsolatedSchema; pools: pg.Pool[]; stores: PostgresReviewDecisionStore[] }>()

async function openPostgresStore() {
  if (!database.ok) throw new Error('Review decision integration tests require a safe test database.')
  const schema = await createIsolatedSchema(database.url)
  const migrationPool = new pg.Pool({ connectionString: schema.url, max: 1 })
  try {
    await runMigrations(migrationPool)
  } catch (error) {
    await schema.cleanup()
    throw error
  } finally {
    await migrationPool.end()
  }
  const pools: pg.Pool[] = []
  const stores: PostgresReviewDecisionStore[] = []
  const store = () => {
    const opened = new PostgresReviewDecisionStore(schema.url)
    stores.push(opened)
    return opened
  }
  const admin = new pg.Pool({ connectionString: schema.url, max: 1 })
  pools.push(admin)
  const session = { schema, pools, stores, store, admin }
  activeSchemas.add(session)
  return session
}

afterEach(async () => {
  for (const session of activeSchemas) {
    for (const store of session.stores) await store.close()
    for (const pool of session.pools) await pool.end()
    await session.schema.cleanup()
    activeSchemas.delete(session)
  }
})

describe.skipIf(!database.ok)('PostgreSQL review decision store', () => {
  it('keeps append-only decisions across recreated store instances and enforces client/source isolation', async () => {
    const session = await openPostgresStore()
    const first = session.store()
    await exerciseLifecycle(first)
    await first.close()
    session.stores.splice(session.stores.indexOf(first), 1)

    const restarted = session.store()
    expect(await restarted.list('demo', DEMO_CLIENT_ID)).toHaveLength(3)
    expect(await restarted.list('demo', ADDITIONAL_DEMO_CLIENT_IDS[0])).toHaveLength(1)
    expect(await restarted.list('quickbooks')).toHaveLength(1)
    expect(await session.admin.query(`SELECT count(*)::int AS count FROM review_decisions`)).resolves.toMatchObject({ rows: [{ count: 5 }] })
    await expect(session.admin.query(`UPDATE review_decisions SET status = 'reopened' WHERE id = $1`, [decision().id])).rejects.toThrow(/append-only/)
    await expect(session.admin.query(`DELETE FROM review_decisions WHERE id = $1`, [decision().id])).rejects.toThrow(/append-only/)
    await expect(session.admin.query('TRUNCATE review_decisions')).rejects.toThrow(/append-only/)
    expect((await restarted.list('demo', DEMO_CLIENT_ID)).map((item) => item.status)).toContain('reviewing')
  })

  it('serializes competing writes and rejects stale concurrent versions', async () => {
    const session = await openPostgresStore()
    const first = session.store()
    const second = session.store()
    const initial = decision()
    expect(await first.append(initial, 0)).toBe(true)
    const candidates = [
      decision({ id: '4bf622d9-e8c2-42d7-a945-0c1cfad53567', status: 'dismissed', reason: 'Reviewed.', version: 2 }),
      decision({ id: '7489607f-e3f1-48f2-a8db-9ef55b053849', status: 'reopened', version: 2 }),
    ]
    const results = await Promise.all([first.append(candidates[0], 1), second.append(candidates[1], 1)])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await first.list('demo', DEMO_CLIENT_ID)).toHaveLength(2)
  })

  it('rejects invalid client identifiers at the database boundary', async () => {
    const session = await openPostgresStore()
    await expect(session.store().append(decision({ clientId: 'not a client' }), 0)).rejects.toThrow()
    await expect(session.store().append(decision({ status: 'dismissed', reason: '' }), 0)).rejects.toThrow()
    expect((await session.admin.query('SELECT count(*)::int AS count FROM review_decisions')).rows[0].count).toBe(0)
  })
})
