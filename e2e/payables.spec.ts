import { expect, test, type Page } from '@playwright/test'
import { DEMO_CLIENT_ID } from '../shared/demoBooks'
import { getAdditionalDemoCompany } from '../shared/demoCompanyBooks'
import { FakeQuickBooks, mockApp } from './support'

const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })
const rows = (page: Page) => page.locator('.finance-list-row')
const row = (page: Page, text: string) => rows(page).filter({ hasText: text })
const openPayables = async (page: Page) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
  await nav(page, /Payables/).click()
  await expect(page.getByRole('heading', { name: 'Accounts Payable' })).toBeVisible()
}
const group = (page: Page, label: string, name: string | RegExp) => page.getByRole('group', { name: label }).getByRole('button', { name })
const card = (page: Page, label: string) => page.locator('.finance-summary-grid .summary-card').filter({ hasText: label })
const greenLeaf = getAdditionalDemoCompany('green-leaf-landscaping')!
const leafBill = greenLeaf.bills[0]

const qbBills = [
  { id: 'qb-bill-1', vendor: 'Sandbox Vendor', number: 'QB-BILL-1', billDate: 'October 01, 2026', dueDate: 'October 20, 2026', amount: 300, amountPaid: 0, category: 'Supplies', status: 'Open' },
  { id: 'qb-bill-2', vendor: 'Late Vendor', number: 'QB-BILL-2', billDate: 'July 01, 2026', dueDate: 'August 31, 2026', amount: 500, amountPaid: 100, category: 'Supplies', status: 'Partially Paid' },
]

