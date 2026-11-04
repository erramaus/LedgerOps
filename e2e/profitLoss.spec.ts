import { expect, test, type Page } from '@playwright/test'
import { demoReport } from '../shared/demoMonthEnd'
import { FakeMonthEnd, FakeQuickBooks, FakeReconciliations, mockApp } from './support'

const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })
const group = (page: Page) => page.getByRole('group', { name: 'Accounting period' }).first()
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
const month = (start: string, end: string, label: string) => ({ start, end, label })
const AUGUST = month('2026-08-01', '2026-08-31', 'August 2026')
const JULY = month('2026-07-01', '2026-07-31', 'July 2026')
const cell = (range: typeof AUGUST, key: string) => demoReport('profit-loss', range).rows.find((row) => row.key === key)!.cells[0]!

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

async function openProfitLoss(page: Page, client: string | null = 'ABC Plumbing') {
  if (client) await page.locator('label.client-switcher select').selectOption({ label: client })
  await nav(page, /Reports/).click()
  await page.getByTestId('open-profit-loss').click()
  await expect(page.getByTestId('report-facts')).toBeVisible()
}

test.describe('Profit and Loss usability', () => {
  test('the summary shows total income, gross profit, total expenses and net income from the same data as the table', async ({ page }) => {
    await start(page)
    await openProfitLoss(page)
    const summary = page.getByTestId('pl-summary')
    await expect(summary).toBeVisible()
    for (const [id, key] of [['income', 'total-income'], ['gross-profit', 'gross-profit'], ['expenses', 'total-expenses'], ['net-income', 'net-income']] as const) {
      const expected = money(cell(AUGUST, key))
      await expect(page.getByTestId(`pl-summary-${id}`)).toContainText(expected)
      await expect(page.getByTestId(`row-${key}`)).toContainText(expected)
    }
    await expect(page.getByTestId('pl-summary-income')).toContainText('$10,980.00')
    await expect(page.getByTestId('pl-summary-net-income')).toContainText('$4,149.18')
  })

  test('only the Profit and Loss report has the summary', async ({ page }) => {
    await start(page)
    await openProfitLoss(page)
    await page.getByRole('button', { name: '← All reports' }).click()
    await page.getByTestId('open-balance-sheet').click()
    await expect(page.getByTestId('report-facts')).toBeVisible()
    await expect(page.getByTestId('pl-summary')).toHaveCount(0)
  })

  test('the verification message separates arithmetic consistency from accounting accuracy', async ({ page }) => {
    await start(page)
    await openProfitLoss(page)
    const checks = page.getByTestId('report-checks')
    await expect(checks).toContainText('Calculations verified — accounting review still required')
    await expect(checks).toContainText('mathematically consistent, not that the transactions behind it are correct or complete')
    await expect(checks).toContainText('Net income agrees with the account activity')
  })

  test('comparison shows the current and previous period, the dollar change and a percentage where it is meaningful', async ({ page }) => {
    await start(page)
    await openProfitLoss(page)
    await page.getByLabel(/Compare with the previous period/).check()
    for (const [id, key] of [['income', 'total-income'], ['net-income', 'net-income']] as const) {
      const now = cell(AUGUST, key)
      const before = cell(JULY, key)
      await expect(page.getByTestId(`pl-summary-${id}`)).toContainText(money(now))
      await expect(page.getByTestId(`pl-previous-${id}`)).toHaveText(money(before))
      await expect(page.getByTestId(`pl-change-${id}`)).toHaveText(money(now - before))
      const percent = before > 0 ? (Math.round(((now - before) * 1000) / before) / 10) : null
      if (percent === null) await expect(page.getByTestId(`pl-percent-${id}`)).toHaveText('Not available')
      else await expect(page.getByTestId(`pl-percent-${id}`)).toHaveText(`${percent > 0 ? '+' : ''}${percent.toFixed(1)}%`)
    }
    await expect(page.getByRole('table', { name: 'Profit and Loss' })).toContainText('Change')
  })

  test('missing prior-period data is Not available, never zero', async ({ page }) => {
    await start(page)
    await openProfitLoss(page)
    await group(page).getByLabel('Month').selectOption('5')
    await page.getByLabel(/Compare with the previous period/).check()
    await expect(page.getByTestId('comparison-unavailable')).toContainText('Not available')
    await expect(page.getByTestId('comparison-unavailable')).toContainText('no reliable previous period')
    await expect(page.getByTestId('pl-previous-income')).toHaveCount(0)
    await expect(page.getByTestId('pl-summary-net-income')).toContainText(money(cell(month('2026-05-01', '2026-05-31', 'May 2026'), 'net-income')))
  })

  test('an unreconciled month is shown as a draft and Open Reconcile keeps the selected client', async ({ page }) => {
    await start(page)
    await openProfitLoss(page)
    await expect(page.getByTestId('report-warnings')).toContainText('Unreconciled accounts at 2026-08-31')
    await expect(page.getByTestId('report-draft-banner')).toContainText('Draft — not final')
    await page.getByRole('button', { name: 'Open Reconcile for ABC Plumbing' }).click()
    await expect(page.getByTestId('storage-label')).toBeVisible()
    await expect(page.getByRole('button', { name: /Start reconciliation for/ }).first()).toBeVisible()
    await expect(page.locator('label.client-switcher select')).toHaveValue(/.+/)
    await expect(page.locator('label.client-switcher select option:checked')).toHaveText('ABC Plumbing')
  })

  test('a reconciled month has no draft banner', async ({ page }) => {
    await start(page)
    await openProfitLoss(page)
    await group(page).getByLabel('Month').selectOption('7')
    await expect(page.getByTestId('pl-summary')).toBeVisible()
    await expect(page.getByTestId('report-warnings')).toHaveCount(0)
    await expect(page.getByTestId('report-draft-banner')).toHaveCount(0)
  })

  test('the printed report carries the company, period, basis, generation date, totals and warnings', async ({ page }) => {
    await start(page)
    await openProfitLoss(page)
    await expect(page.getByTestId('print-header')).toBeHidden()
    await page.emulateMedia({ media: 'print' })
    const header = page.getByTestId('print-header')
    await expect(header).toBeVisible()
    await expect(header).toContainText('ABC Plumbing')
    await expect(header).toContainText('August 2026 (2026-08-01 to 2026-08-31)')
    await expect(header).toContainText('Accounting basis:')
    await expect(header).toContainText('Report generated 2026-10-15')
    await expect(header).toContainText('DRAFT — not final')
    await expect(page.getByTestId('report-warnings')).toBeVisible()
    await expect(page.getByTestId('report-draft-banner')).toBeVisible()
    await expect(page.getByTestId('row-net-income')).toContainText('$4,149.18')
    await expect(page.getByTestId('pl-summary')).toBeVisible()
    await expect(page.locator('.report-detail-toolbar')).toBeHidden()
  })

  test('QuickBooks Sandbox shows only its own figures, its own basis and no Reconcile deep link into demo data', async ({ page }) => {
    const quickBooks = new FakeQuickBooks()
    const { unexpected } = await start(page, { quickBooks })
    await page.locator('.global-source-area').getByRole('button', { name: 'QuickBooks Sandbox' }).click()
    await nav(page, /Reports/).click()
    await page.getByTestId('open-profit-loss').click()
    await expect(page.getByTestId('pl-summary-net-income')).toContainText('$4,499.50')
    await expect(page.getByTestId('report-facts')).toContainText('Accrual')
    await page.emulateMedia({ media: 'print' })
    await expect(page.getByTestId('print-header')).toContainText('Accounting basis: Accrual')
    await expect(page.locator('body')).not.toContainText('$4,149.18')
    await expect(page.locator('body')).not.toContainText('$10,980.00')
    expect(quickBooks.writes).toEqual([])
    expect(unexpected.filter((entry) => !entry.includes('/api/'))).toEqual([])
  })
})
