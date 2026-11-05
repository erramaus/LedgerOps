import { expect, test, type Page } from '@playwright/test'
import { FakeMonthEnd, FakeReconciliations, mockApp } from './support'

/**
 * Phase 11 practice workflows, Demo Mode only. Each test moves through several tabs in sequence for a company
 * and checks that one accounting action shows up everywhere it should and nowhere it should not.
 * Network responses are mocked; the payment and Month End rules run the real server code on memory stores.
 */
const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })
const metric = (page: Page, label: string) => page.locator('.metric-card').filter({ has: page.locator('.metric-label', { hasText: new RegExp(`^${label}$`) }) }).locator('strong')
const chooseClient = (page: Page, name: string) => page.locator('label.client-switcher select').selectOption({ label: name })
const cents = (text: string) => Math.round(Number(text.replace(/[^0-9.-]/g, '')) * 100)
const money = (value: number) => (value / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const pay = (page: Page, kind: 'invoice' | 'bill') => page.getByTestId(`${kind}-payment-actions`)

async function openWorkspace(page: Page) {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
}

async function openFirstOpen(page: Page, tab: 'Receivables' | 'Payables', kind: 'invoice' | 'bill') {
  await nav(page, new RegExp(tab)).click()
  const rows = page.locator('.finance-list-row')
  await expect(rows.first()).toBeVisible()
  const count = await rows.count()
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index)
    if ((await row.locator('.inbox-status').allInnerTexts()).some((status) => status.trim() === 'Paid')) continue
    const reference = ((await row.innerText()).match(/[A-Z]{1,3}-[A-Z]?\d[\w-]*/) ?? [''])[0]
    await row.click()
    await expect(pay(page, kind)).toBeVisible()
    return reference
  }
  throw new Error(`No open ${kind} found`)
}

async function payInFull(page: Page, kind: 'invoice' | 'bill', date = '2026-08-31') {
  const action = pay(page, kind)
  const remaining = cents(await page.getByTestId(`${kind}-remaining`).innerText())
  expect(remaining).toBeGreaterThan(0)
  await action.getByLabel('Payment date').fill(date)
  await action.getByLabel('Payment amount').fill((remaining / 100).toFixed(2))
  const bank = action.getByLabel(kind === 'invoice' ? 'Deposit to bank account' : /Pay from bank account|bank account/i)
  await bank.selectOption({ index: 1 })
  await action.getByRole('button', { name: /Record full payment/ }).click()
  await expect(page.locator('.review-header .inbox-status', { hasText: /^Paid$/ })).toHaveCount(1)
  return remaining
}

const COMPANIES = ['ABC Plumbing', 'Green Leaf Landscaping', 'Smith Construction', 'Johnson Dental', 'Acme Consulting']

