import { expect, test, type Page } from '@playwright/test'
import { mockApp } from './support'

const openTransactions = async (page: Page) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
  await page.locator('nav.main-nav').getByRole('button', { name: /Transactions/ }).click()
  await expect(page.locator('.page-content').getByRole('heading', { name: 'Transactions', exact: true })).toBeVisible()
}
const chooseClient = (page: Page, name: string) => page.locator('label.client-switcher select').selectOption({ label: name })
const rows = (page: Page) => page.locator('.transaction-row')
const costco = (page: Page) => rows(page).filter({ hasText: 'Costco Wholesale' })
const filterButton = (page: Page, group: string, name: RegExp) => page.getByRole('group', { name: group }).or(page.locator(`[aria-label="${group}"]`)).getByRole('button', { name })

test.describe('Transactions: client selection', () => {
  test.beforeEach(async ({ page }) => {
    await mockApp(page)
    await openTransactions(page)
  })

  test('All clients shows every company with detailed records and a Client column', async ({ page }) => {
    await expect(page.locator('.page-content')).not.toContainText("ABC Plumbing's recent activity")
    await expect(page.locator('.welcome-row')).toContainText('across every client')
    await expect(page.locator('.transaction-heading')).toContainText('Client')
    const names = new Set(await page.locator('.tx-client').allInnerTexts())
    expect(names.has('ABC Plumbing')).toBe(true)
    expect(names.size).toBeGreaterThan(1)
  })

  test('selecting one client shows only that client and removes the Client column', async ({ page }) => {
    await chooseClient(page, 'Green Leaf Landscaping')
    await expect(page.locator('.welcome-row')).toContainText("Green Leaf Landscaping's transactions")
    await expect(page.locator('.transaction-heading')).not.toContainText('Client')
    await expect(page.locator('.tx-client')).toHaveCount(0)
    await expect(rows(page).first()).toBeVisible()
    await expect(rows(page).filter({ hasText: 'Costco Wholesale' })).toHaveCount(0)
    await expect(rows(page).filter({ hasText: 'Home Depot' })).toHaveCount(0)
  })

  test('ABC Plumbing keeps its own records and the combined view returns when cleared', async ({ page }) => {
    await chooseClient(page, 'ABC Plumbing')
    await expect(page.locator('.tx-client')).toHaveCount(0)
    await expect(costco(page)).toHaveCount(1)
    await chooseClient(page, 'All clients')
    await expect(page.locator('.transaction-heading')).toContainText('Client')
    await expect(costco(page)).toHaveCount(1)
  })
})

