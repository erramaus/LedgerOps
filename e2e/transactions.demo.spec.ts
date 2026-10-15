import { expect, test, type Page } from '@playwright/test'
import { mockApp } from './support'

const openTransactions = async (page: Page) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
  await page.locator('nav.main-nav').getByRole('button', { name: /Transactions/ }).click()
  await expect(page.locator('.page-content').getByRole('heading', { name: 'Transactions', exact: true })).toBeVisible()
}

const openRow = (page: Page, text: RegExp | string) => page.locator('.transaction-row').filter({ hasText: text }).click()
const lineCard = (page: Page, index: number) => page.getByTestId('transaction-line').nth(index)

test.describe('sign-in gate (production AuthGate, mocked server responses)', () => {
  test('shows only the sign-in screen when there is no session, and loads no data', async ({ page }) => {
    const { unexpected } = await mockApp(page, { authenticated: false })
    await page.goto('./')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Sign in securely/ })).toBeVisible()
    await expect(page.getByText('Bookkeeping workspace', { exact: false })).toHaveCount(0)
    await expect(page.locator('nav.main-nav')).toHaveCount(0)
    expect(unexpected).toEqual([])
  })

  test('shows the workspace and the signed-in user once the server reports a session', async ({ page }) => {
    await mockApp(page)
    await page.goto('./')
    await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
    await expect(page.locator('.sidebar-footer')).toContainText('E2E Tester')
  })
})

