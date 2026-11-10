import pg from 'pg'

export type ReviewSource = 'demo' | 'quickbooks'
export type FindingType = 'duplicate' | 'categorization' | 'missing-info' | 'unusual-amount' | 'inconsistency' | 'other'
export type ReviewDecisionStatus = 'reviewing' | 'dismissed' | 'reopened'
export type ReviewPriority = 'High' | 'Medium' | 'Low'

export type ReviewDecisionRecord = {
  id: string
  source: ReviewSource
  clientId: string
  clientName: string
  findingId: string
  findingType: FindingType
  issue: string
  description: string
  priority: ReviewPriority
  status: ReviewDecisionStatus
  reason?: string
  actorId?: string
  actor?: string
  at: string
  fingerprint: string
  version: number
}

export interface ReviewDecisionStore {
  readonly durable: boolean
  list(source: ReviewSource, clientId?: string): Promise<ReviewDecisionRecord[]>
  append(record: ReviewDecisionRecord, expectedVersion: number): Promise<boolean>
}

const findingKey = (record: Pick<ReviewDecisionRecord, 'source' | 'clientId' | 'findingId'>) =>
  `${record.source}:${record.clientId}:${record.findingId}`

export class MemoryReviewDecisionStore implements ReviewDecisionStore {
  readonly durable = false
  private records: ReviewDecisionRecord[] = []

  async list(source: ReviewSource, clientId?: string) {
    return this.records
      .filter((record) => record.source === source && (clientId === undefined || record.clientId === clientId))
      .sort((left, right) => right.at.localeCompare(left.at) || right.version - left.version)
      .map((record) => structuredClone(record))
  }

  async append(record: ReviewDecisionRecord, expectedVersion: number) {
    const currentVersion = this.records
      .filter((item) => findingKey(item) === findingKey(record))
      .reduce((latest, item) => Math.max(latest, item.version), 0)
    if (currentVersion !== expectedVersion || record.version !== expectedVersion + 1) return false
    this.records.push(structuredClone(record))
    return true
  }
}

export class PostgresReviewDecisionStore implements ReviewDecisionStore {
  readonly durable = true
  private pool: pg.Pool

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
    this.pool.on('error', (error) => console.error('[review decision store] idle connection error:', error.message))
  }

  async list(source: ReviewSource, clientId?: string) {
    const result = await this.pool.query(
      `SELECT id, source, client_id, finding_id, finding_type, issue, description, priority, status,
              reason, actor_id, actor_label, created_at, fingerprint, version
       FROM review_decisions
       WHERE source = $1 AND ($2::text IS NULL OR client_id = $2)
       ORDER BY created_at DESC, version DESC`,
      [source, clientId ?? null],
    )
    return result.rows.map((row): ReviewDecisionRecord => ({
      id: row.id,
      source: row.source,
      clientId: row.client_id,
      clientName: '',
      findingId: row.finding_id,
      findingType: row.finding_type,
      issue: row.issue,
      description: row.description,
      priority: row.priority,
      status: row.status,
      reason: row.reason ?? undefined,
      actorId: row.actor_id ?? undefined,
      actor: row.actor_label ?? undefined,
      at: new Date(row.created_at).toISOString(),
      fingerprint: row.fingerprint,
      version: row.version,
    }))
  }

  async append(record: ReviewDecisionRecord, expectedVersion: number) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
        `${record.source}:${record.clientId}`,
        record.findingId,
      ])
      const current = await client.query<{ version: number }>(
        `SELECT version FROM review_decisions
         WHERE source = $1 AND client_id = $2 AND finding_id = $3
         ORDER BY version DESC LIMIT 1`,
        [record.source, record.clientId, record.findingId],
      )
      const currentVersion = current.rows[0]?.version ?? 0
      if (currentVersion !== expectedVersion || record.version !== expectedVersion + 1) {
        await client.query('ROLLBACK')
        return false
      }
      await client.query(
        `INSERT INTO review_decisions
         (id, source, client_id, finding_id, fingerprint, finding_type, issue, description, priority,
          status, reason, actor_id, actor_label, created_at, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          record.id,
          record.source,
          record.clientId,
          record.findingId,
          record.fingerprint,
          record.findingType,
          record.issue,
          record.description,
          record.priority,
          record.status,
          record.reason ?? null,
          record.actorId ?? null,
          record.actor ?? null,
          record.at,
          record.version,
        ],
      )
      await client.query('COMMIT')
      return true
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Review decision write failed and PostgreSQL did not confirm rollback.')
      }
      throw error
    } finally {
      client.release()
    }
  }

  async close() {
    await this.pool.end()
  }
}