test.describe('Phase 11: each demo company, several tabs in sequence', () => {
  test.use({ actionTimeout: 10_000 })

  for (const company of COMPANIES) {
    test(`${company}: paying an invoice updates Dashboard, Reports and Month End and leaves other companies alone`, async ({ page }) => {
      test.setTimeout(120_000)
      const { quickBooks, unexpected } = await mockApp(page)
      await openWorkspace(page)
      const others = COMPANIES.filter((name) => name !== company)
      const otherDashboard = new Map<string, number>()
      for (const name of others.slice(0, 2)) {
        await chooseClient(page, name)
        await nav(page, /Dashboard/).click()
        otherDashboard.set(name, cents(await metric(page, 'Accounts receivable').innerText()))
      }

      await chooseClient(page, company)
      await nav(page, /Dashboard/).click()
      const arBefore = cents(await metric(page, 'Accounts receivable').innerText())

      await openFirstOpen(page, 'Receivables', 'invoice')
      const paid = await payInFull(page, 'invoice')

      await nav(page, /Dashboard/).click()
      await expect(metric(page, 'Accounts receivable')).toHaveText(money(arBefore - paid))

      await nav(page, /Reports/).click()
      await page.getByTestId('open-ar-aging').click()
      await expect(page.getByTestId('report-checks')).toContainText('Agrees with Accounts Receivable')
      await expect(page.getByTestId('row-total')).toContainText(money(arBefore - paid))

      await nav(page, /Month End/).click()
      await expect(page.getByTestId('step-receivables')).toContainText(money(arBefore - paid))

      for (const [name, before] of otherDashboard) {
        await chooseClient(page, name)
        await nav(page, /Dashboard/).click()
        await expect(metric(page, 'Accounts receivable')).toHaveText(money(before))
      }
      expect(quickBooks.writes).toEqual([])
      expect(unexpected).toEqual([])
    })

    test(`${company}: paying a bill reduces payables, a reversal restores them, and the books stay in balance`, async ({ page }) => {
      test.setTimeout(120_000)
      const { quickBooks, unexpected } = await mockApp(page)
      await openWorkspace(page)
      await chooseClient(page, company)
      await nav(page, /Payables/).click()
      const totalCard = page.locator('.finance-summary-grid .summary-card').filter({ hasText: 'Total Bills Due' })
      const before = cents(await totalCard.innerText())

      const billNumber = await openFirstOpen(page, 'Payables', 'bill')
      const paid = await payInFull(page, 'bill')
      await nav(page, /Payables/).click()
      await expect(totalCard).toContainText(money(before - paid))

      // Reverse on the same bill: the payment and its reversal both stay in the history.
      await page.locator('.finance-list-row').filter({ hasText: billNumber }).click()
      await page.getByRole('button', { name: 'Reverse payment' }).first().click()
      await page.getByLabel('Reason for reversal').fill('Practice reversal: entered against the wrong bill.')
      await page.getByRole('button', { name: 'Confirm reversal' }).click()
      await expect(page.getByTestId('payment-history-row').first()).toContainText('Reversed')
      await nav(page, /Payables/).click()
      await expect(totalCard).toContainText(money(before))

      await page.locator('.finance-list-row').filter({ hasText: billNumber }).click()
      await payInFull(page, 'bill')
      await nav(page, /Reports/).click()
      await page.getByTestId('open-ap-aging').click()
      await expect(page.getByTestId('report-checks')).toContainText('Agrees with Accounts Payable')
      await page.getByRole('button', { name: /All reports/ }).click()
      await page.getByTestId('open-balance-sheet').click()
      await expect(page.getByTestId('report-checks')).toBeVisible()
      expect(quickBooks.writes).toEqual([])
      expect(unexpected).toEqual([])
    })
  }
})

test.describe('Phase 11: error recovery', () => {
  test.use({ actionTimeout: 10_000 })

  test('a failed payment request shows an error, records nothing, and a retry succeeds', async ({ page }) => {
    const { demoPayments } = await mockApp(page)
    await openWorkspace(page)
    await chooseClient(page, 'Green Leaf Landscaping')
    await openFirstOpen(page, 'Receivables', 'invoice')
    let fail = true
    await page.route(/\/api\/demo-payments/, async (route) => {
      if (fail && route.request().method() !== 'GET') {
        fail = false
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary server problem.' }) })
        return
      }
      await route.fallback()
    })
    const action = pay(page, 'invoice')
    const remaining = cents(await page.getByTestId('invoice-remaining').innerText())
    await action.getByLabel('Payment date').fill('2026-08-31')
    await action.getByLabel('Payment amount').fill((remaining / 100).toFixed(2))
    await action.getByLabel('Deposit to bank account').selectOption({ index: 1 })
    await action.getByRole('button', { name: /Record full payment/ }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.locator('.review-header .inbox-status', { hasText: /^Paid$/ })).toHaveCount(0)
    expect((await demoPayments.store.list('green-leaf-landscaping')).flatMap((book) => book.payments)).toHaveLength(0)

    await action.getByRole('button', { name: /Record full payment/ }).click()
    await expect(page.locator('.review-header .inbox-status', { hasText: /^Paid$/ })).toHaveCount(1)
    expect((await demoPayments.store.list('green-leaf-landscaping')).flatMap((book) => book.payments)).toHaveLength(1)
  })

  test('a browser refresh keeps recorded payments, and the selected client resets safely to a real company', async ({ page }) => {
    await mockApp(page)
    await openWorkspace(page)
    await chooseClient(page, 'Smith Construction')
    await nav(page, /Receivables/).click()
    const totalBefore = cents(await page.locator('.finance-summary-grid .summary-card').filter({ hasText: 'Total Outstanding' }).innerText())
    await openFirstOpen(page, 'Receivables', 'invoice')
    const paid = await payInFull(page, 'invoice')

    await page.reload()
    await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
    await chooseClient(page, 'Smith Construction')
    await nav(page, /Receivables/).click()
    await expect(page.locator('.finance-summary-grid .summary-card').filter({ hasText: 'Total Outstanding' })).toContainText(money(totalBefore - paid))
  })

  test('Demo reset of one company removes only its payments', async ({ page }) => {
    await mockApp(page)
    await openWorkspace(page)
    const outstanding = async (name: string) => {
      await chooseClient(page, name)
      await nav(page, /Receivables/).click()
      return cents(await page.locator('.finance-summary-grid .summary-card').filter({ hasText: 'Total Outstanding' }).innerText())
    }
    const smithStart = await outstanding('Smith Construction')
    const acmeStart = await outstanding('Acme Consulting')
    await chooseClient(page, 'Smith Construction')
    await openFirstOpen(page, 'Receivables', 'invoice')
    await payInFull(page, 'invoice')
    await chooseClient(page, 'Acme Consulting')
    await openFirstOpen(page, 'Receivables', 'invoice')
    await payInFull(page, 'invoice')

    await nav(page, /Settings/).click()
    await page.getByRole('tab', { name: /^Demo Data/ }).click()
    await page.locator('.demo-reset-card select').selectOption({ label: 'Smith Construction' })
    await page.getByRole('button', { name: 'Review reset' }).click()
    const confirm = page.getByRole('group', { name: 'Confirm demo data reset' })
    await confirm.getByRole('checkbox').check()
    await confirm.getByRole('button', { name: 'Reset demo data' }).click()
    await expect(page.getByRole('status')).toBeVisible()

    expect(await outstanding('Smith Construction')).toBe(smithStart)
    expect(await outstanding('Acme Consulting')).toBeLessThan(acmeStart)
  })
})

