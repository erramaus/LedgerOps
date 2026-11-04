import { expect, test, type Page } from '@playwright/test'
import { confirmReview, FakeMonthEnd, FakeReconciliations, mockApp } from './support'

/**
 * A professional bookkeeper's working day in Demo Data, using only the visible interface.
 * Everything below talks to mocked network responses; the month-end and reconciliation rules run the real server code
 * on memory stores. It does NOT verify the real QuickBooks or Postgres integrations.
 */
const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })
const metric = (page: Page, label: string) => page.locator('.metric-card').filter({ has: page.locator('.metric-label', { hasText: new RegExp(`^${label}$`) }) }).locator('strong')
const inboxCard = (page: Page, label: string) =>
  page.locator('.filter-row .filter-button').filter({ hasText: new RegExp(`^${label === 'Client questions' ? 'Client Requests' : 'Transactions'}`) }).locator('span')
const number = async (locator: ReturnType<Page['locator']>) => Number((await locator.innerText()).replace(/[^0-9]/g, ''))
const clicks = (page: Page) => page.evaluate(() => (window as unknown as { __clicks: number }).__clicks)
const resetClicks = (page: Page) => page.evaluate(() => { (window as unknown as { __clicks: number }).__clicks = 0 })
const chooseClient = (page: Page, name: string) => page.locator('label.client-switcher select').selectOption({ label: name })
const group = (page: Page) => page.getByRole('group', { name: 'Accounting period' }).first()
const choosePeriod = async (page: Page, month: number) => {
  await group(page).getByLabel('Month').selectOption(String(month))
  await group(page).getByLabel('Year').selectOption('2026')
}

async function start(page: Page) {
  await page.addInitScript(() => {
    ;(window as unknown as { __clicks: number }).__clicks = 0
    document.addEventListener('click', () => { (window as unknown as { __clicks: number }).__clicks += 1 }, true)
  })
  const reconciliations = new FakeReconciliations()
  const monthEnd = new FakeMonthEnd(reconciliations)
  const harness = await mockApp(page, { reconciliations, monthEnd })
  reconciliations.seedDemo()
  await monthEnd.seedDemo()
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
  return { ...harness, reconciliations, monthEnd }
}

