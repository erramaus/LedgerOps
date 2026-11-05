import { expect, test, type Page } from '@playwright/test'
import { mockApp } from './support'

/** Phase 11: routine large amounts are no longer flagged, and the Dashboard, Inbox and Transactions counts agree. */
const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })
const metric = (page: Page, label: string) => page.locator('.metric-card').filter({ has: page.locator('.metric-label', { hasText: new RegExp(`^${label}$`) }) }).locator('strong')
const chooseClient = (page: Page, name: string) => page.locator('label.client-switcher select').selectOption({ label: name })
const largeFilter = (page: Page) => page.getByRole('group', { name: 'Review reason filters' }).or(page.locator('[aria-label="Review reason filters"]')).getByRole('button', { name: /^Large transaction/ })

async function open(page: Page) {
  await mockApp(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
}

test.describe('Transaction review priorities', () => {
  test.use({ actionTimeout: 10_000 })

  test('All clients no longer flags every transaction of $1,000 or more', async ({ page }) => {
    await open(page)
    const transactions = Number(await metric(page, 'Transactions to review').innerText())
    expect(transactions).toBeLessThan(142)

    await nav(page, /Inbox/).click()
    await expect(page.locator('.inbox-row').first()).toBeVisible()
    const texts = await page.locator('.inbox-row').allInnerTexts()
    expect(texts.some((text) => /Large transaction|is a large amount/i.test(text))).toBe(false)
  })

  test('construction expenses of $1,000 or more are routine, so none is flagged as unusually large', async ({ page }) => {
    await open(page)
    await chooseClient(page, 'Smith Construction')
    await nav(page, /Transactions/).click()
    await expect(page.locator('.transaction-row').first()).toBeVisible()
    await expect(largeFilter(page)).toHaveText(/0$/)
    await nav(page, /Inbox/).click()
    for (const text of await page.locator('.inbox-row').allInnerTexts()) expect(text).not.toMatch(/Large transaction|Unusually large/)
  })

  test('the Transactions filter count matches the Dashboard for each company and other checks remain', async ({ page }) => {
    await open(page)
    for (const company of ['ABC Plumbing', 'Green Leaf Landscaping', 'Johnson Dental', 'Acme Consulting']) {
      await chooseClient(page, company)
      await nav(page, /Transactions/).click()
      await expect(page.locator('.transaction-row').first()).toBeVisible()
      await expect(largeFilter(page)).toHaveText(/0$/)
    }
  })

  test('Bookkeeping Review keeps its remaining findings with no unusual-amount rows for routine activity', async ({ page }) => {
    await open(page)
    await nav(page, /Bookkeeping Review/).click()
    await expect(page.locator('.finding-card').first()).toBeVisible()
    for (const text of await page.locator('.finding-card').allInnerTexts()) expect(text).not.toMatch(/\$1,000 or more/)
  })
})
