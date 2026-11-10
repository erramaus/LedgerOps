import { readFile } from 'node:fs/promises'

const reportPath = process.argv[2]
if (!reportPath) {
  console.error('A Vitest JSON report path is required.')
  process.exit(1)
}

let report
try {
  report = JSON.parse(await readFile(reportPath, 'utf8'))
} catch {
  console.error('The Vitest JSON report is missing or invalid.')
  process.exit(1)
}

if (report.numFailedTests !== 0 || report.numPassedTests < 1) {
  console.error('PostgreSQL storage tests did not complete successfully.')
  process.exit(1)
}
if (report.numPendingTests !== 0) {
  console.error('PostgreSQL storage tests were skipped; refusing a partial result.')
  process.exit(1)
}

const assertions = (report.testResults ?? []).flatMap((result) => result.assertionResults ?? [])
const passed = (ancestor, title) => assertions.some((test) =>
  test.status === 'passed'
  && test.ancestorTitles?.includes('storage contract: postgres')
  && test.ancestorTitles?.includes(ancestor)
  && test.title === title)

const updateCases = [
  ['demo entries', 'updates with the matching version and rejects stale or impossible versions'],
  ['demo journals', 'updates with the matching version and rejects stale or impossible versions'],
  ['demo payments', 'updates with the matching version and rejects stale or impossible versions'],
  ['demo workpapers', 'updates with the matching version and rejects stale or impossible versions'],
  ['reconciliations (source-scoped)', 'creates, reads, lists by source and client, and enforces versions'],
  ['month end (source-scoped)', 'creates, reads, lists by source and client, and enforces versions'],
]

for (const [store, title] of updateCases) {
  if (!passed(store, title)) {
    console.error(`Required PostgreSQL update/version test did not pass for ${store}.`)
    process.exit(1)
  }
}

const restartTitle = 'keeps records after the store instances are recreated (simulated restart)'
for (const store of ['demo entries', 'demo journals', 'demo payments', 'demo workpapers', 'reconciliations (source-scoped)', 'month end (source-scoped)']) {
  if (!passed(store, restartTitle)) {
    console.error(`Required PostgreSQL persistence test did not pass for ${store}.`)
    process.exit(1)
  }
}

if (!passed('demo reset', 'rolls back completely when a seed record cannot be restored')) {
  console.error('The required PostgreSQL demo-reset rollback test did not pass.')
  process.exit(1)
}

const reviewStoreTests = [
  'keeps append-only decisions across recreated store instances and enforces client/source isolation',
  'serializes competing writes and rejects stale concurrent versions',
  'rejects invalid client identifiers at the database boundary',
]
for (const title of reviewStoreTests) {
  if (!assertions.some((test) =>
    test.status === 'passed'
    && test.ancestorTitles?.includes('PostgreSQL review decision store')
    && test.title === title)) {
    console.error(`Required PostgreSQL review-decision test did not pass: ${title}.`)
    process.exit(1)
  }
}

const migrationTests = [
  'keeps production readiness checks read-only when migration history is absent',
  'creates the baseline schema on an empty schema and is idempotent',
  'diagnoses a SQL failure with its migration and SQLSTATE, then rolls back',
  'rolls back successful diagnostic migration execution without creating tables',
  'detects an altered checksum for an already-applied migration without changing the schema',
  'detects an altered checksum for migration 002 without changing its schema',
  'serializes concurrent migration processes using the database advisory lock',
  'adopts compatible legacy tables and preserves records',
  'rejects an incompatible existing table without altering it or recording the baseline',
  'rejects a compatible-looking table with a missing required index without adding it',
  'rejects an incompatible migration tracking table without changing it',
  'rejects an incompatible pre-existing review decision table without altering it',
]
for (const title of migrationTests) {
  if (!assertions.some((test) =>
    test.status === 'passed'
    && test.ancestorTitles?.includes('PostgreSQL versioned migrations')
    && test.title === title)) {
    console.error(`Required PostgreSQL migration test did not pass: ${title}.`)
    process.exit(1)
  }
}

console.log(`Verified ${report.numPassedTests} PostgreSQL storage, migration, and review-decision tests passed with no skips.`)
