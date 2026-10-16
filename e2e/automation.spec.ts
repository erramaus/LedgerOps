import { expect, test, type Page } from '@playwright/test'
import { mockApp } from './support'

const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })

async function openWorkspace(page: Page) {
  await mockApp(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
}

test.describe('Phase 7: smart bookkeeping automation', () => {
  test('creates a client-scoped rule, previews its matches, and applies the approved suggestion', async ({ page }) => {
    await openWorkspace(page)
    await nav(page, /Settings/).click()

    await page.getByLabel('Rule name').fill('Cafe meals rule')
    await page.getByLabel('Vendor / payee contains').fill('Corner Cafe')
    await page.getByLabel('Suggested category').selectOption('Meals')
    await page.getByLabel('Review priority').selectOption('High')
    await expect(page.getByTestId('rule-preview')).toContainText('The Corner Cafe')
    await page.getByRole('button', { name: 'Create rule' }).click()
    await expect(page.getByTestId('rules-list')).toContainText('Cafe meals rule')

    await nav(page, /Transactions/).click()
    await page.locator('.transaction-row').filter({ hasText: 'The Corner Cafe' }).click()
    const suggestion = page.getByTestId('rule-suggestion').first()
    await expect(suggestion).toContainText('Cafe meals rule')
    await expect(suggestion).toContainText('Meals')
    await suggestion.getByRole('button', { name: 'Use rule suggestion' }).click()
    await page.getByRole('button', { name: /Review 1 change/ }).click()
    await page.locator('.confirmation-box').getByRole('button', { name: 'Confirm (demo)' }).click()
    await expect(page.locator('.review-details')).toContainText('Categorized')

    await nav(page, /Settings/).click()
    await expect(page.locator('.audit-log-row').filter({ hasText: 'Accepted rule suggestion' })).toBeVisible()
  })

  test('reviews recurring reminders without creating transactions automatically', async ({ page }) => {
    await openWorkspace(page)
    await nav(page, /Bookkeeping Review/).click()
    await page.locator('.filter-row').getByRole('button', { name: /^Transactions/ }).click()
    const reminder = page.locator('.review-card').filter({ hasText: 'Expected recurring transaction missing' }).filter({ hasText: 'Adobe' }).first()
    await expect(reminder).toBeVisible()
    await reminder.click()
    await expect(page.getByRole('heading', { name: 'Adobe' })).toBeVisible()
    await expect(page.locator('.request-detail-layout')).toContainText('This is a reminder only. No transaction will be created or posted automatically.')
    await page.getByRole('button', { name: 'Confirm pattern' }).click()
    await expect(page.locator('.review-card').filter({ hasText: 'Adobe' })).toHaveCount(0)

    await nav(page, /Settings/).click()
    await expect(page.locator('.audit-log-row').filter({ hasText: 'Confirmed recurring reminder for Adobe.' })).toBeVisible()
  })
})
