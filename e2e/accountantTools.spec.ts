import { expect, test, type Page } from '@playwright/test'
import { mockApp } from './support'

const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })

async function openWorkspace(page: Page) {
  await mockApp(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
}

test.describe('Phase 9: professional accountant tools', () => {
  test('creates, posts, reports, reverses, and documents a demo journal entry', async ({ page }) => {
    await openWorkspace(page)
    await nav(page, /Reports/).click()

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
})
