import { describe, expect, it } from 'vitest'
import { evaluateTestDatabaseUrl } from './testDatabase.js'

const good = 'postgres://tester:secret@localhost:5432/ledgerops_test'

describe('test database safety guard', () => {
  it('accepts a local database whose name marks it as a test database', () => {
    expect(evaluateTestDatabaseUrl(good)).toEqual({ ok: true, url: good })
    expect(evaluateTestDatabaseUrl('postgresql://u:p@127.0.0.1:5433/test')).toMatchObject({ ok: true })
  })

  it('refuses when nothing is configured', () => {
    expect(evaluateTestDatabaseUrl(undefined)).toMatchObject({ ok: false })
    expect(evaluateTestDatabaseUrl('')).toMatchObject({ ok: false })
  })

  it.each([
    ['a hosted database', 'postgres://u:p@dpg-abc.oregon-postgres.render.com/ledgerops_test'],
    ['a remote host', 'postgres://u:p@10.0.0.5/ledgerops_test'],
    ['a development database name', 'postgres://u:p@localhost/ledgerops'],
    ['a name that only contains test inside a word', 'postgres://u:p@localhost/contest'],
    ['the default postgres database', 'postgres://u:p@localhost/postgres'],
    ['a non-postgres URL', 'mysql://u:p@localhost/ledgerops_test'],
    ['a missing database name', 'postgres://u:p@localhost'],
    ['a URL that sets its own options', 'postgres://u:p@localhost/ledgerops_test?options=-c%20search_path%3Dpublic'],
    ['garbage', 'not a url'],
  ])('refuses %s', (_label, value) => {
    expect(evaluateTestDatabaseUrl(value)).toMatchObject({ ok: false })
  })

  it('refuses the application database even when its name looks like a test database', () => {
    expect(evaluateTestDatabaseUrl(good, ['postgres://other:pw@LOCALHOST:5432/ledgerops_test'])).toMatchObject({ ok: false })
    expect(evaluateTestDatabaseUrl(good, ['postgres://other:pw@localhost:5432/ledgerops_dev'])).toMatchObject({ ok: true })
  })

  it('never includes credentials in a refusal reason', () => {
    for (const value of ['postgres://tester:secret@db.example.com/ledgerops_test', 'postgres://tester:secret@localhost/prod', good + 'x?options=a']) {
      const decision = evaluateTestDatabaseUrl(value)
      if (!decision.ok) {
        expect(decision.reason).not.toContain('secret')
        expect(decision.reason).not.toContain('tester')
      }
    }
  })
})
