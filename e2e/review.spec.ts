import { expect, test, type Page } from '@playwright/test'
import { FakeMonthEnd, FakeReconciliations, mockApp } from './support'

const nav = (page: Page, name: RegExp) => page.locator('nav.main-nav').getByRole('button', { name })
const chooseClient = (page: Page, name: string) => page.locator('label.client-switcher select').selectOption({ label: name })
const card = (page: Page, label: string) => page.locator('.summary-card').filter({ hasText: label }).locator('strong')
const num = async (page: Page, label: string) => Number((await card(page, label).innerText()).replace(/\D/g, ''))
const inboxTotal = async (page: Page) => {
  await nav(page, /Inbox/).click()
  return Number((await page.locator('.attention-summary strong').innerText()).replace(/\D/g, ''))
}

async function start(page: Page) {
  const reconciliations = new FakeReconciliations()
  const monthEnd = new FakeMonthEnd(reconciliations)
  const mocks = await mockApp(page, { reconciliations, monthEnd })
  reconciliations.seedDemo()
  await monthEnd.seedDemo()
  await page.goto('./')
  await nav(page, /Bookkeeping Review/).click()
  await expect(page.locator('.finding-card').first()).toBeVisible()
  await expect(page.getByText(/Review decisions are on the server/)).toBeVisible()
  return mocks
}

const amazon = (page: Page) => page.locator('.finding-card').filter({ hasText: 'Amazon has no category or account.' })

