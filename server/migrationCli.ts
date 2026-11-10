import 'dotenv/config'
import pg from 'pg'
import { loadConfig } from './config.js'
import { assertMigrationExecutionPolicy, MigrationError, runMigrations } from './migrations.js'

async function main() {
  const config = loadConfig(process.env)
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) throw new MigrationError('DATABASE_URL is required to run migrations.')

  assertMigrationExecutionPolicy(config.app.production, process.argv, process.env)

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 })
  try {
    const applied = await runMigrations(pool)
    if (applied.length === 0) {
      console.log('Database schema is already current.')
    } else {
      console.log(`Applied migration version${applied.length === 1 ? '' : 's'}: ${applied.join(', ')}.`)
    }
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  if (error instanceof MigrationError) console.error(error.message)
  else console.error('Migration failed. Database error details and connection information are suppressed.')
  process.exitCode = 1
})
