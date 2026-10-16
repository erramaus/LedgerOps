import { expect, test, type Page } from '@playwright/test'
import { mockApp } from './support'

const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })

async function openWorkspace(page: Page) {
  await mockApp(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
}

test.describe('Phase 8: client portal and documents', () => {
  test('creates a request, receives a client document, matches the receipt, and clears the inbox task', async ({ page }) => {
    await openWorkspace(page)
    await nav(page, /Client Requests/).click()
    const createRequestPanel = page.locator('.portal-panel').filter({ hasText: 'Create request' })

    await createRequestPanel.getByLabel('Request type').selectOption('Missing Receipt')
    await createRequestPanel.getByLabel('Related transaction or document').fill('Home Depot')
    await createRequestPanel.getByLabel('Amount').fill('$341.22')
    await createRequestPanel.getByRole('textbox', { name: 'Request' }).fill('Please upload the receipt for the Home Depot purchase.')
    await page.getByRole('button', { name: 'Send request' }).click()
    await expect(page.getByRole('heading', { name: 'Home Depot' })).toBeVisible()
    await expect(page.locator('.request-question')).toContainText('Please upload the receipt for the Home Depot purchase.')
    await page.getByRole('button', { name: '← All requests' }).click()
    await expect(page.locator('.request-card').filter({ hasText: 'Please upload the receipt for the Home Depot purchase.' })).toBeVisible()

    await nav(page, /Inbox/).click()
    await page.locator('.filter-row').getByRole('button', { name: /^Client Requests/ }).click()
    await expect(page.locator('.inbox-row').filter({ hasText: 'Please upload the receipt for the Home Depot purchase.' })).toBeVisible()

    await nav(page, /Client Requests/).click()
    await page.getByRole('button', { name: /^Simulated Client View/ }).click()
    await page.locator('.request-card').filter({ hasText: 'Please upload the receipt for the Home Depot purchase.' }).click()
    const requestDetail = page.locator('.request-detail-layout')
    await requestDetail.getByLabel('Note to bookkeeper').fill('Uploading the receipt from my phone.')
    await page.getByRole('button', { name: 'Upload simulated document' }).click()
    await requestDetail.getByLabel('Reply').fill('This was for Oak Street repairs.')
    await page.getByRole('button', { name: 'Send response' }).click()
    await expect(page.locator('.message-thread')).toContainText('Oak Street repairs.')
    await page.getByRole('button', { name: '← All requests' }).click()

    await page.getByRole('button', { name: /^Bookkeeper View/ }).click()
    await page.locator('.request-card').filter({ hasText: 'Please upload the receipt for the Home Depot purchase.' }).click()
    await expect(page.locator('.audit-log-row').filter({ hasText: 'receipt' })).toBeVisible()
    await page.getByRole('button', { name: /Match to Home Depot/i }).first().click()
    await expect(page.locator('.resolved-note')).toContainText('resolved')

    await nav(page, /Inbox/).click()
    await page.locator('.filter-row').getByRole('button', { name: /^Client Requests/ }).click()
    await expect(page.locator('.inbox-row').filter({ hasText: 'Please upload the receipt for the Home Depot purchase.' })).toHaveCount(0)
  })

  test('keeps simulated portal data isolated by client', async ({ page }) => {
    await openWorkspace(page)
    await nav(page, /Client Requests/).click()
    await page.getByRole('button', { name: /^Simulated Client View/ }).click()
    const simulatedPortalPanel = page.locator('.portal-panel').filter({ hasText: 'Simulated Client Portal' })
    await simulatedPortalPanel.getByLabel('Client').selectOption('Green Leaf Landscaping')
    await expect(page.locator('.request-card').filter({ hasText: 'Green Leaf Landscaping' })).toBeVisible()
    await expect(page.locator('.request-card').filter({ hasText: 'ABC Plumbing' })).toHaveCount(0)
    await expect(page.locator('.audit-log-row').filter({ hasText: 'August operating account statement' })).toBeVisible()
  })
})
