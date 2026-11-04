import { expect, test, type Page } from '@playwright/test'
import { FakeMonthEnd, FakeReconciliations, mockApp } from './support'

const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })
const count = async (page: Page, name: RegExp) =>
  Number((await page.locator('.filter-row .filter-button').filter({ hasText: name }).locator('span').innerText()).replace(/\D/g, ''))

async function start(page: Page) {
  const reconciliations = new FakeReconciliations()
  const monthEnd = new FakeMonthEnd(reconciliations)
  await mockApp(page, { reconciliations, monthEnd })
  reconciliations.seedDemo()
  await monthEnd.seedDemo()
  await page.goto('./')
  await nav(page, /Inbox/).click()
  await expect(page.locator('.inbox-row').first()).toBeVisible()
}

test.describe('Inbox usability', () => {
  test('total is prominent, categories keep their counts, and the duplicate summary cards are gone', async ({ page }) => {
    await start(page)
    await expect(page.locator('.summary-card')).toHaveCount(0)
    await expect(page.locator('.attention-summary')).toContainText(/\d+ items need attention/)
    await expect(page.locator('.attention-summary')).toContainText(/\d+ ready for you · \d+ waiting on others/)
    for (const name of ['All', 'Transactions', 'Receivables', 'Payables', 'Reconciliation', 'Client Requests', 'Month End']) {
      await expect(page.locator('.filter-row .filter-button').filter({ hasText: new RegExp(`^${name}`) })).toBeVisible()
    }
  })

  test('due column shows a relative label with the real date, and rows use descriptive actions', async ({ page }) => {
    await start(page)
    const dated = page.locator('.inbox-row').filter({ has: page.locator('.inbox-due strong') })
    expect(await dated.count()).toBeGreaterThan(0)
    for (const text of await dated.locator('.inbox-due strong').allInnerTexts()) {
      expect(text).toMatch(/^(Overdue by \d+ days?|Due today|Due tomorrow|Due in \d+ days)$/)
    }
    await expect(dated.first().locator('.inbox-due small')).toContainText(/[A-Z][a-z]{2} \d{1,2}, \d{4}/)
    for (const text of await page.locator('.inbox-action').allInnerTexts()) expect(text).toMatch(/^(Review|Open|Finish|Categorize|Add|Request|Compare|Find|Send|Reply)\b/i)
    await expect(page.locator('.inbox-row .row-arrow')).toHaveCount(0)
    for (const text of await page.locator('.inbox-row').allInnerTexts()) expect(text).not.toMatch(/ is overdue\.?$/m)
  })

  test('search combines with category, priority and status filters and shows an empty state', async ({ page }) => {
    await start(page)
    const all = await page.locator('.inbox-row').count()
    const search = page.getByLabel('Search')
    await search.fill('amazon')
    await expect(page.locator('.inbox-row').first()).toContainText(/amazon/i)
    expect(await page.locator('.inbox-row').count()).toBeLessThan(all)
    await expect(page.getByRole('status')).toContainText(/Showing \d+ of \d+ items/)
    for (const text of await page.locator('.inbox-row').allInnerTexts()) expect(text.toLowerCase()).toContain('amazon')

    await page.locator('.filter-row').getByRole('button', { name: /^Payables/ }).click()
    await expect(page.locator('.empty-state')).toContainText('No tasks match')
    await page.locator('.filter-row').getByRole('button', { name: /^All/ }).click()
    await search.fill('')
    await page.getByLabel('Priority').selectOption('High')
    for (const text of await page.locator('.inbox-row .priority-badge').allInnerTexts()) expect(text).toBe('High')
    await search.fill('zzzz-no-match')
    await expect(page.locator('.empty-state')).toContainText('No tasks match')
  })

  test('ready-for-me and waiting views split the same queue without changing totals', async ({ page }) => {
    await start(page)
    const total = await count(page, /^All/)
    await page.getByLabel('Work').selectOption('waiting')
    const waiting = await count(page, /^All/)
    for (const text of await page.locator('.inbox-status').allInnerTexts()) expect(text).toContain('Waiting on client')
    await page.getByLabel('Work').selectOption('ready')
    const ready = await count(page, /^All/)
    for (const text of await page.locator('.inbox-status').allInnerTexts()) expect(text).not.toContain('Waiting on client')
    expect(ready + waiting).toBe(total)
    await expect(page.locator('.attention-summary')).toContainText(`${total} items need attention`)
  })

  test('the action button opens the exact record and keeps the client selected', async ({ page }) => {
    await start(page)
    const row = page.locator('.inbox-row').filter({ hasText: 'Amazon has no category or account.' }).first()
    const client = (await row.locator('strong').first().innerText()).trim()
    await expect(row.getByRole('button', { name: 'Review Transaction' })).toBeVisible()
    await row.getByRole('button', { name: 'Review Transaction' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Amazon' })).toBeVisible()
    await expect(nav(page, /Transactions/)).toHaveClass(/active/)
    await expect(page.locator('label.client-switcher select option:checked')).toHaveText(client)
  })

  test('Dashboard and Inbox share the same queue count', async ({ page }) => {
    await start(page)
    const inbox = await count(page, /^All/)
    await nav(page, /Dashboard/).click()
    await page.getByRole('button', { name: /QuickBooks Sandbox/ }).first().click()
    await nav(page, /Inbox/).click()
    await expect(page.locator('.attention-summary')).not.toContainText(`${inbox} items`)
  })
})
