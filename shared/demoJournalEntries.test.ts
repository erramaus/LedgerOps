import { describe, expect, it } from 'vitest'
import { balanceSheetSummary, profitAndLossSummary, trialBalance } from './accounting.js'
import { DEMO_CLIENT_ID, demoLedger } from './demoBooks.js'
import { createDraftJournalRecord, journalAccounts, mergeDemoJournals, postDraftJournalRecord, reverseJournalRecord, validateJournalInput } from './demoJournalEntries.js'

const depreciationInput = {
  date: '2026-08-31',
  description: 'Monthly depreciation',
  referenceNumber: 'ADJ-001',
  adjustmentType: 'Depreciation' as const,
  explanation: 'Month-end depreciation.',
  lines: [
    { accountId: 'depreciation-expense', debitCents: 25_000, creditCents: 0, memo: 'Expense' },
    { accountId: 'accumulated-depreciation', debitCents: 0, creditCents: 25_000, memo: 'Contra asset' },
  ],
}

describe('demo journal entries', () => {
  it('requires valid accounts, whole cents, and balanced debits and credits', () => {
    expect(validateJournalInput({ ...depreciationInput, lines: [{ accountId: '', debitCents: 100, creditCents: 0, memo: '' }] }, journalAccounts(), DEMO_CLIENT_ID)).toMatchObject({
      lines: 'Add at least two journal lines.',
      'line-0-accountId': 'Choose an account.',
      balance: 'Debits 100 and credits 0 must be equal.',
    })
    expect(validateJournalInput({ ...depreciationInput, lines: [{ accountId: 'depreciation-expense', debitCents: 100.5, creditCents: 0, memo: '' }, { accountId: 'accumulated-depreciation', debitCents: 0, creditCents: 100, memo: '' }] } as typeof depreciationInput, journalAccounts(), DEMO_CLIENT_ID)['line-0-debitCents']).toContain('whole cents')
  })

  it('keeps drafts out of the ledger and posts only after approval', () => {
    const draft = createDraftJournalRecord('j1', DEMO_CLIENT_ID, depreciationInput, 'pat@example.com', '2026-10-15T12:00:00.000Z')
    expect(mergeDemoJournals([draft]).entries).toEqual(demoLedger.entries)
    const posted = postDraftJournalRecord(draft, 'pat@example.com', '2026-10-15T12:05:00.000Z')
    const merged = mergeDemoJournals([posted])
    expect(merged.entries).toHaveLength(demoLedger.entries.length + 1)
    expect(trialBalance(merged.accounts, merged.entries, '2026-08-31').checks.find((check) => check.id === 'tb-balanced')?.status).toBe('pass')
  })

  it('updates financial statements and reverses with a separate posted journal', () => {
    const draft = createDraftJournalRecord('j1', DEMO_CLIENT_ID, depreciationInput, 'pat@example.com', '2026-10-15T12:00:00.000Z')
    const posted = postDraftJournalRecord(draft, 'pat@example.com', '2026-10-15T12:05:00.000Z')
    const beforeProfit = profitAndLossSummary(demoLedger.accounts, demoLedger.entries, '2026-08-01', '2026-08-31')
    const withJournal = mergeDemoJournals([posted])
    const afterProfit = profitAndLossSummary(withJournal.accounts, withJournal.entries, '2026-08-01', '2026-08-31')
    expect(afterProfit.expenseCents - beforeProfit.expenseCents).toBe(25_000)
    const beforeSheet = balanceSheetSummary(demoLedger.accounts, demoLedger.entries, '2026-08-31')
    const afterSheet = balanceSheetSummary(withJournal.accounts, withJournal.entries, '2026-08-31')
    expect(afterSheet.assetsCents).toBe(beforeSheet.assetsCents - 25_000)

    const reversed = reverseJournalRecord(posted, 'j2', 'pat@example.com', '2026-10-15T12:10:00.000Z', 'Booked in error')
    const backToBase = mergeDemoJournals([reversed.original, reversed.reversal])
    expect(profitAndLossSummary(backToBase.accounts, backToBase.entries, '2026-08-01', '2026-08-31')).toEqual(beforeProfit)
    expect(balanceSheetSummary(backToBase.accounts, backToBase.entries, '2026-08-31')).toEqual(beforeSheet)
  })

  it('keeps records isolated by client', () => {
    const abc = postDraftJournalRecord(createDraftJournalRecord('j-abc', DEMO_CLIENT_ID, depreciationInput, 'pat@example.com', '2026-10-15T12:00:00.000Z'), 'pat@example.com', '2026-10-15T12:01:00.000Z')
    const green = postDraftJournalRecord(createDraftJournalRecord('j-green', 'green-leaf-landscaping', depreciationInput, 'pat@example.com', '2026-10-15T12:00:00.000Z'), 'pat@example.com', '2026-10-15T12:01:00.000Z')
    expect(mergeDemoJournals([abc, green], demoLedger, DEMO_CLIENT_ID).entries.some((entry) => entry.id === 'j-green')).toBe(false)
  })
})
