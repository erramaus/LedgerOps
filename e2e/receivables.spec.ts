import { expect, test, type Page } from '@playwright/test'
import { DEMO_CLIENT_ID } from '../shared/demoBooks'
import { FakeQuickBooks, mockApp } from './support'

const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })
const rows = (page: Page) => page.locator('.finance-list-row')
const row = (page: Page, text: string) => rows(page).filter({ hasText: text })
const openReceivables = async (page: Page) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
  await nav(page, /Receivables/).click()
  await expect(page.getByRole('heading', { name: 'Accounts Receivable' })).toBeVisible()
}
const payment = (page: Page, name: string) => page.getByRole('group', { name: 'Payment status' }).getByRole('button', { name })
const aging = (page: Page, name: string) => page.getByRole('group', { name: 'Aging' }).getByRole('button', { name })
const card = (page: Page, label: string) => page.locator('.finance-summary-grid .summary-card').filter({ hasText: label })

test.describe('Accounts Receivable usability and accuracy', () => {
  test('All clients lists every demo company with a Client column; one client shows only its own invoices', async ({ page }) => {
    await mockApp(page)
    await openReceivables(page)
    await expect(page.locator('.finance-list-heading')).toContainText('Client')
    for (const number of ['INV-1004', 'GL-I202608', 'SC-I202608', 'JD-I202608', 'AC-I202608']) await expect(row(page, number)).toHaveCount(1)
    await expect(row(page, 'GL-I202608')).toContainText('Green Leaf Landscaping')
    await expect(row(page, 'INV-1004')).toContainText('ABC Plumbing')

    await page.locator('label.client-switcher select').selectOption({ label: 'Green Leaf Landscaping' })
    await expect(page.locator('.finance-list-heading')).not.toContainText('Client')
    await expect(row(page, 'GL-I202608')).toHaveCount(1)
    await expect(row(page, 'INV-1004')).toHaveCount(0)
    await expect(row(page, 'SC-I202608')).toHaveCount(0)
  })

  test('an invoice that is partially paid and past due shows both statuses and a relative due date', async ({ page }) => {
    await mockApp(page)
    await openReceivables(page)
    const partial = row(page, 'INV-1002')
    await expect(partial.locator('.inbox-status.partially-paid')).toHaveText('Partially Paid')
    await expect(partial.locator('.inbox-status.overdue')).toHaveText('Overdue')
    await expect(partial).toContainText('September 04, 2026')
    await expect(partial).toContainText('Overdue by 41 days')
    // Counted by both filters: payment status and aging are independent.
    await payment(page, /Partially Paid/).click()
    await aging(page, /Overdue \(any\)/).click()
    await expect(row(page, 'INV-1002')).toHaveCount(1)
    const shown = await rows(page).count()
    await expect(page.getByTestId('ar-showing')).toContainText(`Showing ${shown} of `)
    // A paid invoice is never overdue and has no relative label.
    await page.getByRole('button', { name: 'Reset filters' }).click()
    await expect(row(page, 'INV-1001')).not.toContainText('Overdue')
  })

  test('shows the as-of date and filters by clicking an aging card', async ({ page }) => {
    await mockApp(page)
    await openReceivables(page)
    await expect(page.getByTestId('ar-as-of')).toContainText('October 15, 2026')
    // INV-1004 is 30 days late (due Sep 15) and INV-1005 is 24 days late.
    await card(page, '1-30 Days Overdue').click()
    await expect(card(page, '1-30 Days Overdue')).toHaveAttribute('aria-pressed', 'true')
    await expect(row(page, 'INV-1004')).toHaveCount(1)
    await expect(row(page, 'INV-1005')).toHaveCount(1)
    await expect(row(page, 'INV-1001')).toHaveCount(0)
    await expect(row(page, 'INV-1003')).toHaveCount(0)
    await card(page, '1-30 Days Overdue').click()
    await expect(row(page, 'INV-1003')).toHaveCount(1)
  })

  test('searches by customer, number and amount together with filters, and resets', async ({ page }) => {
    await mockApp(page)
    await openReceivables(page)
    await page.getByLabel('Search invoices').fill('pinecrest')
    await expect(rows(page)).toHaveCount(1)
    await page.getByLabel('Search invoices').fill('INV-1005')
    await expect(rows(page)).toHaveCount(1)
    await page.getByLabel('Search invoices').fill('$1,980.00')
    await expect(row(page, 'INV-1004')).toHaveCount(1)
    await page.getByLabel('Search invoices').fill('no such customer')
    await expect(page.locator('.ar-empty')).toContainText('No invoices match')
    await page.getByRole('button', { name: 'Reset filters' }).click()
    await expect(page.getByLabel('Search invoices')).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Reset filters' })).toHaveCount(0)
    await expect(row(page, 'INV-1004')).toHaveCount(1)
  })

  test('View Invoice opens the exact invoice with its own client, and a payment updates status and Dashboard', async ({ page }) => {
    const { demoPayments, quickBooks, unexpected } = await mockApp(page)
    await openReceivables(page)
    await expect(row(page, 'GL-I202608').getByText('View Invoice')).toBeVisible()
    await row(page, 'GL-I202608').click()
    await expect(page.locator('.review-header')).toContainText('GL-I202608')
    await expect(page.locator('label.client-switcher select')).toHaveValue('green-leaf-landscaping')

    await page.getByRole('button', { name: /All invoices/ }).click()
    await page.locator('label.client-switcher select').selectOption({ label: 'ABC Plumbing' })
    await row(page, 'INV-1005').click()
    const action = page.getByTestId('invoice-payment-actions')
    await action.getByLabel('Payment date').fill('2026-08-31')
    await action.getByLabel('Payment amount').fill('50.00')
    await action.getByLabel('Deposit to bank account').selectOption('chase-checking')
    await action.getByRole('button', { name: 'Record partial payment' }).click()
    await expect(page.locator('.review-header .inbox-status.partially-paid')).toHaveText('Partially Paid')
    await expect(page.locator('.review-header .inbox-status.overdue')).toHaveText('Overdue')
    expect((await demoPayments.store.list(DEMO_CLIENT_ID))[0].payments).toHaveLength(1)

    await page.getByRole('button', { name: /All invoices/ }).click()
    await expect(row(page, 'INV-1005').locator('.inbox-status.partially-paid')).toBeVisible()
    expect(quickBooks.writes).toEqual([])
    expect(unexpected).toEqual([])
  })

  test('QuickBooks Sandbox invoices stay separate and read-only', async ({ page }) => {
    const quickBooks = new FakeQuickBooks()
    const { demoPayments, unexpected } = await mockApp(page, { quickBooks })
    await page.route('**/api/quickbooks/invoices', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ invoices: [{ id: 'qb-invoice-1', customer: 'Sandbox Customer', number: 'QB-INV-1', invoiceDate: 'August 01, 2026', dueDate: 'August 31, 2026', amount: 500, amountPaid: 100, status: 'Partially Paid' }] }) }))
    await openReceivables(page)
    await page.locator('.global-source-area').getByRole('button', { name: 'QuickBooks Sandbox' }).click()
    await expect(rows(page)).toHaveCount(1)
    await expect(row(page, 'QB-INV-1')).toContainText('Overdue by 45 days')
    await expect(row(page, 'QB-INV-1').locator('.inbox-status.partially-paid')).toBeVisible()
    await expect(page.locator('.finance-list-heading')).not.toContainText('Client')
    await expect(row(page, 'INV-1004')).toHaveCount(0)
    await row(page, 'QB-INV-1').click()
    await expect(page.getByTestId('invoice-payment-actions')).toContainText('Record or reverse this payment in QuickBooks')
    expect(await demoPayments.store.list(DEMO_CLIENT_ID)).toEqual([])
    expect(quickBooks.writes).toEqual([])
    expect(unexpected).toEqual([])
  })
})