test.describe('Transactions: filters, status and review reasons', () => {
  test.beforeEach(async ({ page }) => {
    await mockApp(page)
    await openTransactions(page)
    await chooseClient(page, 'ABC Plumbing')
  })

  test('separates status filters from review-reason filters with no duplicated Needs Review', async ({ page }) => {
    await expect(page.getByRole('button', { name: /^Needs review/i })).toHaveCount(1)
    await expect(filterButton(page, 'Status filters', /^Matched/)).toBeVisible()
    await expect(filterButton(page, 'Review reason filters', /^Missing receipt/)).toBeVisible()
    await expect(filterButton(page, 'Review reason filters', /^Large transaction/)).toBeVisible()
  })

  test('a categorized transaction can still show that a receipt is missing', async ({ page }) => {
    const ups = rows(page).filter({ hasText: 'UPS' })
    await expect(ups).toContainText('Categorized')
    await expect(ups).toContainText('Receipt missing')
  })

  test('reason, status and search combine, counts follow, and reset restores everything', async ({ page }) => {
    const total = await rows(page).count()
    await filterButton(page, 'Review reason filters', /^Missing receipt/).click()
    await expect(rows(page)).toHaveCount(2)
    await page.getByLabel('Search transactions').fill('grainger')
    await expect(rows(page)).toHaveCount(1)
    await expect(page.locator('.list-summary')).toContainText('Showing 1 of 1')
    await page.getByLabel('Search transactions').fill('nothing matches this')
    await expect(page.locator('.transaction-panel')).toContainText('No transactions match these filters.')
    await page.locator('.list-summary').getByRole('button', { name: 'Reset filters' }).click()
    await expect(rows(page)).toHaveCount(total)
    await expect(page.getByLabel('Search transactions')).toHaveValue('')
  })

  test('row actions are descriptive and open the exact transaction', async ({ page }) => {
    await expect(rows(page).filter({ hasText: 'Amazon' }).locator('.row-action')).toHaveText('Review')
    await expect(rows(page).filter({ hasText: 'Adobe' }).locator('.row-action')).toHaveText('View details')
    await rows(page).filter({ hasText: 'Adobe' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Adobe' })).toBeVisible()
  })
})

test.describe('Transactions: split transactions and date filtering', () => {
  test.beforeEach(async ({ page }) => {
    await mockApp(page)
    await openTransactions(page)
    await chooseClient(page, 'ABC Plumbing')
  })

  test('labels a split as Split (N lines) and keeps the line-by-line workflow', async ({ page }) => {
    await expect(costco(page)).toContainText('Split (3 lines)')
    await costco(page).click()
    await expect(page.getByTestId('transaction-line')).toHaveCount(3)
    await expect(page.locator('.review-details')).toContainText('Split (3 lines)')
  })

  test('shows all dates by default, including older transactions', async ({ page }) => {
    await expect(page.locator('.active-range')).toContainText('All dates')
    await expect(rows(page).filter({ hasText: 'Pipe wrap and hangers' })).toHaveCount(1)
  })

  test('filters by the selected accounting month and shows the range', async ({ page }) => {
    await page.getByLabel('Date range type').selectOption('month')
    await expect(page.locator('.active-range')).toContainText('Aug 1, 2026 – Aug 31, 2026')
    await expect(rows(page).filter({ hasText: 'Pipe wrap and hangers' })).toHaveCount(0)
    await expect(rows(page).filter({ hasText: 'Amazon' })).toHaveCount(1)
  })

  test('filters by a custom range and reset returns to all dates', async ({ page }) => {
    await page.getByLabel('Date range type').selectOption('custom')
    await page.getByLabel('From date').fill('2026-07-01')
    await page.getByLabel('To date').fill('2026-07-31')
    await expect(page.locator('.active-range')).toContainText('Jul 1, 2026 – Jul 31, 2026')
    await expect(rows(page)).toHaveCount(2)
    await page.locator('.list-summary').getByRole('button', { name: 'Reset filters' }).click()
    await expect(page.locator('.active-range')).toContainText('All dates')
    expect(await rows(page).count()).toBeGreaterThan(2)
  })
})

test.describe('Transactions: moving to the next transaction', () => {
  test('updates the remaining count after a save and does not reopen the completed transaction', async ({ page }) => {
    await mockApp(page)
    await openTransactions(page)
    await chooseClient(page, 'ABC Plumbing')
    await page.getByLabel('Search transactions').fill('ladder rack')
    const nextButton = page.getByRole('button', { name: /^Review next/ })
    await expect(nextButton).toContainText('Review next (1)')
    await rows(page).filter({ hasText: 'new ladder rack' }).click()
    await expect(page.locator('.review-progress-bar')).toContainText('1 transaction needs review')
    const line = page.getByTestId('transaction-line').nth(1)
    await line.getByLabel(/Category for/).selectOption('Materials')
    await page.getByRole('button', { name: /Review 1 change/ }).click()
    await page.locator('.confirmation-box').getByRole('button', { name: 'Confirm (demo)' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Saved (demo data only)' })).toBeVisible()
    await expect(page.locator('.review-progress-bar')).toContainText('0 transactions need review')
    await expect(page.getByRole('button', { name: /Open next transaction needing review/ })).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: 'No more transactions need review' })).toBeVisible()
    await page.getByRole('button', { name: /All transactions/ }).click()
    await expect(page.getByRole('button', { name: /^Review next/ })).toContainText('Review next (0)')
    await expect(page.getByRole('button', { name: /^Review next/ })).toBeDisabled()
  })

  test('Next skips completed items and wraps without reopening the current one', async ({ page }) => {
    await mockApp(page)
    await openTransactions(page)
    await chooseClient(page, 'ABC Plumbing')
    await page.getByRole('button', { name: /^Review next/ }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Amazon' })).toBeVisible()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Home Depot' })).toBeVisible()
  })
})

test.describe('Transactions: QuickBooks Sandbox stays separate and safe', () => {
  test('has no Client column, its own scope and sends nothing just by browsing', async ({ page }) => {
    const { unexpected } = await mockApp(page)
    const writes: string[] = []
    page.on('request', (request) => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) && request.url().includes('/api/quickbooks')) writes.push(request.url())
    })
    await page.goto('./')
    await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
    await page.locator('.global-source-area').getByRole('button', { name: 'QuickBooks Sandbox' }).click()
    await page.locator('nav.main-nav').getByRole('button', { name: /Transactions/ }).click()
    await expect(rows(page).first()).toBeVisible()
    await expect(page.locator('.transaction-heading')).not.toContainText('Client')
    await expect(page.locator('.welcome-row')).not.toContainText('across every client')
    await expect(rows(page).filter({ hasText: 'Costco Wholesale' })).toHaveCount(0)
    await expect(rows(page).filter({ hasText: 'Sandbox Supply Co' }).locator('.row-action')).toHaveText('Review')
    await page.getByLabel('Date range type').selectOption('month')
    await page.locator('.list-summary').getByRole('button', { name: 'Reset filters' }).click()
    expect(writes).toEqual([])
    expect(unexpected).toEqual([])
  })
})
