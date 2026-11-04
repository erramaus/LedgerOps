import { expect, test, type Page } from '@playwright/test'
import { FakeMonthEnd, FakeReconciliations, mockApp } from './support'

const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })

async function start(page: Page) {
  const reconciliations = new FakeReconciliations()
  const monthEnd = new FakeMonthEnd(reconciliations)
  const harness = await mockApp(page, { reconciliations, monthEnd })
  reconciliations.seedDemo()
  await monthEnd.seedDemo()
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /what needs your attention|here is what needs/i })).toBeVisible()
  return harness
}

test.describe('Dashboard usability', () => {
  test('summary cards are grouped, keep all nine metrics, and open the matching tab', async ({ page }) => {
    await start(page)
    for (const group of ['Clients', 'Review work', 'Money and priorities']) {
      await expect(page.locator('.metric-group-title', { hasText: new RegExp(`^${group}$`) })).toBeVisible()
    }
    await expect(page.locator('.metrics-grid button.metric-card')).toHaveCount(9)

    const cases: [string, RegExp][] = [
      ['Transactions to review', /Transactions/],
      ['Reconciliation issues', /Reconcile/],
      ['Overdue invoices', /Receivables/],
      ['Overdue bills', /Payables/],
      ['Client questions', /Client Requests/],
      ['Month ends open', /Month End/],
      ['High priority', /Inbox/],
    ]
    for (const [label, tab] of cases) {
      await nav(page, /Dashboard/).click()
      await page.locator('button.metric-card').filter({ has: page.locator('.metric-label', { hasText: new RegExp(`^${label}$`) }) }).click()
      await expect(nav(page, tab)).toHaveClass(/active/)
    }
  })

  test("Today's work is prominent, urgent-first, and uses descriptive buttons with relative due dates", async ({ page }) => {
    await start(page)
    const work = page.locator('.work-panel')
    await expect(work).toHaveClass(/work-panel-primary/)
    const actions = await work.locator('.task-action').allInnerTexts()
    expect(actions.length).toBeGreaterThan(0)
    for (const text of actions) expect(text.replace('→', '').trim().length).toBeGreaterThan(4)
    expect(actions.join(' ')).toMatch(/Review (Transaction|Bill|Invoice)|Open Request/)

    const priorities = await work.locator('.priority-badge').allInnerTexts()
    const rank = { High: 0, Medium: 1, Low: 2 } as Record<string, number>
    expect(priorities.map((p) => rank[p])).toEqual([...priorities.map((p) => rank[p])].sort((a, b) => a - b))

    const dueLabels = await work.locator('.due-label').allInnerTexts()
    for (const label of dueLabels) expect(label).toMatch(/^(Overdue by \d+ days?|Due today|Due tomorrow|Due in \d+ days)$/)
    // The real date stays available next to the relative label.
    if (dueLabels.length > 0) await expect(work.locator('.review-card-footer').filter({ has: page.locator('.due-label') }).first()).toContainText(/Due [A-Z][a-z]{2} \d{1,2}, \d{4}/)
  })

  test("a task card still opens its workflow", async ({ page }) => {
    await start(page)
    await page.locator('.work-panel .review-card').first().click()
    await expect(page.locator('.work-panel')).toHaveCount(0)
  })

  test('Your clients shows text status and outstanding counts, and selecting a client works', async ({ page }) => {
    await start(page)
    const cards = page.locator('.client-summary .client-card')
    await expect(cards).toHaveCount(5)
    await expect(page.locator('.status-dot')).toHaveCount(0)
    for (const card of await cards.all()) {
      await expect(card.locator('.client-status')).toHaveText(/^(All clear|Needs attention)$/)
      await expect(card).toContainText(/No outstanding tasks|\d+ outstanding tasks?/)
      await expect(card.locator('.task-action')).toContainText('Open')
    }
    await page.locator('.client-summary .client-card').filter({ hasText: 'Smith Construction' }).click()
    await expect(page.locator('label.client-switcher select')).toHaveValue(/.+/)
    await expect(page.locator('label.client-switcher select option:checked')).toHaveText('Smith Construction')
  })

  test('switching to QuickBooks Sandbox keeps the clickable cards and never fabricates a 0 for the demo figure', async ({ page }) => {
    await start(page)
    await page.getByRole('button', { name: /QuickBooks Sandbox/ }).first().click()
    const card = page.locator('.metrics-grid button.metric-card').filter({ has: page.locator('.metric-label', { hasText: /^Transactions to review$/ }) })
    await expect(card).toBeVisible()
    await expect(card.locator('strong')).not.toHaveText('0')
  })
})
