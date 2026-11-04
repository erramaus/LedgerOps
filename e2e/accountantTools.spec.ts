import { expect, test, type Page } from '@playwright/test'
import { FakeQuickBooks, mockApp } from './support'

const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })
const switcher = (page: Page) => page.locator('label.client-switcher select')

async function openWorkspace(page: Page) {
  await mockApp(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
}

async function openReports(page: Page, client = 'ABC Plumbing') {
  await openWorkspace(page)
  await switcher(page).selectOption({ label: client })
  await nav(page, /Reports/).click()
}

const journalToggle = (page: Page) => page.getByRole('button', { name: /^Journal Entries/ })
const workpaperToggle = (page: Page) => page.getByRole('button', { name: /^Workpapers/ })

async function expandJournal(page: Page) {
  if ((await journalToggle(page).getAttribute('aria-expanded')) !== 'true') await journalToggle(page).click()
}
async function expandWorkpapers(page: Page) {
  if ((await workpaperToggle(page).getAttribute('aria-expanded')) !== 'true') await workpaperToggle(page).click()
}

test.describe('Phase 9: professional accountant tools', () => {
  test('creates, posts, reports, reverses, and documents a demo journal entry', async ({ page }) => {
    await openReports(page)
    await expandJournal(page)

    await page.getByRole('button', { name: 'Depreciation' }).click()
    await page.getByRole('button', { name: /Save draft/i }).click()
    await expect(page.locator('.audit-log-row').filter({ hasText: 'Record monthly equipment depreciation' })).toBeVisible()

    await page.locator('.audit-log-row').filter({ hasText: 'Record monthly equipment depreciation' }).first().click()
    await page.getByRole('button', { name: 'Post journal entry' }).click()
    await expect(page.locator('.history-panel').filter({ hasText: 'Created draft journal' })).toContainText('Posted journal entry to the demo books.')

    await page.getByTestId('open-trial-balance').click()
    await expect(page.getByTestId('row-depreciation-expense')).toContainText('$250.00')
    await expect(page.getByTestId('row-accumulated-depreciation')).toContainText('$250.00')
    await page.getByRole('button', { name: '← All reports' }).click()

    await page.locator('.audit-log-row').filter({ hasText: 'Record monthly equipment depreciation' }).first().click()
    await page.getByLabel('Reversal reason').fill('Training reversal for demo review.')
    await page.getByRole('button', { name: 'Reverse entry' }).click()
    await expect(page.locator('.history-panel').filter({ hasText: 'Created draft journal' })).toContainText('Marked journal entry as reversed.')

    await page.getByTestId('open-trial-balance').click()
    await expect(page.getByTestId('row-depreciation-expense')).toHaveCount(0)
    await expect(page.getByTestId('row-accumulated-depreciation')).toHaveCount(0)
    await page.getByRole('button', { name: '← All reports' }).click()

    await expandWorkpapers(page)
    await page.getByLabel('Workpaper title').fill('August depreciation review')
    await page.getByLabel('Workpaper account').selectOption('depreciation-expense')
    await page.getByLabel('Account review notes').fill('Agreed the monthly depreciation to the fixed-asset schedule.')
    await page.getByLabel('Adjusting entry references').fill('ADJ-DEPR')
    await page.getByLabel('Workpaper status').selectOption('Prepared')
    await page.getByRole('button', { name: /Save workpaper/i }).click()
    await expect(page.locator('.audit-log-row').filter({ hasText: 'August depreciation review' })).toBeVisible()

    await page.locator('.audit-log-row').filter({ hasText: 'August depreciation review' }).first().click()
    await page.getByLabel('Workpaper status').selectOption('Reviewed')
    await page.getByLabel('Reviewed by').fill('Morgan Manager')
    await page.getByRole('button', { name: /Update workpaper/i }).click()
    await expect(page.locator('.audit-log-row').filter({ hasText: 'August depreciation review' }).first()).toContainText('Reviewed')
    await expect(page.locator('.audit-log-row').filter({ hasText: 'August depreciation review' }).first()).toContainText('Morgan Manager')
  })

  test('All clients asks for a company instead of silently showing ABC Plumbing', async ({ page }) => {
    await openWorkspace(page)
    await nav(page, /Reports/).click()
    const scope = page.getByTestId('reports-scope')
    await expect(page.getByTestId('reports-client-gate')).toContainText('Choose a client')
    await expect(scope).toContainText('None selected (All clients)')
    await expect(scope).toContainText('Demo data')
    await expect(scope).not.toContainText('ABC Plumbing')
    await expect(page.getByTestId('open-trial-balance')).toBeDisabled()
    await expect(page.getByRole('button', { name: 'New journal entry' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Open reports for Green Leaf Landscaping' }).click()
    await expect(scope).toContainText('Green Leaf Landscaping')
    await expect(scope).toContainText('Period:')
    await expect(page.getByTestId('open-trial-balance')).toBeEnabled()
    await page.getByTestId('open-trial-balance').click()
    await expect(page.locator('.report-detail-heading')).toContainText('GREEN LEAF LANDSCAPING')
    await expect(page.getByTestId('report-facts')).toContainText('Demo data')
  })

  test('shows sections with record counts, accessible toggles and no nested buttons', async ({ page }) => {
    await openReports(page)
    await expect(journalToggle(page)).toContainText('0 entries')
    await expect(workpaperToggle(page)).toContainText('0 workpapers')
    await expect(journalToggle(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByLabel('Entry date')).toBeHidden()
    await expect(page.getByRole('button', { name: 'New journal entry' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New workpaper' })).toBeVisible()
    expect(await page.locator('button button').count()).toBe(0)

    await page.getByRole('button', { name: 'New journal entry' }).click()
    await expect(journalToggle(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByLabel('Entry date')).toBeVisible()
    await journalToggle(page).click()
    await expect(page.getByLabel('Entry date')).toBeHidden()
  })

  test('journal form totals, balance status and readiness rules', async ({ page }) => {
    await openReports(page)
    await page.getByRole('button', { name: 'New journal entry' }).click()
    const status = page.getByTestId('journal-balance-status')

    await expect(status).toHaveText('Nothing entered')
    await expect(page.getByTestId('total-debits')).toHaveText('$0.00')
    await expect(page.getByTestId('journal-difference')).toHaveText('$0.00')
    await expect(page.getByTestId('journal-readiness')).toContainText('Nothing has been entered yet.')
    await expect(page.locator('.journal-lines-table thead th')).toHaveText(['Account', 'Debit', 'Credit', 'Memo', 'Remove'])

    await page.getByLabel('Line 1 account').selectOption({ index: 1 })
    await page.getByLabel('Line 2 account').selectOption({ index: 2 })
    await page.getByLabel('Line 1 debit').fill('0')
    await page.getByLabel('Line 2 credit').fill('0')
    await expect(status).toHaveText('Not balanced')
    await expect(page.getByTestId('journal-readiness')).toContainText('above zero')

    await page.getByLabel('Line 1 debit').fill('100.10')
    await page.getByLabel('Line 2 credit').fill('100.00')
    await expect(status).toHaveText('Not balanced')
    await expect(page.getByTestId('total-debits')).toHaveText('$100.10')
    await expect(page.getByTestId('total-credits')).toHaveText('$100.00')
    await expect(page.getByTestId('journal-difference')).toHaveText('$0.10')

    await page.getByLabel('Line 2 credit').fill('100.10')
    await expect(status).toHaveText('Balanced')
    await expect(page.getByTestId('journal-difference')).toHaveText('$0.00')
    await expect(page.getByTestId('journal-readiness')).toHaveCount(0)
  })

  test('unbalanced entries are rejected by the server and not saved', async ({ page }) => {
    await openReports(page)
    await page.getByRole('button', { name: 'New journal entry' }).click()
    await page.getByLabel('Journal description').fill('Unbalanced test')
    await page.getByLabel('Line 1 account').selectOption({ index: 1 })
    await page.getByLabel('Line 2 account').selectOption({ index: 2 })
    await page.getByLabel('Line 1 debit').fill('50')
    await page.getByLabel('Line 2 credit').fill('40')
    await page.getByRole('button', { name: /Save draft/i }).click()
    await expect(page.locator('.accountant-form .data-state-message.error')).toBeVisible()
    await expect(journalToggle(page)).toContainText('0 entries')
  })

  test('adds and removes journal lines individually', async ({ page }) => {
    await openReports(page)
    await page.getByRole('button', { name: 'New journal entry' }).click()
    await expect(page.getByRole('button', { name: 'Remove line 1' })).toBeDisabled()
    await page.getByRole('button', { name: 'Add line' }).click()
    await expect(page.locator('.journal-lines-table tbody tr')).toHaveCount(3)
    await page.getByLabel('Line 3 memo').fill('keep me')
    await page.getByRole('button', { name: 'Remove line 2' }).click()
    await expect(page.locator('.journal-lines-table tbody tr')).toHaveCount(2)
    await expect(page.getByLabel('Line 2 memo')).toHaveValue('keep me')
  })

  test('templates fill the form without posting anything', async ({ page }) => {
    await openReports(page)
    await page.getByRole('button', { name: 'New journal entry' }).click()
    await expect(page.getByText('Nothing is posted')).toBeVisible()
    await page.getByRole('button', { name: 'Prepaid Expense' }).click()
    await expect(page.getByLabel('Journal description')).toHaveValue('Amortize prepaid insurance')
    await expect(page.getByLabel('Adjustment type')).toHaveValue('Prepaid Expense')
    await expect(page.getByTestId('journal-balance-status')).toHaveText('Balanced')
    await expect(journalToggle(page)).toContainText('0 entries')
    await expect(page.getByRole('button', { name: 'Post journal entry' })).toHaveCount(0)
  })

  test('unsaved work survives collapsing and warns before being discarded', async ({ page }) => {
    await openReports(page)
    await page.getByRole('button', { name: 'New workpaper' }).click()
    await page.getByLabel('Workpaper title').fill('Half-finished review')
    await workpaperToggle(page).click()
    await expect(page.getByLabel('Workpaper title')).toBeHidden()
    await expect(workpaperToggle(page)).toContainText('Unsaved changes')
    await workpaperToggle(page).click()
    await expect(page.getByLabel('Workpaper title')).toHaveValue('Half-finished review')

    await page.getByRole('button', { name: 'New workpaper' }).click()
    await expect(page.getByTestId('discard-warning')).toContainText('Discard unsaved changes?')
    await page.getByRole('button', { name: 'Keep editing' }).click()
    await expect(page.getByLabel('Workpaper title')).toHaveValue('Half-finished review')

    await page.getByRole('button', { name: 'New workpaper' }).click()
    await page.getByRole('button', { name: 'Discard changes' }).click()
    await expect(page.getByLabel('Workpaper title')).toHaveValue('')
  })

  test('journal drafts also survive opening a report and returning', async ({ page }) => {
    await openReports(page)
    await page.getByRole('button', { name: 'New journal entry' }).click()
    await page.getByLabel('Journal description').fill('Draft in progress')
    await page.getByTestId('open-profit-loss').click()
    await page.getByRole('button', { name: '← All reports' }).click()
    await expect(page.getByLabel('Journal description')).toHaveValue('Draft in progress')
  })

  test('workpaper form is grouped and the server still validates required fields', async ({ page }) => {
    await openReports(page)
    await page.getByRole('button', { name: 'New workpaper' }).click()
    for (const group of ['Basic information', 'Review details', 'Approval']) {
      await expect(page.getByRole('group', { name: group })).toBeVisible()
    }
    await page.getByRole('button', { name: /Save workpaper/i }).click()
    await expect(page.locator('.accountant-form .data-state-message.error').last()).toBeVisible()
    await expect(workpaperToggle(page)).toContainText('0 workpapers')
  })

  test('QuickBooks Sandbox accountant tools stay read-only', async ({ page }) => {
    const quickBooks = new FakeQuickBooks()
    const { unexpected } = await mockApp(page, { quickBooks })
    await page.goto('./')
    await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
    await page.locator('.global-source-area').getByRole('button', { name: 'QuickBooks Sandbox' }).click()
    await nav(page, /Reports/).click()
    await expect(page.getByTestId('reports-scope')).toContainText('QuickBooks Sandbox (read only)')
    await expect(page.getByText('Read-only in QuickBooks Sandbox mode.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'New journal entry' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Post journal entry' })).toHaveCount(0)
    expect(quickBooks.writes).toEqual([])
    expect(unexpected).toEqual([])
  })
})
