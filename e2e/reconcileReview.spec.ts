import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { mockApp } from './support'

const open = async (page: Page, account = 'Chase Business Checking') => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
  await page.locator('nav.main-nav').getByRole('button', { name: /Reconcile/ }).click()
  await page.locator('label.client-switcher select').selectOption({ label: 'ABC Plumbing' })
  await page.getByRole('button', { name: `Start reconciliation for ${account}` }).click()
  await page.getByRole('button', { name: 'Load the demo statement transactions' }).click()
  await page.getByLabel(/This is the first reconciliation here/).check()
  await page.getByRole('button', { name: /Continue to matching/ }).click()
  await expect(page.getByRole('heading', { name: 'Match transactions to the statement' })).toBeVisible()
}
const toReview = async (page: Page) => {
  await page.getByRole('button', { name: /Review and complete/ }).click()
  await expect(page.getByRole('heading', { name: 'Review and complete' })).toBeVisible()
}
const clearSuggested = async (page: Page) => {
  await page.getByRole('button', { name: /Clear all suggested matches/ }).click()
  await page.getByTestId('bulk-confirm').getByRole('button', { name: /^Confirm/ }).click()
}
const item = (page: Page, label: string) => page.getByTestId('checklist-item').filter({ hasText: label })
const complete = (page: Page) => page.getByRole('button', { name: /Complete reconciliation/ })

test.describe('Reconcile: Review & complete', () => {
  test('an incomplete reconciliation explains the difference, lists checks, blocks completion and returns to matching', async ({ page }) => {
    await mockApp(page)
    await open(page)
    await toReview(page)
    await expect(page.getByTestId('difference-help')).toContainText('does not automatically mean an accounting error')
    await expect(page.getByTestId('remaining-difference')).not.toHaveText('$0.00')
    await expect(complete(page)).toBeDisabled()
    await expect(page.getByTestId('complete-blocked')).toContainText('server checks the same rules again')
    await expect(page.getByTestId('checklist-item')).toHaveCount(7)
    await expect(item(page, 'Reconciliation difference exactly zero')).toContainText('Needs attention')
    await expect(item(page, 'Statement matches valid and unique')).toContainText('Needs attention')
    await expect(item(page, 'Opening balance verified')).toContainText('Passed')
    await expect(item(page, 'No remaining blocking issues')).toContainText('Needs attention')

    await page.getByRole('button', { name: 'Return to matching' }).click()
    await expect(page.getByRole('heading', { name: 'Match transactions to the statement' })).toBeVisible()
  })

  test('outstanding amounts are provisional until the statement is fully matched, then verified', async ({ page }) => {
    await mockApp(page)
    await open(page)
    await toReview(page)
    await expect(page.getByTestId('outstanding-basis')).toContainText('Provisional')
    await expect(page.locator('.recon-calc')).toContainText('Deposits in transit (provisional)')
    await expect(page.locator('.recon-calc')).not.toContainText('(verified)')

    await page.getByRole('button', { name: /^4\. Review/ }).click()
    await page.getByRole('button', { name: '3. Match' }).click()
    await clearSuggested(page)
    await toReview(page)
    await expect(page.getByTestId('outstanding-basis')).toContainText('Verified')
    await expect(page.locator('.recon-calc')).toContainText('(verified)')
  })

  test('a credit card shows card wording for outstanding items', async ({ page }) => {
    await mockApp(page)
    await open(page, 'Chase Business Credit Card')
    await toReview(page)
    await expect(page.locator('.recon-calc')).toContainText('Charges not yet on statement')
    await expect(page.locator('.recon-calc')).toContainText('Payments not yet on statement')
    await expect(page.locator('.recon-calc')).not.toContainText('Deposits in transit')
  })

  test('buttons are named clearly and Save for later saves without completing', async ({ page }) => {
    await mockApp(page)
    await open(page)
    await clearSuggested(page)
    await toReview(page)
    await expect(page.getByRole('button', { name: 'Save progress' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Save for later' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Saved for later' })).toBeVisible()
    await expect(page.getByTestId('completed-banner')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Download reconciliation report (CSV)' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Download summary/ })).toHaveCount(0)
  })

  test('a valid reconciliation passes every check, completes and shows a success message', async ({ page }) => {
    await mockApp(page)
    await open(page)
    await clearSuggested(page)
    await toReview(page)
    await expect(page.getByTestId('checklist-item').filter({ hasText: 'Passed' })).toHaveCount(7)
    await expect(complete(page)).toBeEnabled()
    await complete(page).click()
    await expect(page.getByRole('status').filter({ hasText: 'Reconciliation completed and saved in LedgerOps' })).toBeVisible()
    await expect(page.getByTestId('completed-banner')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible()
  })

  test('when the server refuses completion the user sees a clear error and nothing is completed', async ({ page }) => {
    await mockApp(page)
    await page.route('**/api/reconciliations/**/complete', (route) =>
      route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'The reconciliation cannot be completed yet.', code: 'NOT_COMPLETABLE', issues: [] }) }),
    )
    await open(page)
    await clearSuggested(page)
    await toReview(page)
    await complete(page).click()
    await expect(page.getByRole('alert').filter({ hasText: 'The reconciliation was not completed. The reconciliation cannot be completed yet.' })).toBeVisible()
    await expect(page.getByTestId('completed-banner')).toHaveCount(0)
    await expect(complete(page)).toBeEnabled()
  })

  test('the downloaded report matches the screen and labels provisional figures', async ({ page }) => {
    await mockApp(page)
    await open(page)
    await toReview(page)
    const screenDifference = (await page.getByTestId('remaining-difference').innerText()).replace(/[$,]/g, '')
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download reconciliation report (CSV)' }).click()])
    expect(download.suggestedFilename()).toMatch(/\.csv$/)
    const text = await readFile((await download.path())!, 'utf8')
    expect(text).toContain(`Difference,${screenDifference}`)
    expect(text).toContain('Provisional')
    expect(text).toContain('Deposits in transit (provisional)')
    expect(text).toContain('Completion checklist')
    expect(text).toContain('Reconciliation difference exactly zero,Needs attention')
    expect(text).toContain('Not balanced')

    await page.getByRole('button', { name: '3. Match' }).click()
    await clearSuggested(page)
    await toReview(page)
    const [second] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download reconciliation report (CSV)' }).click()])
    const final = await readFile((await second.path())!, 'utf8')
    expect(final).toContain('Difference,0.00')
    expect(final).toContain('Verified against the imported statement')
    expect(final).toContain('Balanced - all completion checks passed')
  })
})