test.describe('Bookkeeping Review usability', () => {
  test('shows accounting findings only, with summary counts that match the findings', async ({ page }) => {
    await start(page)
    for (const label of ['Total review findings', 'Possible duplicates', 'Categorization issues', 'Missing information']) await expect(card(page, label)).toBeVisible()
    await expect(page.locator('.summary-card').filter({ hasText: /High Priority|Medium Priority|Low Priority/ })).toHaveCount(0)
    await expect(page.locator('.finding-card').filter({ hasText: /Overdue invoice|Overdue bill|Bill due soon|Expected recurring/ })).toHaveCount(0)
    const total = await num(page, 'Total review findings')
    // A summary-only client row can stand for several items, so there are never more cards than findings.
    expect(await page.locator('.finding-card').count()).toBeLessThanOrEqual(total)
    const categorization = await num(page, 'Categorization issues')
    await page.getByLabel('Finding type').selectOption('categorization')
    expect(await page.locator('.finding-card').count()).toBe(categorization)
    // Reminders still live in the Inbox.
    await nav(page, /Inbox/).click()
    await expect(page.locator('.inbox-row').getByRole('button', { name: /^Review (Bill|Invoice)/ }).first()).toBeVisible()
  })

  test('every finding explains what, why, client, priority, status and next action', async ({ page }) => {
    await start(page)
    const finding = amazon(page)
    await expect(finding).toContainText('What was detected')
    await expect(finding).toContainText('Why it was flagged')
    await expect(finding).toContainText('Next action')
    await expect(finding.locator('.priority-badge')).toBeVisible()
    await expect(finding.locator('.finding-status')).toHaveText('Open')
    await expect(finding).toContainText('ABC Plumbing')
    await expect(page.locator('.finding-card').filter({ hasText: /May need receipt|Large transaction/ }).first()).toContainText('Possible issue, not a confirmed error')
  })

  test('search and filters combine, with an empty state', async ({ page }) => {
    await start(page)
    const all = await page.locator('.finding-card').count()
    await page.getByLabel('Search').fill('amazon')
    expect(await page.locator('.finding-card').count()).toBeLessThan(all)
    for (const text of await page.locator('.finding-card').allInnerTexts()) expect(text.toLowerCase()).toContain('amazon')
    await page.getByLabel('Priority').selectOption('Low')
    await expect(page.locator('.empty-state')).toContainText('No findings match')
    await page.getByLabel('Priority').selectOption('All')
    await page.getByLabel('Finding type').selectOption('duplicate')
    await expect(page.locator('.empty-state')).toBeVisible()
  })

  test('dismissing needs a reason, removes the finding from Review and Inbox, persists, and can be reopened', async ({ page }) => {
    await start(page)
    const beforeReview = await num(page, 'Total review findings')
    const beforeInbox = await inboxTotal(page)
    await nav(page, /Bookkeeping Review/).click()

    await amazon(page).getByRole('button', { name: 'Dismiss finding' }).click()
    await expect(amazon(page).getByRole('button', { name: 'Confirm dismiss' })).toBeDisabled()
    await amazon(page).getByLabel('Reason for dismissing').fill('Receipt on file')
    await amazon(page).getByRole('button', { name: 'Confirm dismiss' }).click()
    await expect(amazon(page)).toHaveCount(0)
    expect(await num(page, 'Total review findings')).toBe(beforeReview - 1)
    expect(await inboxTotal(page)).toBe(beforeInbox - 1)
    await expect(page.locator('.inbox-row').filter({ hasText: 'Amazon has no category or account.' })).toHaveCount(0)

    await nav(page, /Bookkeeping Review/).click()
    await page.reload()
    await nav(page, /Bookkeeping Review/).click()
    expect(await num(page, 'Total review findings')).toBe(beforeReview - 1)
    await page.getByLabel('Review status').selectOption('Dismissed')
    await expect(amazon(page)).toContainText('Reason: Receipt on file')
    await page.getByRole('button', { name: 'View review decisions' }).click()
    await expect(page.locator('.decision-history')).toContainText('Dismissed')
    await expect(page.locator('.decision-history')).toContainText('Receipt on file')
    await expect(page.getByText(/Review decisions are on the server/)).toBeVisible()

    await amazon(page).getByRole('button', { name: 'Reopen finding' }).click()
    await page.getByLabel('Review status').selectOption('Active')
    await expect(amazon(page)).toBeVisible()
    expect(await num(page, 'Total review findings')).toBe(beforeReview)
  })

  test('a dismissed finding returns when its source record has changed', async ({ page }) => {
    const mocks = await start(page)
    await amazon(page).getByRole('button', { name: 'Dismiss finding' }).click()
    await amazon(page).getByLabel('Reason for dismissing').fill('Checked')
    await amazon(page).getByRole('button', { name: 'Confirm dismiss' }).click()
    await expect(amazon(page)).toHaveCount(0)
    const saved = mocks.reviewDecisions.records[0]
    mocks.reviewDecisions.replaceLatestFingerprint(saved.clientId, saved.findingId, 'older-version')
    await page.reload()
    await nav(page, /Bookkeeping Review/).click()
    await expect(amazon(page)).toContainText('source record changed')
  })

  test('a failed server save keeps the finding open and does not report it as saved', async ({ page }) => {
    const mocks = await start(page)
    mocks.reviewDecisions.failNextAppend = true
    await amazon(page).getByRole('button', { name: 'Dismiss finding' }).click()
    await amazon(page).getByLabel('Reason for dismissing').fill('Checked with the source record')
    await amazon(page).getByRole('button', { name: 'Confirm dismiss' }).click()
    await expect(page.getByRole('alert')).toContainText('could not be loaded or saved')
    await expect(amazon(page)).toBeVisible()
    await expect(page.getByText('Saved review history is unavailable. No browser fallback was used.')).toBeVisible()

    await page.getByRole('button', { name: 'Retry loading review decisions' }).click()
    await amazon(page).getByLabel('Reason for dismissing').fill('Checked with the source record')
    await amazon(page).getByRole('button', { name: 'Confirm dismiss' }).click()
    await expect(amazon(page)).toHaveCount(0)
  })

  test('legacy browser decisions are not loaded automatically and can be explicitly exported', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('ledgerops-review-decisions-v1', JSON.stringify([{
        id: 'legacy-id',
        source: 'demo',
        clientId: 'abc-plumbing',
        clientName: 'ABC Plumbing',
        findingId: 'txn-001-category',
        findingType: 'categorization',
        issue: 'Uncategorized transaction',
        description: 'Amazon has no category or account.',
        priority: 'High',
        status: 'reviewing',
        at: '2026-01-01T00:00:00.000Z',
        fingerprint: 'legacy-fingerprint',
      }]))
    })
    await start(page)
    await expect(amazon(page)).toBeVisible()
    await expect(amazon(page).locator('.finding-status')).toHaveText('Open')
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export legacy browser decisions' }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe('ledgerops-legacy-review-decisions.json')
    await expect(page.getByRole('status').filter({ hasText: 'not imported or trusted' })).toBeVisible()
    await expect(page.locator('.decision-history')).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('ledgerops-review-decisions-v1'))).toContain('legacy-id')
  })

  test('a server load error is visible and decisions can be retried without browser fallback', async ({ page }) => {
    const mocks = await mockApp(page)
    mocks.reviewDecisions.failNextList = 2
    await page.goto('./')
    await nav(page, /Bookkeeping Review/).click()
    await expect(page.getByRole('alert')).toContainText('could not be loaded or saved')
    await expect(page.getByText('Saved review history is unavailable. No browser fallback was used.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Retry loading review decisions' })).toBeVisible()
    mocks.reviewDecisions.records.push({
      source: 'demo',
      clientId: 'abc-plumbing',
      findingId: 'untrusted-legacy',
      version: 1,
      at: new Date().toISOString(),
      id: 'legacy',
      status: 'dismissed',
      fingerprint: 'any',
    })
    await page.getByRole('button', { name: 'Retry loading review decisions' }).click()
    await expect(page.getByText(/Review decisions are on the server/)).toBeVisible()
    await expect(page.locator('.finding-card').filter({ hasText: 'untrusted-legacy' })).toHaveCount(0)
  })

  test('Review finding opens the exact record and marks the finding under review', async ({ page }) => {
    await start(page)
    await amazon(page).getByRole('button', { name: 'Review finding' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Amazon' })).toBeVisible()
    await nav(page, /Bookkeeping Review/).click()
    await expect(amazon(page).locator('.finding-status')).toHaveText('Under review')
    await page.getByLabel('Review status').selectOption('Under review')
    await expect(amazon(page)).toBeVisible()
  })

  test('decisions stay with their client and do not cross into QuickBooks', async ({ page }) => {
    await start(page)
    await amazon(page).getByRole('button', { name: 'Dismiss finding' }).click()
    await amazon(page).getByLabel('Reason for dismissing').fill('Checked')
    await amazon(page).getByRole('button', { name: 'Confirm dismiss' }).click()

    await chooseClient(page, 'Acme Consulting')
    await expect(page.locator('.finding-card').first()).toBeVisible()
    for (const text of await page.locator('.finding-card').allInnerTexts()) expect(text.toLowerCase()).toContain('acme consulting')
    await expect(page.locator('.finding-card').filter({ hasText: 'Possible duplicate' }).first()).toBeVisible()
    await page.getByRole('button', { name: 'View review decisions' }).click()
    await expect(page.locator('.decision-history')).not.toContainText('Amazon')

    await page.getByRole('button', { name: /QuickBooks Sandbox/ }).first().click()
    // QuickBooks findings come from the Sandbox data only; nothing from the demo clients or their decisions appears.
    await expect(page.locator('.finding-card').first()).toContainText('Sandbox Supply Co')
    await expect(page.locator('.finding-card').filter({ hasText: /Amazon|Acme|ABC Plumbing/i })).toHaveCount(0)
    await expect(page.locator('.finding-card').first().locator('.finding-status')).toHaveText('Open')
    await expect(async () => {
      if (!(await page.locator('.decision-history').isVisible())) await page.getByRole('button', { name: 'View review decisions' }).click()
      await expect(page.locator('.decision-history')).toBeVisible({ timeout: 1000 })
    }).toPass()
    await expect(page.locator('.decision-history')).toContainText('No review decisions have been recorded yet.')
  })

  test('All clients keeps another company\'s dismissal and its history, never attributed to ABC Plumbing', async ({ page }) => {
    await start(page)
    await chooseClient(page, 'Acme Consulting')
    const first = page.locator('.finding-card').filter({ hasText: 'Possible duplicate' }).first()
    await expect(first).toBeVisible()
    await first.getByRole('button', { name: 'Dismiss finding' }).click()
    await first.getByLabel('Reason for dismissing').fill('Checked with the client')
    await first.getByRole('button', { name: 'Confirm dismiss' }).click()

    await chooseClient(page, 'All clients')
    await page.getByLabel('Review status').selectOption('Dismissed')
    const dismissed = page.locator('.finding-card')
    await expect(dismissed.first()).toBeVisible()
    for (const text of await dismissed.allInnerTexts()) expect(text.toLowerCase()).toContain('acme consulting')
    await expect(dismissed.first()).toContainText('Checked with the client')
    await page.getByRole('button', { name: 'View review decisions' }).click()
    await expect(page.locator('.decision-history')).toContainText('Acme Consulting')
    await expect(page.locator('.decision-history')).toContainText('Checked with the client')
  })
})
