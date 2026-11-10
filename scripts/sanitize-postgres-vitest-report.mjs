import { readFile, writeFile } from 'node:fs/promises'

const [inputPath, outputPath] = process.argv.slice(2)
const allowedFiles = [
  'storageContract.test.ts',
  'migrations.test.ts',
  'migrationDiagnostic.test.ts',
  'postgresReportSanitizer.test.ts',
  'reviewDecisionStore.test.ts',
  'reviewDecisions.test.ts',
]
const allowedStatuses = new Set(['passed', 'failed', 'pending', 'skipped', 'todo'])

function safeStatus(status) {
  return allowedStatuses.has(status) ? status : 'unknown'
}

function count(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid count')
  return value
}

try {
  if (!inputPath || !outputPath || inputPath === outputPath) throw new Error('Invalid paths')
  const report = JSON.parse(await readFile(inputPath, 'utf8'))
  if (!Array.isArray(report.testResults)) throw new Error('Invalid test results')

  const safeReport = {
    passed: count(report.numPassedTests),
    failed: count(report.numFailedTests),
    pending: count(report.numPendingTests),
    suites: report.testResults.map((suite) => {
      if (!suite || typeof suite.name !== 'string' || !Array.isArray(suite.assertionResults)) {
        throw new Error('Invalid test suite')
      }
      const filename = suite.name.replaceAll('\\', '/').split('/').pop()
      return {
        file: allowedFiles.includes(filename) ? filename : 'unknown',
        status: safeStatus(suite.status),
        tests: suite.assertionResults.map((test, index) => ({
          index: index + 1,
          status: safeStatus(test?.status),
        })),
      }
    }),
  }
  await writeFile(outputPath, `${JSON.stringify(safeReport, null, 2)}\n`, { mode: 0o600 })
  console.log('Prepared a failure report containing only allowlisted filenames, test positions, statuses, and counts.')
} catch {
  console.error('Unable to prepare a safe PostgreSQL test report; no report will be uploaded.')
  process.exitCode = 1
}
