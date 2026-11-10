import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = resolve('scripts', 'sanitize-postgres-vitest-report.mjs')

describe('PostgreSQL CI report sanitizer', () => {
  it('exports only allowlisted metadata without credentials or failure messages', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ledgerops-report-test-'))
    try {
      const input = join(directory, 'input.json')
      const output = join(directory, 'output.json')
      const secret = 'private-password-and-connection-url'
      writeFileSync(input, JSON.stringify({
        numPassedTests: 1,
        numFailedTests: 1,
        numPendingTests: 0,
        secret,
        testResults: [{
          name: `/private/${secret}/migrations.test.ts`,
          status: 'failed',
          message: secret,
          assertionResults: [
            { status: 'passed', title: secret },
            { status: 'failed', failureMessages: [secret] },
          ],
        }],
      }))
      execFileSync(process.execPath, [script, input, output])
      const sanitized = readFileSync(output, 'utf8')
      expect(sanitized).not.toContain(secret)
      expect(JSON.parse(sanitized)).toEqual({
        passed: 1,
        failed: 1,
        pending: 0,
        suites: [{
          file: 'migrations.test.ts',
          status: 'failed',
          tests: [{ index: 1, status: 'passed' }, { index: 2, status: 'failed' }],
        }],
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('fails closed without producing an artifact when the input is invalid', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ledgerops-report-test-'))
    try {
      const input = join(directory, 'input.json')
      const output = join(directory, 'output.json')
      writeFileSync(input, '{"numFailedTests":"secret"}')
      const result = spawnSync(process.execPath, [script, input, output], { encoding: 'utf8' })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('no report will be uploaded')
      expect(result.stderr).not.toContain('secret')
      expect(() => readFileSync(output)).toThrow()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
