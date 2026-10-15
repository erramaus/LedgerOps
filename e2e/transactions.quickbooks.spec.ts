import { expect, test, type Page } from '@playwright/test'
import { CSRF_TOKEN, FakeQuickBooks, mockApp } from './support'

const openQuickBooksTransactions = async (page: Page) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
  await page.locator('.global-source-area').getByRole('button', { name: 'QuickBooks Sandbox' }).click()
  await page.locator('nav.main-nav').getByRole('button', { name: /Transactions/ }).click()
  await expect(page.locator('.transaction-row').first()).toBeVisible()
}

const openRow = (page: Page, text: string) => page.locator('.transaction-row').filter({ hasText: text }).click()
const lineCard = (page: Page, index: number) => page.getByTestId('transaction-line').nth(index)

test.describe('QuickBooks Sandbox (mocked)', () => {
  test('lists the transaction’s real lines, with the paid-from account kept separate', async ({ page }) => {
    await mockApp(page)
    await openQuickBooksTransactions(page)
    await openRow(page, 'Sandbox Supply Co')
    await expect(page.locator('.review-details')).toContainText('Sandbox Credit Card')
    await expect(page.getByTestId('transaction-line')).toHaveCount(3)
    await expect(lineCard(page, 2)).toContainText('Needs a category')
    await expect(lineCard(page, 0)).toContainText('Office Supplies')
  })

  test('sends nothing until confirmed, then updates only the chosen line with the CSRF token', async ({ page }) => {
    const { quickBooks } = await mockApp(page)
    await openQuickBooksTransactions(page)
    await openRow(page, 'Sandbox Supply Co')

    await lineCard(page, 2).getByLabel(/Category for Cleaning supplies/).selectOption('Job Materials')
    await page.getByRole('button', { name: /Review 1 change/ }).click()
    await expect(page.locator('.confirmation-box')).toContainText('update this transaction in QuickBooks Sandbox')
    await page.locator('.confirmation-box').getByRole('button', { name: 'Cancel' }).click()
    expect(quickBooks.writes).toHaveLength(0)

    await page.getByRole('button', { name: /Review 1 change/ }).click()
    await page.locator('.confirmation-box').getByRole('button', { name: 'Confirm update' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Updated in QuickBooks Sandbox' })).toBeVisible()

    expect(quickBooks.writes).toHaveLength(1)
    const [write] = quickBooks.writes
    expect(write.path).toMatch(/\/transactions\/Purchase\/42\/lines$/)
    expect(write.csrf).toBe(CSRF_TOKEN)
    expect(write.body).toEqual({ syncToken: '5', expectedTotal: 286.4, changes: [{ lineId: '3', accountId: '40' }] })

    await expect(lineCard(page, 0)).toContainText('Office Supplies')
    await expect(lineCard(page, 1)).toContainText('Meals')
    await expect(lineCard(page, 2)).toContainText('Job Materials')
    await expect(page.locator('.review-details')).toContainText('Categorized')
  })

  test('only offers expense accounts as categories', async ({ page }) => {
    await mockApp(page)
    await openQuickBooksTransactions(page)
    await openRow(page, 'Sandbox Supply Co')
    const options = await lineCard(page, 2).getByRole('combobox').locator('option').allTextContents()
    expect(options).toEqual(expect.arrayContaining(['Keep current', 'Office Supplies', 'Meals', 'Job Materials']))
    expect(options).not.toContain('Checking')
    expect(options).not.toContain('Uncategorized Expense')
  })

  test('makes unsupported transactions read-only', async ({ page }) => {
    await mockApp(page)
    await openQuickBooksTransactions(page)
    for (const [payee, reason] of [['Sandbox Customer', /read-only here/i], ['Parts Warehouse', /item-based/i]] as const) {
      await openRow(page, payee)
      await expect(page.getByRole('status').filter({ hasText: 'Read-only' })).toContainText(reason)
      await expect(page.locator('.page-content').getByRole('combobox')).toHaveCount(0)
      await expect(page.getByRole('button', { name: /Review .*change/ })).toHaveCount(0)
      await page.getByRole('button', { name: /All transactions/ }).click()
    }
  })

  test('shows a stale-data error, keeps the books unchanged and lets the user reload', async ({ page }) => {
    const quickBooks = new FakeQuickBooks()
    quickBooks.onWrite = () => ({ status: 409, json: { error: 'This transaction changed in QuickBooks after you opened it. Reload it and review the lines again.', code: 'STALE' } })
    await mockApp(page, { quickBooks })
    await openQuickBooksTransactions(page)
    await openRow(page, 'Sandbox Supply Co')

    await lineCard(page, 2).getByLabel(/Category for Cleaning supplies/).selectOption('Job Materials')
    await page.getByRole('button', { name: /Review 1 change/ }).click()
    await page.locator('.confirmation-box').getByRole('button', { name: 'Confirm update' }).click()

    const alert = page.getByRole('alert').filter({ hasText: 'changed in QuickBooks' })
    await expect(alert).toBeVisible()
    await expect(lineCard(page, 2)).toContainText('Needs a category')
    await expect(page.getByRole('status').filter({ hasText: 'Updated in QuickBooks Sandbox' })).toHaveCount(0)

    const loadsBefore = quickBooks.transactionLoads
    await alert.getByRole('button', { name: 'Reload from QuickBooks' }).click()
    await expect.poll(() => quickBooks.transactionLoads).toBeGreaterThan(loadsBefore)
  })

  test('reports other write failures without marking anything saved', async ({ page }) => {
    const quickBooks = new FakeQuickBooks()
    quickBooks.onWrite = () => ({ status: 502, json: { error: 'QuickBooks is temporarily unavailable. Nothing was changed; try again shortly.', code: 'UNAVAILABLE' } })
    await mockApp(page, { quickBooks })
    await openQuickBooksTransactions(page)
    await openRow(page, 'Sandbox Supply Co')
    await lineCard(page, 2).getByLabel(/Category for Cleaning supplies/).selectOption('Job Materials')
    await page.getByRole('button', { name: /Review 1 change/ }).click()
    await page.locator('.confirmation-box').getByRole('button', { name: 'Confirm update' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'temporarily unavailable' })).toBeVisible()
    await expect(lineCard(page, 2)).toContainText('Needs a category')
    expect(quickBooks.writes).toHaveLength(1)
  })

  test('refreshes the Settings audit log with one entry per changed line', async ({ page }) => {
    await mockApp(page)
    await openQuickBooksTransactions(page)
    await openRow(page, 'Sandbox Supply Co')
    await lineCard(page, 2).getByLabel(/Category for Cleaning supplies/).selectOption('Job Materials')
    await page.getByRole('button', { name: /Review 1 change/ }).click()
    await page.locator('.confirmation-box').getByRole('button', { name: 'Confirm update' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Updated in QuickBooks Sandbox' })).toBeVisible()

    await page.locator('nav.main-nav').getByRole('button', { name: /Settings/ }).click()
    const log = page.locator('.audit-log-row')
    await expect(log).toHaveCount(1)
    await expect(log).toContainText('Success')
    await expect(log).toContainText('line 3')
    await expect(log).toContainText('Uncategorized Expense')
    await expect(log).toContainText('Job Materials')
  })
})
