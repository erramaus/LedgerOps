import { expect, test, type Page } from '@playwright/test'
import { FakeMonthEnd, FakeReconciliations, mockApp } from './support'

const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })

async function start(page: Page) {
  const reconciliations = new FakeReconciliations()
  const monthEnd = new FakeMonthEnd(reconciliations)
  await mockApp(page, { reconciliations, monthEnd })
  reconciliations.seedDemo()
  await monthEnd.seedDemo()
  await page.goto('./')
  await nav(page, /Clients/).click()
  await expect(page.locator('article.full-client-card').first()).toBeVisible()
}

test.describe('Clients tab usability', () => {
  test('shows five demo cards with no repeated connection text and a disabled, explained Add client', async ({ page }) => {
    await start(page)
    await expect(page.locator('article.full-client-card')).toHaveCount(5)
    await expect(page.getByText('Not connected (demo client)')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Add client/ })).toBeDisabled()
    await expect(page.getByText(/Not available yet/)).toBeVisible()
    await expect(page.locator('article.full-client-card button')).toHaveCount(10)
  })

  test('clicking anywhere on a card selects the client and the selection persists', async ({ page }) => {
    await start(page)
    const card = page.locator('article.full-client-card').nth(1)
    const name = (await card.locator('.card-link').innerText()).trim()
    await card.click({ position: { x: 5, y: 5 }, force: true })
    await expect(nav(page, /Dashboard/)).toHaveClass(/active/)
    await expect(page.getByLabel('Client').locator('option:checked')).toHaveText(name)
    await nav(page, /Transactions/).click()
    await expect(page.getByLabel('Client').locator('option:checked')).toHaveText(name)
  })

  test('reconciliation link opens Reconcile for that client', async ({ page }) => {
    await start(page)
    await page.locator('article.full-client-card').first().locator('.reconcile-link').click()
    await expect(nav(page, /Reconcile/)).toHaveClass(/active/)
  })

  test('attention and month-end are separate statuses', async ({ page }) => {
    await start(page)
    const card = page.locator('article.full-client-card').first()
    await expect(card.locator('.status-badge')).toHaveText(/open bookkeeping item|No open bookkeeping items/)
    await expect(card.locator('.client-card-progress small')).toHaveText(/Month-end:/)
    await expect(page.getByText('On track')).toHaveCount(0)
  })

  test('period is labelled and historical', async ({ page }) => {
    await start(page)
    const card = page.locator('article.full-client-card').first()
    await expect(card).toContainText('Period: August 2026')
    await expect(card).toContainText('Historical period')
  })
})
