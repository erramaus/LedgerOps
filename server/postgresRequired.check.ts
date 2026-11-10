import { decideFromEnvironment } from './testDatabase.js'

const decision = decideFromEnvironment()

if (!decision.ok) {
  console.error(`PostgreSQL integration tests cannot run: ${decision.reason}`)
  process.exitCode = 1
} else {
  console.log('A safe, explicitly configured local PostgreSQL test database is available.')
}