test.describe('Accounts Payable usability and accuracy', () => {
  test('All clients lists every demo company with a Client column; one client shows only its own bills', async ({ page }) => {
    await mockApp(page)
    await openPayables(page)
    await expect(page.locator('.finance-list-heading')).toContainText('Client')
    await expect(row(page, 'HD-88321')).toContainText('ABC Plumbing')
    await expect(row(page, leafBill.number)).toContainText('Green Leaf Landscaping')
    await expect(page.getByTestId('ap-showing')).toContainText('Showing 29 of 29 bills.')

    await page.locator('label.client-switcher select').selectOption({ label: 'Green Leaf Landscaping' })
    await expect(page.locator('.finance-list-heading')).not.toContainText('Client')
    await expect(row(page, leafBill.number)).toHaveCount(1)
    await expect(row(page, 'HD-88321')).toHaveCount(0)
    await expect(page.getByTestId('ap-showing')).toContainText('Showing 6 of 6 bills.')
  })

  test('a late bill that needs review, and a late partially paid bill, show both statuses with relative due dates', async ({ page }) => {
    await mockApp(page)
    await openPayables(page)
    await page.getByLabel('Search bills').fill('HD-88321')
    const review = row(page, 'HD-88321')
    await expect(review.locator('.inbox-status.overdue')).toHaveText('Overdue')
    await expect(review.locator('.inbox-status.needs-review')).toHaveText('Needs Review')
    await expect(review).toContainText('September 17, 2026')
    await expect(review).toContainText('Overdue by 28 days')
    await expect(review.getByText('View Bill')).toBeVisible()
    await group(page, 'Review status', /^Needs Review/).click()
    await group(page, 'Due date', /Overdue \(any\)/).click()
    await expect(rows(page)).toHaveCount(1)
    await page.getByRole('button', { name: 'Reset filters' }).click()
    await expect(page.getByLabel('Search bills')).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Reset filters' })).toHaveCount(0)
  })

  test('shows the as-of date, defines Paid So Far, and filters from the summary cards', async ({ page }) => {
    await mockApp(page)
    await openPayables(page)
    await page.locator('label.client-switcher select').selectOption({ label: 'ABC Plumbing' })
    await expect(page.getByTestId('ap-as-of')).toContainText('October 15, 2026')
    await expect(page.getByTestId('ap-as-of')).toContainText('all time')
    await expect(card(page, 'Total Bills Due')).toContainText('$2,556.44')
    await expect(card(page, 'Overdue')).toContainText('$2,556.44')
    await expect(card(page, 'Due Within 7 Days')).toContainText('$0.00')
    await expect(card(page, 'Paid So Far')).toContainText('$210.00')
    await card(page, 'Paid So Far').click()
    await expect(card(page, 'Paid So Far')).toHaveAttribute('aria-pressed', 'true')
    await expect(rows(page)).toHaveCount(1)
    await expect(row(page, 'UPS-7734')).toContainText('UPS')
    await card(page, 'Paid So Far').click()
    await card(page, 'Overdue').click()
    await expect(rows(page)).toHaveCount(4)
    await expect(page.getByTestId('ap-showing')).toContainText('Showing 4 of 5 bills.')
    await group(page, 'Due date', /60\+ days overdue/).click()
    await expect(rows(page)).toHaveCount(1)
    await expect(row(page, 'SF-0826')).toHaveCount(1)
  })

  test('searches by vendor, number, client and amount together with the three filter groups', async ({ page }) => {
    await mockApp(page)
    await openPayables(page)
    await page.getByLabel('Search bills').fill('verizon')
    await expect(rows(page)).toHaveCount(1)
    await page.getByLabel('Search bills').fill('$1,284.00')
    await expect(row(page, 'HD-88321')).toHaveCount(1)
    await page.getByLabel('Search bills').fill('green leaf')
    await expect(rows(page)).toHaveCount(6)
    await group(page, 'Payment status', /^Paid/).click()
    await expect(page.getByTestId('ap-showing')).toContainText('of 29 bills')
    await page.getByLabel('Search bills').fill('no such vendor')
    await expect(page.locator('.ar-empty')).toContainText('No bills match')
    await page.getByRole('button', { name: 'Reset filters' }).click()
    await expect(page.getByTestId('ap-showing')).toContainText('Showing 29 of 29')
  })

  test('View Bill opens the exact bill with its own client; a payment and its reversal update the cards', async ({ page }) => {
    const { demoPayments, quickBooks, unexpected } = await mockApp(page)
    await openPayables(page)
    await row(page, leafBill.number).click()
    await expect(page.locator('.review-header')).toContainText(leafBill.number)
    await expect(page.locator('label.client-switcher select')).toHaveValue('green-leaf-landscaping')
    await page.getByRole('button', { name: /All bills/ }).click()
    await page.locator('label.client-switcher select').selectOption({ label: 'ABC Plumbing' })

    await row(page, 'SF-0826').click()
    const action = page.getByTestId('bill-payment-actions')
    await action.getByLabel('Payment date').fill('2026-08-31')
    await action.getByLabel('Payment amount').fill('86.00')
    await action.getByLabel('Deposit to bank account').selectOption('chase-checking')
    await action.getByRole('button', { name: 'Record partial payment' }).click()
    await expect(page.locator('.review-header .inbox-status.partially-paid')).toHaveText('Partially Paid')
    await expect(page.locator('.review-header .inbox-status.overdue')).toHaveText('Overdue')
    expect((await demoPayments.store.list(DEMO_CLIENT_ID))[0].payments).toHaveLength(1)
    await page.getByRole('button', { name: /All bills/ }).click()
    await expect(card(page, 'Total Bills Due')).toContainText('$2,470.44')
    await expect(card(page, 'Paid So Far')).toContainText('$296.00')
    await expect(row(page, 'SF-0826').locator('.inbox-status.partially-paid')).toBeVisible()

    await row(page, 'SF-0826').click()
    await page.getByRole('button', { name: 'Reverse payment' }).click()
    await page.getByLabel('Reason for reversal').fill('Entered on the wrong bill')
    await page.getByRole('button', { name: 'Confirm reversal' }).click()
    await page.getByRole('button', { name: /All bills/ }).click()
    await expect(card(page, 'Total Bills Due')).toContainText('$2,556.44')
    await expect(card(page, 'Paid So Far')).toContainText('$210.00')
    await expect(row(page, 'SF-0826').locator('.inbox-status.open')).toBeVisible()
    expect(quickBooks.writes).toEqual([])
    expect(unexpected).toEqual([])
  })

  test('Inbox overdue-bill tasks for a client agree with its Payables overdue bills', async ({ page }) => {
    await mockApp(page)
    await openPayables(page)
    await page.locator('label.client-switcher select').selectOption({ label: 'ABC Plumbing' })
    await group(page, 'Due date', /Overdue \(any\)/).click()
    const overdue = await rows(page).count()
    expect(overdue).toBe(4)
    await nav(page, /Inbox/).click()
    await page.locator('.filter-row').getByRole('button', { name: /^Payables/ }).click()
    // Four overdue bills plus HD-88321's separate review task.
    await expect(page.locator('.inbox-row')).toHaveCount(overdue + 1)
    await expect(page.locator('.inbox-row').filter({ hasText: 'HD-88321' })).toHaveCount(2)
  })

  test('QuickBooks Sandbox bills stay separate, use the same date rules and are read-only', async ({ page }) => {
    const quickBooks = new FakeQuickBooks()
    const { demoPayments, unexpected } = await mockApp(page, { quickBooks })
    await page.route('**/api/quickbooks/bills', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bills: qbBills }) }))
    await openPayables(page)
    await page.locator('.global-source-area').getByRole('button', { name: 'QuickBooks Sandbox' }).click()
    await expect(rows(page)).toHaveCount(2)
    await expect(page.locator('.finance-list-heading')).not.toContainText('Client')
    await expect(row(page, 'HD-88321')).toHaveCount(0)
    await expect(row(page, 'QB-BILL-1')).toContainText('Due in 5 days')
    await expect(row(page, 'QB-BILL-1').locator('.inbox-status.due-soon')).toBeVisible()
    await expect(row(page, 'QB-BILL-2').locator('.inbox-status.partially-paid')).toBeVisible()
    await expect(row(page, 'QB-BILL-2').locator('.inbox-status.overdue')).toBeVisible()
    await expect(card(page, 'Due Within 7 Days')).toContainText('$300.00')
    await expect(card(page, 'Overdue')).toContainText('$400.00')
    await row(page, 'QB-BILL-2').click()
    await expect(page.getByTestId('bill-payment-actions')).toContainText('Record or reverse this payment in QuickBooks')
    expect(await demoPayments.store.list(DEMO_CLIENT_ID)).toEqual([])
    expect(quickBooks.writes).toEqual([])
    expect(unexpected).toEqual([])
  })
})