test.describe('Phase 11: Month End blockers for every company', () => {
  test.use({ actionTimeout: 10_000 })

  for (const company of COMPANIES) {
    test(`${company}: August cannot be approved while reconciliations and reviews are unfinished`, async ({ page }) => {
      const reconciliations = new FakeReconciliations()
      const monthEnd = new FakeMonthEnd(reconciliations)
      const { unexpected } = await mockApp(page, { reconciliations, monthEnd })
      reconciliations.seedDemo()
      await monthEnd.seedDemo()
      await openWorkspace(page)
      await chooseClient(page, company)
      await nav(page, /Month End/).click()
      const group = page.getByRole('group', { name: 'Accounting period' }).first()
      await group.getByLabel('Month').selectOption('8')
      await group.getByLabel('Year').selectOption('2026')
      await expect(page.getByTestId('month-summary')).toBeVisible()
      await expect(page.getByTestId('status-approval')).toHaveText(/^(Blocked|Not Started|In Progress)$/)
      await expect(page.getByTestId('step-approval')).toContainText(/Not complete|still open|Reconcile|Review/)
      await expect(page.getByRole('button', { name: /Approve and close August 2026/ })).toBeDisabled()
      await expect(page.getByTestId('month-summary')).not.toContainText('Ready for your approval')
      expect(unexpected).toEqual([])
    })
  }
})

test.describe('Phase 11: counts agree between tabs', () => {
  test.use({ actionTimeout: 10_000 })
  const overdueRows = async (page: Page, tab: RegExp) => {
    await nav(page, tab).click()
    await expect(page.locator('.finance-list-row').first()).toBeVisible()
    return page.locator('.finance-list-row').filter({ has: page.locator('.inbox-status.overdue') }).count()
  }
  const inboxOverdue = async (page: Page, noun: 'invoice' | 'bill') => {
    await nav(page, /Inbox/).click()
    await expect(page.locator('.inbox-row').first()).toBeVisible()
    // A bill flagged "needs review" has its own task in addition to its overdue task.
    return page.locator('.inbox-row').filter({ hasText: /Overdue by/ }).filter({ hasText: noun === 'invoice' ? 'Receivables' : 'Payables' }).filter({ hasNotText: 'needs review' }).count()
  }

  // Under All clients the work queue holds item-level tasks for ABC Plumbing only (the other companies
  // contribute summary tasks), so item-level counts are compared per company.
  for (const scope of COMPANIES) {
    test(`${scope}: Inbox overdue invoice and bill tasks match the Receivables and Payables lists`, async ({ page }) => {
      await mockApp(page)
      await openWorkspace(page)
      await chooseClient(page, scope)
      const invoices = await overdueRows(page, /Receivables/)
      const bills = await overdueRows(page, /Payables/)
      expect(invoices + bills).toBeGreaterThan(0)
      expect(await inboxOverdue(page, 'invoice')).toBe(invoices)
      expect(await inboxOverdue(page, 'bill')).toBe(bills)
    })
  }
})