test.describe('a bookkeeper works through the whole month in Demo Data', () => {
  test.use({ actionTimeout: 10_000 })
  test('dashboard to closed month: every step uses the right client, updates immediately and stays consistent', async ({ page }) => {
    test.setTimeout(240_000)
    const { quickBooks, unexpected, monthEnd } = await start(page)

    await test.step('1. The Dashboard shows what is outstanding, per client', async () => {
      await expect(page.getByRole('heading', { name: /what needs your attention/i })).toBeVisible()
      expect(await number(metric(page, 'Clients'))).toBe(5)
      expect(await number(metric(page, 'Transactions to review'))).toBeGreaterThan(0)
      const work = page.locator('.work-panel')
      await expect(work).toContainText('ABC Plumbing')
      await expect(work).toContainText('Overdue invoice')
      for (const name of ['ABC Plumbing', 'Green Leaf Landscaping', 'Smith Construction', 'Johnson Dental', 'Acme Consulting']) {
        await expect(page.locator('.client-card').filter({ hasText: name })).toBeVisible()
      }
    })

    await test.step('2. Choosing a generated client scopes every tab to its own company books', async () => {
      await chooseClient(page, 'Smith Construction')
      await nav(page, /Transactions/).click()
      await expect(page.locator('.transaction-row').filter({ hasText: 'Northstar Electric' }).first()).toBeVisible()
      await nav(page, /Reconcile/).click()
      await expect(page.getByRole('button', { name: 'Start reconciliation for Smith Construction Corporate Card' })).toBeVisible()
      await nav(page, /Receivables/).click()
      await expect(page.locator('.finance-list-row').filter({ hasText: 'SC-I202608' })).toBeVisible()
      await nav(page, /Payables/).click()
      await expect(page.locator('.finance-list-row').filter({ hasText: 'SC-B202608' })).toBeVisible()
      await nav(page, /Reports/).click()
      await expect(page.getByTestId('open-profit-loss')).toBeVisible()
      await nav(page, /Month End/).click()
      await expect(page.locator('.month-end-hero')).toContainText('SMITH CONSTRUCTION')
      await nav(page, /Client Requests/).click()
      await expect(page.locator('.request-card').filter({ hasText: 'Northstar Electric' })).toBeVisible()
      await expect(page.locator('body')).not.toContainText('Home Depot')
      await expect(page.locator('body')).not.toContainText('Westview Apartments')
      await nav(page, /Inbox/).click()
      await expect(page.getByText(/Showing: Smith Construction/)).toBeVisible()
      const rows = page.locator('.inbox-row')
      expect(await rows.count()).toBeGreaterThan(0)
      for (const text of await rows.allInnerTexts()) expect(text).toContain('Smith Construction')
      await chooseClient(page, 'ABC Plumbing')
      await nav(page, /Inbox/).click()
      await expect(page.getByText(/Showing: ABC Plumbing/)).toBeVisible()
      for (const text of await page.locator('.inbox-row').allInnerTexts()) expect(text).toContain('ABC Plumbing')
    })

    let uncategorizedBefore = 0
    await test.step('3 and 4. The Inbox leads straight to an uncategorized transaction, with no searching', async () => {
      await resetClicks(page)
      uncategorizedBefore = await number(inboxCard(page, 'Transactions to review'))
      await page.locator('.inbox-row').filter({ hasText: 'Amazon has no category or account.' }).click()
      await expect(page.getByRole('heading', { level: 2, name: 'Amazon' })).toBeVisible()
      expect(await clicks(page)).toBe(1)
    })

    await test.step('4. Categorizing uses the suggested rule, saves immediately and clears the task everywhere', async () => {
      await resetClicks(page)
      const suggestion = page.getByTestId('rule-suggestion')
      await expect(suggestion).toContainText('Amazon office supplies')
      await suggestion.getByRole('button', { name: 'Use rule suggestion' }).click()
      await page.getByRole('button', { name: /Review 1 change/ }).click()
      await page.locator('.confirmation-box').getByRole('button', { name: 'Confirm (demo)' }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Saved (demo data only)' })).toBeVisible()
      expect(await clicks(page)).toBe(3)
      await nav(page, /Inbox/).click()
      await expect(page.locator('.inbox-row').filter({ hasText: 'Amazon has no category or account.' })).toHaveCount(0)
      expect(await number(inboxCard(page, 'Transactions to review'))).toBeLessThan(uncategorizedBefore)
    })

    await test.step('5. A split transaction is categorized line by line, and only becomes Categorized when every line has a category', async () => {
      await nav(page, /^.?\s*Transactions/).click()
      await page.locator('.transaction-row').filter({ hasText: 'Costco Wholesale' }).click()
      const lines = page.getByTestId('transaction-line')
      await expect(lines).toHaveCount(3)
      await lines.nth(1).getByLabel(/Category for Coffee and snacks/).selectOption('Meals')
      await page.getByRole('button', { name: /Review 1 change/ }).click()
      await page.locator('.confirmation-box').getByRole('button', { name: 'Confirm (demo)' }).click()
      await expect(page.locator('.review-details')).toContainText('Needs Review')
      await expect(lines.nth(2)).toContainText('Needs a category')
      await lines.nth(2).getByLabel(/Category for Cleaning supplies/).selectOption('Other')
      await page.getByRole('button', { name: /Review 1 change/ }).click()
      await page.locator('.confirmation-box').getByRole('button', { name: 'Confirm (demo)' }).click()
      await expect(page.locator('.review-details')).toContainText('Categorized')
      // The three lines still add up to the transaction total.
      await expect(page.locator('.review-details')).toContainText('$286.40')
      const amounts = (await lines.locator('.line-card-head strong:last-child').allInnerTexts()).map((text) => Math.round(Number(text.replace(/[$,]/g, '')) * 100))
      expect(amounts.reduce((sum, cents) => sum + cents, 0)).toBe(28_640)
    })

    await test.step('6. Possible duplicates and missing information are listed in Bookkeeping Review', async () => {
      await nav(page, /Bookkeeping Review/).click()
      await expect(page.locator('.review-card').filter({ hasText: /May need receipt|Possible duplicate|Missing payee|Large transaction/ }).first()).toBeVisible()
    })

    await test.step('7. A client question is answered and resolved, and leaves the outstanding work', async () => {
      await nav(page, /Inbox/).click()
      const questionsBefore = await number(inboxCard(page, 'Client questions'))
      expect(questionsBefore).toBeGreaterThan(0)
      await page.locator('.filter-row').getByRole('button', { name: /^Client Requests/ }).click()
      await page.locator('.inbox-row').filter({ hasText: 'Waiting on client' }).first().click()
      await expect(page.getByRole('heading', { name: /Question for the client/ })).toBeVisible()
      await page.getByRole('button', { name: /^Materials/ }).click()
      await expect(page.locator('.answer-box')).toContainText('Materials')
      await page.getByRole('button', { name: /Mark Resolved/ }).click()
      await expect(page.getByText('This request is resolved.')).toBeVisible()
      await nav(page, /Inbox/).click()
      expect(await number(inboxCard(page, 'Client questions'))).toBe(questionsBefore - 1)
    })

    await test.step('8. The bank account reconciles to exactly $0.00, and an outstanding deposit is shown separately', async () => {
      await nav(page, /Reconcile/).click()
      await page.getByRole('button', { name: 'Start reconciliation for Chase Business Checking' }).click()
      await page.getByRole('button', { name: 'Load the demo statement transactions' }).click()
      await page.getByRole('button', { name: /Continue to matching/ }).click()
      await page.getByRole('button', { name: /Clear all suggested matches/ }).click()
      await page.getByTestId('bulk-confirm').getByRole('button', { name: /^Confirm/ }).click()
      await expect(page.getByTestId('remaining-difference')).toHaveText('$0.00')
      // Leave the deposit uncleared: it becomes a deposit in transit and the difference is exactly its amount.
      await page.getByRole('button', { name: /Mark uncleared: ABC Plumbing Customer/ }).click()
      await expect(page.getByTestId('remaining-difference')).toContainText('5,000.00')
      await page.getByRole('navigation', { name: 'Reconciliation steps' }).getByRole('button', { name: '4. Review & complete' }).click()
      await expect(page.getByText('Deposits in transit').first()).toBeVisible()
      await expect(page.getByRole('button', { name: /Complete reconciliation/ })).toBeDisabled()
      await page.getByRole('navigation', { name: 'Reconciliation steps' }).getByRole('button', { name: '3. Match' }).click()
      await page.getByRole('button', { name: /Mark cleared: ABC Plumbing Customer/ }).click()
      await expect(page.getByTestId('remaining-difference')).toHaveText('$0.00')
      await page.getByRole('navigation', { name: 'Reconciliation steps' }).getByRole('button', { name: '4. Review & complete' }).click()
      await page.getByRole('button', { name: /Complete reconciliation/ }).click()
      await expect(page.getByTestId('completed-banner')).toBeVisible()
    })

    await test.step('9. The credit card does not balance: the difference is exactly $224.20 and the reason is explained', async () => {
      await nav(page, /Reconcile/).click()
      await page.getByRole('button', { name: 'Start reconciliation for Chase Business Credit Card' }).click()
      await page.getByRole('button', { name: 'Load the demo statement transactions' }).click()
      await page.getByRole('button', { name: /Continue to matching/ }).click()
      await page.getByRole('button', { name: /Clear all suggested matches/ }).click()
      await page.getByTestId('bulk-confirm').getByRole('button', { name: /^Confirm/ }).click()
      await expect(page.getByTestId('remaining-difference')).toHaveText('$224.20')
      await page.getByRole('navigation', { name: 'Reconciliation steps' }).getByRole('button', { name: '4. Review & complete' }).click()
      await expect(page.getByTestId('explanations')).toContainText('HOME DEPOT')
      await expect(page.getByRole('button', { name: /Complete reconciliation/ })).toBeDisabled()
    })

    await test.step('10. Receivables and payables show figures calculated from the invoices and bills', async () => {
      await nav(page, /Receivables/).click()
      const cards = page.locator('.finance-summary-grid .summary-card')
      await expect(cards.filter({ hasText: 'Total Outstanding' })).toContainText('$8,420.00')
      // Four invoices are past due or current today; the aging columns add up to the total.
      const values = await cards.locator('strong').allInnerTexts()
      const cents = values.map((text) => Math.round(Number(text.replace(/[$,]/g, '')) * 100))
      expect(cents.slice(1).reduce((sum, value) => sum + value, 0)).toBe(cents[0])
      await nav(page, /Payables/).click()
      await expect(page.locator('.finance-summary-grid .summary-card').filter({ hasText: 'Total Bills Due' })).toContainText('$2,556.44')
      await expect(page.locator('.finance-summary-grid .summary-card').filter({ hasText: 'Paid So Far' })).toContainText('$210.00')
    })

    await test.step('11. The reports agree with each other and with the other tabs', async () => {
      await nav(page, /Reports/).click()
      await page.getByTestId('open-profit-loss').click()
      await expect(page.getByTestId('row-net-income')).toContainText('$4,149.18')
      await expect(page.getByTestId('report-checks')).toContainText('Arithmetic verified')
      await page.getByRole('button', { name: '\u2190 All reports' }).click()
      await page.getByTestId('open-ar-aging').click()
      await expect(page.getByTestId('row-total')).toContainText('$8,420.00')
      await page.getByRole('button', { name: '\u2190 All reports' }).click()
      await page.getByTestId('open-ap-aging').click()
      await expect(page.getByTestId('row-total')).toContainText('$2,556.44')
      await nav(page, /Dashboard/).click()
      await expect(page.locator('.metric-card').filter({ hasText: 'Profit' }).locator('strong')).toHaveText('$4,149.18')
    })

    await test.step('12 and 13. July is completed and closed, with the evidence recorded', async () => {
      await nav(page, /Month End/).click()
      await choosePeriod(page, 7)
      await expect(page.getByTestId('month-summary')).toBeVisible()
      for (const name of ['Mark receivables reviewed', 'Mark payables reviewed', 'Mark statements reviewed']) await confirmReview(page, name)
      await expect(page.getByTestId('month-summary')).toContainText('Ready for your approval')
      await page.getByRole('button', { name: /Approve and close July 2026/ }).click()
      await expect(page.getByTestId('status-approval')).toHaveText('Complete')
    })

    await test.step('14. Reopening needs a reason and the audit history shows who, when and why', async () => {
      await page.getByLabel('Reason for reopening this month').fill('Client sent a corrected July invoice')
      await page.getByRole('button', { name: /Reopen July 2026/ }).click()
      const history = page.getByTestId('month-history')
      await expect(history).toContainText('Month closed')
      await expect(history).toContainText('Month reopened')
      await expect(history).toContainText('Client sent a corrected July invoice')
      await expect(history).toContainText('e2e@example.com')
    })

    await test.step('15. Switching clients never mixes records', async () => {
      await chooseClient(page, 'Green Leaf Landscaping')
      await nav(page, /Month End/).click()
      await expect(page.locator('.month-end-hero')).toContainText('GREEN LEAF LANDSCAPING')
      await expect(page.getByTestId('month-summary')).toBeVisible()
      const greenLeafRecords = await monthEnd.store.list({ source: 'demo', clientId: 'green-leaf-landscaping' })
      expect(greenLeafRecords).toHaveLength(6)
      expect(greenLeafRecords.every((record) => record.clientName === 'Green Leaf Landscaping')).toBe(true)
      await chooseClient(page, 'ABC Plumbing')
      await nav(page, /Month End/).click()
      await expect(page.getByTestId('month-history')).toContainText('Client sent a corrected July invoice')
    })

    expect(quickBooks.writes).toEqual([])
    expect(monthEnd.badCsrf).toBe(0)
    expect(unexpected).toEqual([])
  })
})
