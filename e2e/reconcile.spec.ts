import { expect, test, type Page } from '@playwright/test'
import { FakeReconciliations, mockApp } from './support'

const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })
const pickClient = (page: Page, label: string) => page.locator('label.client-switcher select').selectOption({ label })

const open = async (page: Page) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
  await nav(page, /Reconcile/).click()
}

test.describe('Reconcile: client selection', () => {
  test('All clients asks for a client instead of showing one company\'s accounts', async ({ page }) => {
    await mockApp(page)
    await open(page)
    await expect(page.getByTestId('recon-pick-client')).toBeVisible()
    await expect(page.getByTestId('recon-client-card')).toHaveCount(5)
    await expect(page.getByRole('button', { name: 'Start reconciliation for Chase Business Checking' })).toHaveCount(0)
  })

  test('opening a client shows only that client\'s accounts and keeps the selection', async ({ page }) => {
    await mockApp(page)
    await open(page)
    await page.getByRole('button', { name: 'Open reconciliations for Green Leaf Landscaping' }).click()
    await expect(page.getByTestId('recon-pick-client')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Start reconciliation for Green Leaf/ }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start reconciliation for Chase Business Checking' })).toHaveCount(0)
    await nav(page, /Transactions/).click()
    await nav(page, /Reconcile/).click()
    await expect(page.getByRole('button', { name: /Start reconciliation for Green Leaf/ }).first()).toBeVisible()
  })

  test('a specific client\'s cards show the selected month status and a plain temporary-storage notice', async ({ page }) => {
    await mockApp(page)
    await open(page)
    await pickClient(page, 'ABC Plumbing')
    await expect(page.getByTestId('period-status').first()).toContainText('Not started')
    await expect(page.getByTestId('storage-label')).toContainText('may be lost when the server restarts')
    await expect(page.getByTestId('storage-label')).not.toContainText('DATABASE_URL')
  })

  test('QuickBooks Sandbox stays a single sandbox client with no picker', async ({ page }) => {
    await mockApp(page)
    await open(page)
    await page.getByRole('button', { name: /QuickBooks Sandbox/ }).first().click()
    await expect(page.getByTestId('recon-pick-client')).toHaveCount(0)
  })
})

test.describe('Reconcile: history', () => {
  test('saved records show long-form dates, can be filtered, and All clients lists every client', async ({ page }) => {
    const reconciliations = new FakeReconciliations()
    reconciliations.seedDemo()
    await mockApp(page, { reconciliations })
    await open(page)
    const rows = page.getByTestId('saved-reconciliation')
    const total = await rows.count()
    if (total > 0) {
      await expect(rows.first()).toContainText(/[A-Z][a-z]+ \d{1,2}, \d{4}/)
      await page.getByLabel('Search saved reconciliations').fill('zzz-no-match')
      await expect(page.getByText('No saved reconciliations match these filters.')).toBeVisible()
      await page.getByRole('button', { name: 'Reset filters' }).click()
      await expect(rows).toHaveCount(total)
    }
  })

  test('a completed month shows Completed, the last completed date and the labelled ending balance', async ({ page }) => {
    const reconciliations = new FakeReconciliations()
    await mockApp(page, { reconciliations })
    await open(page)
    await pickClient(page, 'ABC Plumbing')
    await page.getByRole('button', { name: 'Start reconciliation for Chase Business Checking' }).click()
    await page.getByRole('button', { name: 'Load the demo statement transactions' }).click()
    await page.getByLabel(/This is the first reconciliation here/).check()
    await page.getByRole('button', { name: /Continue to matching/ }).click()
    await page.getByRole('button', { name: /Clear all suggested matches/ }).click()
    await page.getByTestId('bulk-confirm').getByRole('button', { name: /^Confirm/ }).click()
    await page.getByRole('navigation', { name: 'Reconciliation steps' }).getByRole('button', { name: '4. Review & complete' }).click()
    await page.getByRole('button', { name: /Complete reconciliation/ }).click()
    await expect(page.getByTestId('completed-banner')).toBeVisible()
    await page.reload()
    await nav(page, /Reconcile/).click()
    await pickClient(page, 'ABC Plumbing')
    const card = page.locator('.reconciliation-account-card', { hasText: 'Chase Business Checking' })
    await expect(card).toContainText('Statement ending balance')
    await expect(card).toContainText(/Last completed reconciliation/)
    await expect(card).toContainText(/[A-Z][a-z]+ \d{1,2}, \d{4}/)
    const row = page.getByTestId('saved-reconciliation').first()
    await expect(row).toContainText('Completed')
    await row.getByRole('button', { name: /View reconciliation/ }).click()
    await expect(page.getByTestId('completed-banner')).toBeVisible()
  })
})