test.describe('demo data: split transactions', () => {
  test.beforeEach(async ({ page }) => {
    await mockApp(page)
    await openTransactions(page)
  })

  test('shows every detail and each line with its own category, amount and description', async ({ page }) => {
    await openRow(page, 'Costco Wholesale')
    const details = page.locator('.review-details')
    await expect(details).toContainText('Aug 21, 2026')
    await expect(details).toContainText('Costco Wholesale')
    await expect(details).toContainText('$286.40')
    await expect(details).toContainText('Chase Business Credit Card')
    await expect(details).toContainText('Split (3)')
    await expect(details).toContainText('Shop supplies and breakroom restock')
    await expect(details).toContainText('Needs Review')

    await expect(page.getByTestId('transaction-line')).toHaveCount(3)
    await expect(lineCard(page, 0)).toContainText('Printer paper and toner')
    await expect(lineCard(page, 0)).toContainText('$120.40')
    await expect(lineCard(page, 0)).toContainText('Office Supplies')
    await expect(lineCard(page, 1)).toContainText('Coffee and snacks')
    await expect(lineCard(page, 1)).toContainText('$64.00')
    await expect(lineCard(page, 1)).toContainText('Needs a category')
  })

  test('categorizes one line after confirmation and leaves the others alone', async ({ page }) => {
    await openRow(page, 'Costco Wholesale')
    await lineCard(page, 1).getByLabel(/Category for Coffee and snacks/).selectOption('Meals')

    await expect(lineCard(page, 1)).toContainText('Staged change (not saved)')
    await expect(page.locator('.change-preview')).toContainText('Coffee and snacks: Uncategorized → Meals')
    await expect(page.locator('.change-preview')).toContainText('Transaction total stays $286.40')

    await page.getByRole('button', { name: /Review 1 change/ }).click()
    const confirmation = page.locator('.confirmation-box')
    await expect(confirmation).toContainText('Other lines will not change.')
    await expect(confirmation).not.toContainText('Printer paper')
    await confirmation.getByRole('button', { name: 'Confirm (demo)' }).click()

    await expect(page.getByRole('status').filter({ hasText: 'Saved (demo data only)' })).toBeVisible()
    await expect(lineCard(page, 0)).toContainText('Office Supplies')
    await expect(lineCard(page, 1)).toContainText('Meals')
    await expect(lineCard(page, 2)).toContainText('Needs a category')
    await expect(page.locator('.review-details')).toContainText('Needs Review')
  })

  test('becomes categorized only when every line has a category', async ({ page }) => {
    await openRow(page, 'Costco Wholesale')
    await lineCard(page, 1).getByLabel(/Category for Coffee and snacks/).selectOption('Meals')
    await lineCard(page, 2).getByLabel(/Category for Cleaning supplies/).selectOption('Other')
    await page.getByRole('button', { name: /Review 2 changes/ }).click()
    await page.locator('.confirmation-box').getByRole('button', { name: 'Confirm (demo)' }).click()
    await expect(page.locator('.review-details')).toContainText('Categorized')
  })

  test('shows suggestions separately from the confirmed category, with reasons, and never applies them itself', async ({ page }) => {
    await openRow(page, 'new ladder rack')
    const line = lineCard(page, 1)
    await expect(line).toContainText('Needs a category')
    const suggestion = line.locator('.suggestion-box')
    await expect(suggestion).toContainText('Suggested, not applied')
    await expect(suggestion).toContainText('Materials')
    await expect(suggestion).toContainText('Confidence:')
    await expect(suggestion).toContainText('Used for 2 of 2 earlier Home Depot lines')

    await suggestion.getByRole('button', { name: 'Use suggestion' }).click()
    await expect(line).toContainText('Staged change (not saved)')
    await expect(line).toContainText('Needs a category')

    // Leaving without confirming keeps the books unchanged.
    await page.getByRole('button', { name: /All transactions/ }).click()
    await openRow(page, 'new ladder rack')
    await expect(lineCard(page, 1)).toContainText('Needs a category')
    await expect(lineCard(page, 1)).not.toContainText('Staged change')
  })

  test('filters by search, category and status', async ({ page }) => {
    const rows = page.locator('.transaction-row')
    await page.getByLabel('Search transactions').fill('home depot')
    await expect(rows).toHaveCount(4)
    await page.getByLabel('Search transactions').fill('LADDER')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('Home Depot')
    await page.getByLabel('Search transactions').fill('cleaning supplies')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('Costco Wholesale')
    await page.getByLabel('Search transactions').fill('')

    await page.getByLabel('Filter by category').selectOption('Materials')
    await expect(rows.first()).toBeVisible()
    for (const text of await rows.allInnerTexts()) expect(text).toMatch(/Materials|Split/)
    await page.getByLabel('Filter by category').selectOption('All')

    await page.getByRole('button', { name: /^Matched/ }).click()
    for (const text of await rows.allInnerTexts()) expect(text).toContain('Matched')
  })

  test('opens the next transaction that needs review and moves between them', async ({ page }) => {
    await page.getByRole('button', { name: /Review next/ }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Amazon' })).toBeVisible()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Home Depot' })).toBeVisible()
    await page.getByRole('button', { name: 'Previous' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Amazon' })).toBeVisible()
  })

  test('offers the next transaction after a save', async ({ page }) => {
    await openRow(page, 'Costco Wholesale')
    await lineCard(page, 1).getByLabel(/Category for Coffee and snacks/).selectOption('Meals')
    await page.getByRole('button', { name: /Review 1 change/ }).click()
    await page.locator('.confirmation-box').getByRole('button', { name: 'Confirm (demo)' }).click()
    await page.getByRole('button', { name: /Open next transaction needing review/ }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Home Depot' })).toBeVisible()
  })

  test('keeps demo changes out of QuickBooks Sandbox', async ({ page }) => {
    await openRow(page, 'Costco Wholesale')
    await lineCard(page, 1).getByLabel(/Category for Coffee and snacks/).selectOption('Meals')
    await page.getByRole('button', { name: /Review 1 change/ }).click()
    await page.locator('.confirmation-box').getByRole('button', { name: 'Confirm (demo)' }).click()
    await page.getByRole('button', { name: /All transactions/ }).click()

    await page.locator('.global-source-area').getByRole('button', { name: 'QuickBooks Sandbox' }).click()
    await expect(page.locator('.transaction-row').filter({ hasText: 'Sandbox Supply Co' })).toBeVisible()
    await expect(page.locator('.transaction-row').filter({ hasText: 'Costco Wholesale' })).toHaveCount(0)
    await expect(page.locator('.source-badge')).toHaveText('QuickBooks Sandbox')
  })
})
