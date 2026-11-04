import { expect, test, type Page } from '@playwright/test'
import { FakeReconciliations, mockApp } from './support'

const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })
const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) })

async function openSettings(page: Page, options: Parameters<typeof mockApp>[1] = {}) {
  await mockApp(page, options)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
  await nav(page, /Settings/).click()
  await expect(page.getByRole('heading', { name: 'Settings', level: 2 })).toBeVisible()
}

test.describe('Phase 10: Settings organization', () => {
  test('shows four sections and switches between them', async ({ page }) => {
    await openSettings(page)
    const names = ['Connections', 'Automation Rules', 'Demo Data', 'Activity & History']
    await expect(page.getByRole('tab')).toHaveCount(4)
    for (const name of names) await expect(tab(page, name)).toBeVisible()
    await expect(tab(page, 'Connections')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: 'QuickBooks Online' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Reset Demo Data' })).toBeHidden()

    await tab(page, 'Demo Data').click()
    await expect(page.getByRole('heading', { name: 'Reset Demo Data' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'QuickBooks Online' })).toBeHidden()

    await tab(page, 'Activity & History').click()
    await expect(page.getByTestId('history-audit')).toBeVisible()
    await expect(page.getByRole('tabpanel')).toHaveCount(1)
  })

  test('supports arrow-key navigation between section tabs', async ({ page }) => {
    await openSettings(page)
    await tab(page, 'Connections').focus()
    await page.keyboard.press('ArrowRight')
    await expect(tab(page, 'Automation Rules')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(tab(page, 'Connections')).toHaveAttribute('aria-selected', 'true')
  })

  test('keeps unsaved rule edits while switching sections', async ({ page }) => {
    await openSettings(page)
    await tab(page, 'Automation Rules').click()
    await page.getByLabel('Rule name').fill('Draft rule')
    await tab(page, 'Demo Data').click()
    await expect(page.getByTestId('rule-unsaved')).toBeVisible()
    await tab(page, 'Automation Rules').click()
    await expect(page.getByLabel('Rule name')).toHaveValue('Draft rule')
  })
})

test.describe('Phase 10: Automation rules', () => {
  test('edit loads the saved suggested category and keeps Preview separate from Existing Rules', async ({ page }) => {
    await openSettings(page)
    await tab(page, 'Automation Rules').click()
    await page.getByLabel('Rule name').fill('Cafe meals rule')
    await page.getByLabel('Vendor / payee contains').fill('Corner Cafe')
    await page.getByLabel('Suggested category').selectOption({ index: 2 })
    const chosen = await page.getByLabel('Suggested category').evaluate((el) => (el as HTMLSelectElement).value)
    await page.getByRole('button', { name: 'Create rule' }).click()

    await expect(page.getByTestId('rules-list')).toContainText('Cafe meals rule')
    await expect(page.getByTestId('rule-preview')).not.toContainText('Cafe meals rule')
    await page.getByTestId('rule-row').filter({ hasText: 'Cafe meals rule' }).getByRole('button', { name: /edit/i }).click()
    await expect(page.getByLabel('Rule name')).toHaveValue('Cafe meals rule')
    await expect(page.getByLabel('Suggested category')).toHaveValue(chosen)
    await expect(page.getByRole('group', { name: 'Rule details' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Match conditions' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Suggested action' })).toBeVisible()
  })
})

test.describe('Phase 10: QuickBooks connection status', () => {
  test('shows Connected when the server says so', async ({ page }) => {
    await openSettings(page)
    await expect(page.getByTestId('qb-connection-state')).toHaveAttribute('data-state', 'connected')
    await expect(page.getByTestId('qb-connection-state')).toHaveText('Connected')
    await expect(page.getByTestId('dev-bypass-note')).toHaveCount(0)
  })

  test('shows Authentication required and the bypass note without a Connect button under the dev bypass', async ({ page }) => {
    await openSettings(page, { devBypass: true })
    await expect(page.getByTestId('qb-connection-state')).toHaveAttribute('data-state', 'auth-required')
    await expect(page.getByTestId('qb-connection-state')).toHaveText('Authentication required')
    await expect(page.getByTestId('dev-bypass-note')).toContainText(/real/i)
    await expect(page.getByRole('button', { name: /connect to quickbooks/i })).toHaveCount(0)
  })

  test('shows Backend unavailable when the request cannot reach the server', async ({ page }) => {
    await mockApp(page)
    await page.route('**/api/quickbooks/status', (route) => route.abort('connectionrefused'))
    await page.goto('./')
    await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
    await nav(page, /Settings/).click()
    await expect(page.getByTestId('qb-connection-state')).toHaveAttribute('data-state', 'backend-unavailable')
    await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible()
  })

  test('shows Connection error when the backend answers with an error', async ({ page }) => {
    await mockApp(page)
    await page.route('**/api/quickbooks/status', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Token refresh failed' }) }))
    await page.goto('./')
    await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
    await nav(page, /Settings/).click()
    await expect(page.getByTestId('qb-connection-state')).toHaveAttribute('data-state', 'error')
    await expect(page.getByTestId('qb-connection-detail')).toContainText('Token refresh failed')
  })

  test('shows Not connected with a Connect action', async ({ page }) => {
    await mockApp(page)
    await page.route('**/api/quickbooks/status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: false, environment: 'sandbox' }) }))
    await page.goto('./')
    await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
    await nav(page, /Settings/).click()
    await expect(page.getByTestId('qb-connection-state')).toHaveAttribute('data-state', 'not-connected')
    await expect(page.getByRole('button', { name: /connect/i }).first()).toBeVisible()
  })
})

test.describe('Phase 10: Demo data, storage and history', () => {
  test('reports temporary storage and never shows connection strings', async ({ page }) => {
    await openSettings(page, { reconciliations: new FakeReconciliations() })
    await tab(page, 'Demo Data').click()
    await expect(page.getByTestId('storage-state')).toHaveAttribute('data-state', 'temporary')
    await expect(page.getByTestId('storage-card')).not.toContainText(/postgres(ql)?:\/\//i)
    await expect(page.getByTestId('storage-card')).not.toContainText('DATABASE_URL')
  })

  test('reports database-backed storage when the backend says so', async ({ page }) => {
    const reconciliations = new FakeReconciliations()
    reconciliations.durable = true
    await openSettings(page, { reconciliations })
    await tab(page, 'Demo Data').click()
    await expect(page.getByTestId('storage-state')).toHaveAttribute('data-state', 'durable')
  })

  test('reports unknown storage when the status endpoint fails', async ({ page }) => {
    await mockApp(page)
    await page.route('**/api/reconciliations/storage', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.goto('./')
    await expect(page.getByRole('heading', { name: /get to work/i })).toBeVisible()
    await nav(page, /Settings/).click()
    await tab(page, 'Demo Data').click()
    await expect(page.getByTestId('storage-state')).toHaveAttribute('data-state', 'unavailable')
  })

  test('explains reset scope and requires confirmation', async ({ page }) => {
    await openSettings(page)
    await tab(page, 'Demo Data').click()
    const card = page.locator('.demo-reset-card')
    await expect(card).toContainText('One company')
    await expect(card).toContainText('All five demo companies')
    await expect(card).toContainText(/QuickBooks, sign-in, sessions/)
    await card.getByRole('button', { name: 'Review reset' }).click()
    const confirm = page.getByRole('group', { name: 'Confirm demo data reset' })
    const reset = confirm.getByRole('button', { name: 'Reset demo data' })
    await expect(reset).toBeDisabled()
    await confirm.getByRole('checkbox').check()
    await expect(reset).toBeEnabled()
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toHaveCount(0)
  })

  test('labels each history as temporary, browser-only or calculated', async ({ page }) => {
    await openSettings(page)
    await tab(page, 'Activity & History').click()
    await expect(page.getByTestId('history-audit')).toContainText('This session only')
    await expect(page.getByTestId('history-automation')).toContainText('Saved in this browser only')
    await expect(page.getByTestId('history-recurring')).toContainText('Calculated from current transactions')
  })
})

test.describe('Phase 10: Settings responsive layout', () => {
  test('does not overflow horizontally on a narrow screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await openSettings(page)
    await tab(page, 'Automation Rules').click()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    const fields = page.locator('.settings-fields').first()
    await expect(fields).toBeVisible()
    const box = await fields.boundingBox()
    expect(box!.x + box!.width).toBeLessThanOrEqual(376)
  })
})

test.describe('Phase 10: Demo and QuickBooks separation in Settings', () => {
  test('rules are labelled with their data source and the demo reset never touches QuickBooks routes', async ({ page }) => {
    const calls: string[] = []
    page.on('request', (request) => { if (request.method() !== 'GET') calls.push(new URL(request.url()).pathname) })
    await openSettings(page)
    await tab(page, 'Automation Rules').click()
    await expect(page.locator('.automation-rules-card')).toContainText(/demo/i)
    expect(calls.filter((path) => path.startsWith('/api/quickbooks'))).toEqual([])
  })
})
