import { describe, expect, it } from 'vitest'
import { DEMO_CLIENT_ID } from './demoBooks.js'
import { createWorkpaperRecord, updateWorkpaperRecord, validateWorkpaperInput } from './demoWorkpapers.js'

const input = {
  title: 'August utilities review',
  period: '2026-08',
  accountId: 'utilities',
  note: 'Compared the utilities expense to the vendor invoice and August statement.',
  supportingDocumentRefs: ['INV-UTIL-08'],
  reconciliationLinks: ['checking-2026-08'],
  adjustingEntryIds: ['journal-1'],
  reviewStatus: 'Prepared' as const,
  preparedBy: 'Pat',
  reviewedBy: '',
  workDate: '2026-08-31',
}

describe('demo workpapers', () => {
  it('validates required fields and known accounts', () => {
    expect(validateWorkpaperInput({ ...input, title: '', accountId: '', workDate: 'bad-date' }, undefined, DEMO_CLIENT_ID)).toMatchObject({
      title: 'Enter a workpaper title.',
      accountId: 'Choose an account.',
      workDate: 'Enter a valid workpaper date.',
    })
  })

  it('records history for preparation and review', () => {
    const created = createWorkpaperRecord('w1', DEMO_CLIENT_ID, input, 'pat@example.com', '2026-10-15T12:00:00.000Z')
    expect(created.history).toHaveLength(1)
    const reviewed = updateWorkpaperRecord(created, { ...input, reviewStatus: 'Reviewed', reviewedBy: 'Morgan' }, 'morgan@example.com', '2026-10-15T12:10:00.000Z')
    expect(reviewed.history.at(-1)).toMatchObject({ action: 'reviewed', by: 'morgan@example.com' })
  })
})
