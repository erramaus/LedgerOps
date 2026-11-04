import { expect, test, type Page } from '@playwright/test'
import { confirmReview, FakeMonthEnd, FakeQuickBooks, FakeReconciliations, mockApp } from './support'

const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })
const group = (page: Page) => page.getByRole('group', { name: 'Accounting period' }).first()
const summary = (page: Page) => page.getByTestId('month-summary')

async function start(page: Page, options: { quickBooks?: FakeQuickBooks } = {}) {
  const reconciliations = new FakeReconciliations()
  const monthEnd = new FakeMonthEnd(reconciliations)
  const harness = await mockApp(page, { quickBooks: options.quickBooks, reconciliations, monthEnd })
  reconciliations.seedDemo()
  await monthEnd.seedDemo()
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
  return harness
}

const openMonthEnd = async (page: Page, month?: number) => {
  await nav(page, /Month End/).click()
  await expect(summary(page)).toBeVisible()
  if (month) {
    await group(page).getByLabel('Month').selectOption(String(month))
    await expect(summary(page)).toBeVisible()
  }
}

test.describe('Month End: progress summary', () => {
  test('explains required checks versus final approval and counts each status', async ({ page }) => {
    await start(page)
    await openMonthEnd(page, 7)
    await expect(page.getByTestId('progress-note')).toContainText(/Steps 1.9 are the required checks/)
    await expect(page.getByTestId('progress-note')).toContainText('final approval')
    const counts = page.getByTestId('progress-counts')
    await expect(page.getByTestId('count-complete')).toContainText('6')
    await expect(page.getByTestId('count-not-started')).toContainText('3')
    await expect(page.getByTestId('count-blocked')).toContainText('0')
    await expect(counts).toBeVisible()
  })

  test('"Show unfinished checks" hides finished steps and can be turned off', async ({ page }) => {
    await start(page)
    await openMonthEnd(page, 7)
    await expect(page.locator('li.me-step')).toHaveCount(9)
    await page.getByLabel('Show unfinished checks').check()
    await expect(page.locator('li.me-step')).toHaveCount(3)
    await expect(page.getByTestId('filter-count')).toContainText('3 of 9')
    await page.getByLabel('Show unfinished checks').uncheck()
    await expect(page.locator('li.me-step')).toHaveCount(9)
  })
})

test.describe('Month End: review confirmation', () => {
  test('shows client, period, figures and exceptions, and Cancel records nothing', async ({ page }) => {
    await start(page)
    await openMonthEnd(page, 8)
    await page.getByRole('button', { name: 'Mark receivables reviewed' }).click()
    const panel = page.getByTestId('confirm-receivables')
    await expect(panel).toContainText('ABC Plumbing')
    await expect(panel).toContainText('August 2026')
    await expect(page.getByTestId('confirm-figures-receivables')).toContainText('2026-08-31')
    await expect(page.getByTestId('confirm-exceptions-receivables')).toContainText('overdue')
    await panel.getByRole('button', { name: 'Cancel' }).click()
    await expect(panel).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark receivables reviewed' })).toBeVisible()
    await expect(page.getByTestId('status-receivables')).not.toHaveText('Complete')
  })

  test('accepting an overdue exception needs a note; a clean review does not', async ({ page }) => {
    await start(page)
    await openMonthEnd(page, 8)
    await page.getByRole('button', { name: 'Mark receivables reviewed' }).click()
    await expect(page.getByRole('button', { name: 'Confirm review' })).toBeDisabled()
    await page.getByLabel(/Note for/).fill('Customer promised payment on the 5th')
    await page.getByRole('button', { name: 'Confirm review' }).click()
    await expect(page.getByRole('button', { name: 'Mark receivables reviewed' })).toHaveCount(0)
    await expect(page.getByTestId('step-receivables')).toContainText('Customer promised payment on the 5th')

    await page.getByRole('button', { name: 'Mark statements reviewed' }).click()
    await expect(page.getByLabel(/Note for/)).toHaveCount(0)
  })

  test('acknowledging reviews never overrides a blocking control', async ({ page }) => {
    await start(page)
    await openMonthEnd(page, 8)
    await confirmReview(page, 'Mark receivables reviewed', 'Accepted overdue balance')
    await confirmReview(page, 'Mark payables reviewed', 'Accepted overdue balance')
    await confirmReview(page, 'Mark statements reviewed', 'Reviewed')
    await expect(page.getByTestId('approval-blocked')).toBeVisible()
    await expect(page.getByRole('button', { name: /Approve and close August 2026/ })).toBeDisabled()
  })
})

test.describe('Month End: navigation keeps the client and month', () => {
  test('with All clients selected, Open Reconcile opens that client workspace', async ({ page }) => {
    await start(page)
    await openMonthEnd(page, 8)
    await page.getByTestId('step-reconcile-bank').getByRole('button', { name: /Open Reconcile/ }).click()
    await expect(page.locator('label.client-switcher select')).toHaveValue(/abc/i)
    await expect(page.getByRole('heading', { name: /Choose a client/i })).toHaveCount(0)
  })

  test('Receivables opens for the same client', async ({ page }) => {
    await start(page)
    await openMonthEnd(page, 8)
    await page.getByTestId('step-receivables').getByRole('button', { name: /Open Receivables/ }).click()
    await expect(page.locator('label.client-switcher select option:checked')).toHaveText(/ABC Plumbing/)
  })
})

test.describe('Month End: QuickBooks separation', () => {
  test('QuickBooks shows month-end figures only, never closes a period and writes nothing', async ({ page }) => {
    const quickBooks = new FakeQuickBooks()
    await start(page, { quickBooks })
    await page.locator('.global-source-area').getByRole('button', { name: 'QuickBooks Sandbox' }).click()
    await nav(page, /Month End/).click()
    await expect(summary(page)).toBeVisible()
    await expect(page.getByText(/Demo/).first()).toBeVisible()
    await expect(page.getByTestId('month-end-storage')).not.toContainText('Temporary local development records are lost')
    expect(quickBooks.writes).toEqual([])
  })
})
