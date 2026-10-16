import { expect, test, type Page } from '@playwright/test'
import { DEMO_CLIENT_ID } from '../shared/demoBooks'
import { FakeQuickBooks, mockApp } from './support'

const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })
const openWorkspace = async (page: Page) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
}
const openDocument = async (page: Page, tab: 'Receivables' | 'Payables', reference: string) => {
  await nav(page, new RegExp(tab)).click()
  await page.locator('.finance-list-row').filter({ hasText: reference }).click()
}
const payAction = (page: Page, kind: 'invoice' | 'bill') => page.getByTestId(`${kind}-payment-actions`)
const summaryCard = (page: Page, label: string) => page.locator('.finance-summary-grid .summary-card').filter({ hasText: label })
const metric = (page: Page, label: string) => page.locator('.metric-card').filter({ has: page.locator('.metric-label', { hasText: new RegExp(`^${label}$`) }) }).locator('strong')

async function enterPayment(page: Page, kind: 'invoice' | 'bill', amount: string, date = '2026-08-31') {
  const action = payAction(page, kind)
  await action.getByLabel('Payment date').fill(date)
  await action.getByLabel('Payment amount').fill(amount)
  await action.getByLabel('Deposit to bank account').selectOption('chase-checking')
  return action
}

test.describe('Demo Mode invoice and bill payments', () => {
  test('partial and full invoice payments update AR, checking, reports, Dashboard, Month End, Transactions and the bank register', async ({ page }) => {
    const { demoPayments, quickBooks, unexpected } = await mockApp(page)
    await openWorkspace(page)
    await openDocument(page, 'Receivables', 'INV-1004')

    const action = await enterPayment(page, 'invoice', '500.00')
    await expect(action.getByTestId('invoice-projected-remaining')).toContainText('$1,480.00')
    await action.getByRole('button', { name: 'Record partial payment' }).click()
    await expect(page.locator('.detail-list')).toContainText('$1,480.00')
    await expect(page.getByTestId('invoice-remaining')).toHaveText('$1,480.00')

    await enterPayment(page, 'invoice', '1480.00')
    await payAction(page, 'invoice').getByRole('button', { name: 'Record full payment $1,480.00' }).click()
    await expect(page.locator('.review-header .inbox-status')).toHaveText('Paid')
    await expect(page.getByTestId('payment-history-row')).toHaveCount(2)
    expect((await demoPayments.store.list(DEMO_CLIENT_ID))[0].payments.map((payment) => payment.amountCents)).toEqual([50_000, 148_000])
    expect(quickBooks.writes).toEqual([])

    await nav(page, /Transactions/).click()
    const receiptRows = page.locator('.transaction-row').filter({ hasText: 'INV-1004' })
    await expect(receiptRows).toHaveCount(2)
    await expect(receiptRows.filter({ hasText: '$500.00' })).toHaveCount(1)
    await expect(receiptRows.filter({ hasText: '$1,480.00' })).toHaveCount(1)

    await nav(page, /Reports/).click()
    await page.getByTestId('open-general-ledger').click()
    await expect(page.locator('.report-paper')).toContainText('INV-1004')
    await expect(page.locator('.report-paper')).toContainText('$1,480.00')
    await page.getByRole('button', { name: '← All reports' }).click()
    await page.getByTestId('open-profit-loss').click()
    await expect(page.getByTestId('row-net-income')).toContainText('$4,149.18')
    await expect(page.getByTestId('report-checks')).toContainText('Arithmetic verified')
    await page.getByRole('button', { name: '← All reports' }).click()
    await page.getByTestId('open-ar-aging').click()
    await expect(page.getByTestId('row-total')).toContainText('$6,440.00')
    await expect(page.getByTestId('report-checks')).toContainText('Agrees with Accounts Receivable')

    await page.locator('label.client-switcher select').selectOption({ label: 'ABC Plumbing' })
    await nav(page, /Dashboard/).click()
    await expect(metric(page, 'Accounts receivable')).toHaveText('$6,440.00')
    await expect(metric(page, 'Bank balance')).toHaveText('$50,401.72')

    await nav(page, /Month End/).click()
    await expect(page.getByTestId('step-receivables')).toContainText('totalling $6,440.00')
    await nav(page, /Reconcile/).click()
    await page.getByRole('button', { name: 'Start reconciliation for Chase Business Checking' }).click()
    await page.getByRole('button', { name: 'Load the demo statement transactions' }).click()
    await page.getByLabel(/This is the first reconciliation here/).check()
    await page.getByRole('button', { name: /Continue to matching/ }).click()
    const registerRows = page.getByTestId('recon-row').filter({ hasText: 'Pinecrest HOA' })
    await expect(registerRows).toHaveCount(2)
    expect(unexpected).toEqual([])
  })

  test('bill payments reduce AP and checking, preserve expense, and reversal restores the balance with history', async ({ page }) => {
    const { demoPayments, quickBooks, unexpected } = await mockApp(page)
    await openWorkspace(page)
    await openDocument(page, 'Payables', 'HD-88321')

    let action = await enterPayment(page, 'bill', '600.00')
    await expect(action.getByTestId('bill-projected-remaining')).toContainText('$684.00')
    await action.getByRole('button', { name: 'Record partial payment' }).click()
    await expect(page.locator('.detail-list')).toContainText('$684.00')
    await expect(page.getByTestId('bill-remaining')).toHaveText('$684.00')
    await page.getByRole('button', { name: '← All bills' }).click()
    await expect(summaryCard(page, 'Total Bills Due')).toContainText('$1,956.44')
    await page.locator('.finance-list-row').filter({ hasText: 'HD-88321' }).click()

    await page.getByRole('button', { name: 'Reverse payment' }).click()
    await page.getByLabel('Reason for reversal').fill('Vendor payment was sent twice')
    await page.getByRole('button', { name: 'Confirm reversal' }).click()
    await expect(page.getByTestId('bill-remaining')).toHaveText('$1,284.00')
    await expect(page.getByTestId('payment-history-row').first()).toContainText('Reversed')
    await expect(page.getByTestId('payment-history-row').first()).toContainText('Vendor payment was sent twice')

    action = await enterPayment(page, 'bill', '1284.00')
    await expect(action.getByRole('button', { name: 'Record full payment $1,284.00' })).toBeEnabled()
    await action.getByRole('button', { name: 'Record full payment $1,284.00' }).click()
    await expect(page.locator('.review-header .inbox-status')).toHaveText('Paid')
    await expect(page.getByTestId('payment-history-row')).toHaveCount(2)
    expect((await demoPayments.store.list(DEMO_CLIENT_ID))[0].payments[0].history).toHaveLength(2)

    await nav(page, /Reports/).click()
    await page.getByTestId('open-profit-loss').click()
    await expect(page.getByTestId('row-net-income')).toContainText('$4,149.18')
    await page.getByRole('button', { name: '← All reports' }).click()
    await page.getByTestId('open-ap-aging').click()
    await expect(page.getByTestId('row-total')).toContainText('$1,272.44')
    await expect(page.getByTestId('report-checks')).toContainText('Agrees with Accounts Payable')
    await nav(page, /Transactions/).click()
    await expect(page.locator('.transaction-row').filter({ hasText: 'HD-88321' })).toHaveCount(3)
    expect(quickBooks.writes).toEqual([])
    expect(unexpected).toEqual([])
  })

  test('prevents overpayment and duplicate payment posting', async ({ page }) => {
    const { demoPayments } = await mockApp(page)
    await openWorkspace(page)
    await openDocument(page, 'Receivables', 'INV-1005')
    const action = payAction(page, 'invoice')
    await action.getByLabel('Payment amount').fill('1650.01')
    await expect(action).toContainText('Exceeds remaining balance by $0.01')
    await expect(action.getByRole('button', { name: /Record/ })).toBeDisabled()
    expect(await demoPayments.store.list(DEMO_CLIENT_ID)).toEqual([])

    await openDocument(page, 'Receivables', 'INV-1003')
    await enterPayment(page, 'invoice', '50.00')
    await payAction(page, 'invoice').getByRole('button', { name: 'Record partial payment' }).click()
    expect((await demoPayments.store.list(DEMO_CLIENT_ID)).flatMap((book) => book.payments)).toHaveLength(1)
    await enterPayment(page, 'invoice', '50.00')
    await payAction(page, 'invoice').getByRole('button', { name: 'Record partial payment' }).click()
    await expect(page.getByRole('alert')).toContainText('already recorded for this document')
    expect((await demoPayments.store.list(DEMO_CLIENT_ID)).flatMap((book) => book.payments)).toHaveLength(1)
  })

  test('keeps payment books client-scoped and QuickBooks invoice and bill details read-only', async ({ page }) => {
    const quickBooks = new FakeQuickBooks()
    const { demoPayments, unexpected } = await mockApp(page, { quickBooks })
    await openWorkspace(page)
    await openDocument(page, 'Receivables', 'INV-1005')
    await enterPayment(page, 'invoice', '50.00')
    await payAction(page, 'invoice').getByRole('button', { name: 'Record partial payment' }).click()
    expect(await demoPayments.store.list('green-leaf-landscaping')).toEqual([])

    await page.locator('label.client-switcher select').selectOption({ label: 'Green Leaf Landscaping' })
    await nav(page, /Receivables/).click()
    await expect(page.locator('.page-content')).toContainText('Green Leaf Landscaping')
    await expect(page.locator('.finance-list-row').filter({ hasText: 'GL-I202608' })).toBeVisible()
    await expect(page.locator('.finance-list-row').filter({ hasText: 'INV-1005' })).toHaveCount(0)

    await page.route('**/api/quickbooks/invoices', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ invoices: [{ id: 'qb-invoice-1', customer: 'Sandbox Customer', number: 'QB-INV-1', invoiceDate: 'August 01, 2026', dueDate: 'August 31, 2026', amount: 500, amountPaid: 0, status: 'Open' }] }) }))
    await page.route('**/api/quickbooks/bills', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bills: [{ id: 'qb-bill-1', vendor: 'Sandbox Vendor', number: 'QB-BILL-1', billDate: 'August 01, 2026', dueDate: 'August 31, 2026', amount: 400, amountPaid: 0, category: 'Materials', status: 'Open' }] }) }))
    await page.locator('.global-source-area').getByRole('button', { name: 'QuickBooks Sandbox' }).click()
    await nav(page, /Receivables/).click()
    await page.locator('.finance-list-row').filter({ hasText: 'QB-INV-1' }).click()
    await expect(page.getByTestId('invoice-payment-actions')).toContainText('Record or reverse this payment in QuickBooks')
    await expect(page.getByRole('form', { name: 'Customer payment form' })).toHaveCount(0)
    await nav(page, /Payables/).click()
    await page.locator('.finance-list-row').filter({ hasText: 'QB-BILL-1' }).click()
    await expect(page.getByTestId('bill-payment-actions')).toContainText('Record or reverse this payment in QuickBooks')
    await expect(page.getByRole('form', { name: 'Vendor payment form' })).toHaveCount(0)
    expect(demoPayments.mutations).toBe(1)
    expect(await demoPayments.store.list(DEMO_CLIENT_ID)).toHaveLength(1)
    expect(quickBooks.writes).toEqual([])
    expect(unexpected).toEqual([])
  })
})
