import connectPgSimple from 'connect-pg-simple'
import session from 'express-session'
import pg from 'pg'

export function createPostgresSessionStore(databaseUrl: string): session.Store {
  const pool = new pg.Pool({ connectionString: databaseUrl })
  pool.on('error', (error) => console.error('[session store] idle connection error:', error.message))
  const PostgresStore = connectPgSimple(session)
  return new PostgresStore({ pool, tableName: 'user_sessions', createTableIfMissing: true })
}
